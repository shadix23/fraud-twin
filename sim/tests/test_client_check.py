import json
import os
import unittest

from fraudtwin import BankProfile, DEFAULT_RULES, generate_world, plan_attack, preset, run_attack
from fraudtwin.client_check import (SCREEN, check, client_payload, demo_payload, probe_attack,
                                    probe_honest, reason_text, thresholds, victim_stats)
from fraudtwin.engine import Sim
from fraudtwin.world import BankProfile as BP, Client, Specials, Tx, World, P2P

# дыра ИИ-мошенника для student_crypto (как в redteam_student_crypto.json): частями по 579 тыс. ₸
HOLE = {"victim_chunk_max": 579000, "layers": 1, "fan_out": 2, "pause_min": 4.0,
        "chunk_max": 1200000, "chunk_gap_min": 7.3, "drop_age_days": 77, "drops_per_phone": 5,
        "cashout": {"atm": 0.5, "ext": 0.5}}


def demo_world():
    return generate_world(BankProfile())


class RecipientCheckTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = demo_world()
        plan = plan_attack(cls.w, preset("student_crypto", **HOLE), seed=1)
        cls.rows = probe_attack(cls.w, plan)
        cls.w.clear_attack()
        cls.honest = probe_honest(cls.w)

    def test_one_check_per_victim(self):
        self.assertEqual(len(self.rows), 24)   # 12 цепочек x 2 жертвы
        self.assertEqual(len({(r["src"], r["dst"]) for r in self.rows}), 24)
        self.assertTrue(all(r["amount"] <= 579_000 for r in self.rows))

    def test_fresh_card_has_no_history(self):
        """Честное ограничение: первая жертва на свежую карту обычно без предупреждения."""
        first = [r for r in self.rows if r["victim_no"] == 1]
        silent = [r for r in first if r["level"] == "low"]
        self.assertGreaterEqual(len(silent), len(first) // 2)
        self.assertTrue(all(r["basis"] == "no_history" and r["score"] == 0 for r in silent))

    def test_repeat_victims_covered(self):
        """Следующая жертва на ту же карту: предупреждение модели или карта уже заморожена."""
        later = [r for r in self.rows if r["victim_no"] > 1]
        self.assertTrue(later)
        covered = [r for r in later if r["level"] in ("high", "medium", "blocked")]
        self.assertGreaterEqual(len(covered) / len(later), 0.9)
        self.assertTrue(any(r["level"] == "high" for r in later))

    def test_high_has_human_reasons(self):
        for r in self.rows:
            if r["level"] == "high":
                self.assertGreaterEqual(len(r["reasons"]), 2)
                self.assertLessEqual(len(r["reasons"]), 3)
                for x in r["reasons"]:
                    self.assertTrue(x["text"].endswith("."))
                    for jargon in ("скор", "признак", "транзитн", "score", "pass", "log"):
                        self.assertNotIn(jargon, x["text"].lower())

    def test_honest_false_warnings_small(self):
        h = self.honest
        self.assertGreater(h["honest_p2p_tx"], 3000)
        self.assertLess(h["warned_per_10k"], 30)   # синтетика: ~7 в демо-мире, ~14 на 6 мирах
        self.assertEqual(h["warned_high"] + h["warned_medium"],
                         round(h["warned_per_10k"] * h["honest_p2p_tx"] / 10_000))

    def test_stats_add_up(self):
        s = victim_stats(self.rows)
        self.assertEqual(s["warned"] + s["blocked_by_rules"] + s["silent"], s["victims"])
        self.assertEqual(s["first_on_card"] + s["repeat_on_card"], s["victims"])
        self.assertEqual(s["repeat_on_card_warned"] + s["repeat_on_card_blocked"]
                         + s["repeat_on_card_silent"], s["repeat_on_card"])
        self.assertLessEqual(s["saved_kzt_est"], s["warned_kzt"])

    def test_probe_does_not_change_simulation(self):
        """Зонд только читает состояние: метрики атаки те же, что без него."""
        w = self.w
        w.clear_attack()
        plan = plan_attack(w, preset("student_crypto", **HOLE), seed=1)
        a = run_attack(w, DEFAULT_RULES, plan).attack_metrics()
        sim = Sim(w, DEFAULT_RULES, plan)
        sim.on_tx = lambda s, t, tx: check(s, t, tx.src, tx.dst, tx.amount) if tx.dst >= 0 else None
        b = sim.run().attack_metrics()
        w.clear_attack()
        self.assertEqual(a, b)


class TransitCardTest(unittest.TestCase):
    """Точечно: карта, через которую прошли деньги незнакомцев, против обычной."""

    def _world(self):
        p = BP(n_clients=8)
        cl = [Client(i, "employee", 1500, 100 + i) for i in range(6)]
        cl += [Client(6, "student", 20, 7), Client(7, "student", 25, 7)]   # молодые, один телефон
        return World(p, cl, Specials(atm=-1, ext=-2), [])

    def test_transit_vs_normal(self):
        w = self._world()
        txs = [Tx(600, 1, 6, 300_000, P2P), Tx(604, 6, 7, 300_000, P2P),
               Tx(620, 2, 6, 250_000, P2P), Tx(623, 6, 7, 250_000, P2P),
               Tx(600, 3, 5, 20_000, P2P)]
        w.honest = sorted(txs, key=lambda x: x.t)
        out = {}

        def hook(sim, t, tx):
            if t >= 640 and tx.src == 0:
                out[tx.dst] = check(sim, t, 0, tx.dst, 579_000)
        w.honest += [Tx(640, 0, 6, 579_000, P2P), Tx(641, 0, 5, 579_000, P2P)]
        sim = Sim(w, DEFAULT_RULES.with_(shared_phone_on=False, account_age_on=False,
                                         new_recipient_on=False, velocity_on=False), None,
                  all_honest=True)
        sim.on_tx = hook
        sim.run()
        drop, normal = out[6], out[5]
        self.assertGreater(drop["score"], normal["score"])
        self.assertEqual(drop["level"], "high")
        self.assertEqual(drop["recipient"]["n_src"], 2)
        self.assertTrue({"transit", "strangers", "young", "phone"} & {r["key"] for r in drop["reasons"]})
        self.assertIn(normal["level"], ("low", "medium"))

    def test_reason_texts(self):
        v = {"age_days": 21, "phone_share": 4, "n_new_src": 6, "n_src": 6, "in_kzt": 1_250_000,
             "out_kzt": 1_200_000, "dwell_min": 7.0, "max_src_pass": 0.0}
        self.assertEqual(reason_text("young", v), "Карте всего 21 день.")
        self.assertIn("4 карты", reason_text("phone", v))
        self.assertIn("6 человек", reason_text("strangers", v))
        self.assertIn("1\u00a0250\u00a0000\u00a0₸", reason_text("strangers", v))  # сумма с неразрывными пробелами
        self.assertIn("7 мин", reason_text("transit", v))
        self.assertIsNone(reason_text("chain", v))
        self.assertIsNone(reason_text("young", {**v, "age_days": 900}))


class PayloadTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = demo_world()
        cls.p = demo_payload(cls.w, overrides=HOLE)

    def test_contract(self):
        p = self.p
        self.assertTrue(p["synthetic"])
        self.assertIn("оценка", p["note"].lower())
        self.assertEqual(p["demo"], "high")
        hi = p["cases"]["high"]
        self.assertEqual(hi["transfer"]["amount"], 579_000)
        self.assertEqual(hi["risk"]["level"], "high")
        self.assertEqual(hi["action"], "cancel")
        self.assertEqual([b["id"] for b in hi["screen"]["buttons"]], ["cancel", "call", "send_anyway"])
        self.assertGreaterEqual(len(hi["reasons"]), 2)
        self.assertEqual(p["cases"]["fresh_card"]["risk"]["level"], "low")
        self.assertEqual(p["cases"]["honest"]["risk"]["level"], "low")
        self.assertEqual(set(SCREEN), {"high", "medium", "low", "blocked"})
        t = thresholds()
        self.assertLess(t["medium"], t["high"])
        self.assertEqual(len(p["by_scheme"]), 6)
        json.dumps(p, ensure_ascii=False)

    def test_no_long_dashes_in_texts(self):
        txt = json.dumps({"s": SCREEN, "p": self.p}, ensure_ascii=False)
        self.assertNotIn("—", txt)
        self.assertNotIn("·", txt)

    def test_world_clean_after(self):
        self.assertEqual(len(self.w.clients), self.w.profile.n_clients)
        p = client_payload(self.w, "fake_seller")
        self.assertFalse(p["scheme"]["hole"])
        self.assertEqual(len(self.w.clients), self.w.profile.n_clients)

    def test_fallback_json_matches(self):
        path = os.path.join(os.path.dirname(__file__), "..", "..", "app", "public", "scenarios",
                            "client_check.json")
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        self.assertEqual(d["cases"]["high"]["transfer"], self.p["cases"]["high"]["transfer"])
        self.assertEqual(d["stats"], self.p["stats"])
        self.assertIn("robust", d)


class ApiTest(unittest.TestCase):
    def test_endpoint(self):
        try:
            from fastapi.testclient import TestClient
        except Exception:  # pragma: no cover
            self.skipTest("нет fastapi/httpx")
        from fraudtwin.api import app
        c = TestClient(app)
        r = c.post("/client-check", json={"scheme": "fake_seller", "hole": False})
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertEqual(d["scheme"]["key"], "fake_seller")
        self.assertIn("victims", d["stats"])
        self.assertEqual(c.post("/client-check", json={"scheme": "nope"}).status_code, 404)
        self.assertEqual(c.post("/client-check", json={"scheme": "fake_seller", "hole": False,
                                                       "overrides": {"bad": 1}}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
