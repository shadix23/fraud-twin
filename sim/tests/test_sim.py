import time
import unittest

from fraudtwin import (BankProfile, DEFAULT_RULES, PRESETS, generate_world, honest_cost,
                       plan_attack, preset, run_attack)
from fraudtwin.world import Client, Specials, Tx, World, P2P


def small_world(seed=3, n=1500):
    return generate_world(BankProfile(n_clients=n, seed=seed))


def tiny_world():
    """Мир из 4 клиентов без честного трафика: для точечной проверки правил."""
    p = BankProfile(n_clients=4)
    clients = [Client(i, "employee", 1000, i) for i in range(4)]
    return World(p, clients, Specials(atm=-1, ext=-2), [])


class WorldTest(unittest.TestCase):
    def test_deterministic(self):
        a, b = small_world(), small_world()
        self.assertEqual(len(a.honest), len(b.honest))
        self.assertEqual([(t.src, t.dst, t.amount) for t in a.honest[:200]],
                         [(t.src, t.dst, t.amount) for t in b.honest[:200]])

    def test_default_world_shape(self):
        w = generate_world()
        s = w.summary()
        self.assertEqual(s["clients"], 5000)
        self.assertGreater(s["honest_tx"], 10_000)
        self.assertIn("p2p", s["honest_by_channel"])
        self.assertTrue(all(tx.t <= 24 * 60 for tx in w.honest))
        self.assertTrue(s["synthetic"])

    def test_clear_attack(self):
        w = small_world()
        plan_attack(w, PRESETS["student_crypto"])
        self.assertGreater(len(w.clients), w.profile.n_clients)
        w.clear_attack()
        self.assertEqual(len(w.clients), w.profile.n_clients)


class RulesTest(unittest.TestCase):
    def _run(self, w, txs, rules):
        from fraudtwin.engine import Sim
        w.honest = sorted(txs, key=lambda x: x.t)
        return Sim(w, rules, None, all_honest=True).run()

    def test_amount_limit_blocks(self):
        w = tiny_world()
        s = self._run(w, [Tx(10, 0, 1, 2_000_000, P2P)], DEFAULT_RULES)
        self.assertEqual(s.h_blocked, 1)

    def test_daily_limit_blocks(self):
        w = tiny_world()
        txs = [Tx(10 + i, 0, 1, 900_000, P2P) for i in range(4)]
        s = self._run(w, txs, DEFAULT_RULES.with_(velocity_on=False, new_recipient_on=False))
        self.assertEqual(s.h_blocked, 1)   # 4-й перевод превышает 3 млн

    def test_velocity_freezes_after_reaction_delay(self):
        w = tiny_world()
        txs = [Tx(10 + i, 0, 1, 1_000, P2P) for i in range(7)] + [Tx(100, 0, 2, 1_000, P2P)]
        s = self._run(w, txs, DEFAULT_RULES)
        self.assertIn(0, s.h_frozen)
        self.assertEqual(s.acc[0].frozen_by, "velocity")
        self.assertAlmostEqual(s.acc[0].frozen_at, 15 + DEFAULT_RULES.reaction_delay_min)  # 6-й перевод за час

    def test_new_recipient_flags_recipient(self):
        w = tiny_world()
        s = self._run(w, [Tx(10, 0, 3, 400_000, P2P)], DEFAULT_RULES)
        self.assertEqual(s.acc[3].flag_rule, "new_recipient")

    def test_known_recipient_not_flagged(self):
        w = tiny_world()
        w.clients[0].friends = [3]
        s = self._run(w, [Tx(10, 0, 3, 400_000, P2P)], DEFAULT_RULES)
        self.assertIsNone(s.acc[3].flag_rule)

    def test_shared_phone(self):
        w = tiny_world()
        for c in w.clients[1:]:
            c.phone = 99
        w2 = World(w.profile, w.clients, w.specials, [])
        s = self._run(w2, [Tx(10, 0, 1, 60_000, P2P)], DEFAULT_RULES)
        self.assertEqual(s.acc[1].flag_rule, "shared_phone")

    def test_first_hold_delays(self):
        w = tiny_world()
        r = DEFAULT_RULES.with_(first_hold_on=True)
        s = self._run(w, [Tx(10, 0, 2, 200_000, P2P)], r)
        self.assertEqual(s.h_held, 1)


class AttackTest(unittest.TestCase):
    def setUp(self):
        self.w = small_world()

    def _plan(self, key, **kw):
        self.w.clear_attack()
        return plan_attack(self.w, preset(key, **kw), seed=2)

    def test_all_presets_conserve_money(self):
        for key in PRESETS:
            plan = self._plan(key)
            m = run_attack(self.w, DEFAULT_RULES, plan).attack_metrics()
            total = m["withdrawn_kzt"] + m["intercepted_kzt"] + m["stuck_kzt"]
            self.assertEqual(total, m["attempted_kzt"], key)
            self.assertGreater(m["attempted_kzt"], 0, key)

    def test_attack_deterministic(self):
        plan = self._plan("student_crypto")
        a = run_attack(self.w, DEFAULT_RULES, plan).attack_metrics()
        b = run_attack(self.w, DEFAULT_RULES, plan).attack_metrics()
        self.assertEqual(a, b)

    def test_rules_stop_part_of_known_attack(self):
        plan = self._plan("student_crypto")
        m = run_attack(self.w, DEFAULT_RULES, plan).attack_metrics()
        self.assertGreater(m["withdrawn_kzt"], 0)
        self.assertGreater(m["intercepted_kzt"], 0)

    def test_no_rules_lets_everything_out(self):
        plan = self._plan("student_crypto")
        off = DEFAULT_RULES.with_(amount_limit_on=False, daily_limit_on=False, velocity_on=False,
                                  new_recipient_on=False, account_age_on=False,
                                  shared_phone_on=False, victim_reports_on=False)
        m = run_attack(self.w, off, plan).attack_metrics()
        self.assertEqual(m["withdrawn_kzt"], m["attempted_kzt"])

    def test_model_reduces_losses(self):
        plan = self._plan("student_crypto")
        base = run_attack(self.w, DEFAULT_RULES, plan).attack_metrics()
        mod = run_attack(self.w, DEFAULT_RULES.with_(model_on=True), plan).attack_metrics()
        self.assertLess(mod["withdrawn_kzt"], base["withdrawn_kzt"])

    def test_stealth_variant_passes_rules(self):
        """Дыра существует: старые счета, свои телефоны, суммы ниже порогов, быстрый вывод."""
        plan = self._plan("student_crypto", victim_amount=250_000, victim_chunk_max=280_000,
                          chunk_max=250_000, drop_age_days=200, drops_per_phone=1,
                          pause_min=5, chunk_gap_min=12)
        m = run_attack(self.w, DEFAULT_RULES, plan).attack_metrics()
        self.assertGreater(m["withdrawn_kzt"] / m["attempted_kzt"], 0.9, m)

    def test_carousel_returns_to_head(self):
        plan = self._plan("carousel")
        s = run_attack(self.w, DEFAULT_RULES.with_(shared_phone_on=False), plan)
        heads = {c.layers[0][0] for c in plan.chains}
        back = [e for e in s.log if e["kind"] == "drop" and e["dst"] in heads]
        self.assertTrue(back, "в карусели деньги должны вернуться в голову цепочки")

    def test_hold_costs_honest_clients(self):
        base = honest_cost(self.w, DEFAULT_RULES)
        hold = honest_cost(self.w, DEFAULT_RULES.with_(first_hold_on=True))
        self.assertGreater(hold["delayed_per_10k"], base["delayed_per_10k"])

    def test_fast_enough_for_redteam(self):
        w = generate_world()
        plan = plan_attack(w, PRESETS["student_crypto"], seed=1)
        t0 = time.time()
        for _ in range(20):
            run_attack(w, DEFAULT_RULES, plan)
        self.assertLess((time.time() - t0) / 20, 0.05)


if __name__ == "__main__":
    unittest.main()


class RedteamModelTest(unittest.TestCase):
    def test_redteam_finds_better_scheme(self):
        from fraudtwin.redteam import search
        w = small_world()
        r = search(w, "student_crypto", pop=8, gens=3)
        self.assertEqual(r["evals"], 24)
        self.assertGreaterEqual(r["best"]["fit"], r["base"]["fit"])
        self.assertEqual(len(w.clients), w.profile.n_clients)   # мир чистый после поиска

    def test_trained_model_scores_drop_higher(self):
        from fraudtwin.model import default_scorer, FEATURE_NAMES
        sc = default_scorer()
        honest = [9.2, 0, 7.0, 1, 10.5, 9.2, 0.2, 600, 1, 1, 0, 1, 0.0, 14, 0, 0.0]
        drop = [13.0, 1, 3.0, 4, 13.1, 13.0, 1.0, 5, 2, 2, 2, 1, 0.9, 14, 2, 1.0]
        self.assertEqual(len(honest), len(FEATURE_NAMES))
        self.assertGreater(sc(drop), sc(honest))

    def test_model_whatif_reduces_withdrawn(self):
        w = small_world()
        plan = plan_attack(w, preset("student_crypto"))
        base = run_attack(w, DEFAULT_RULES, plan).attack_metrics()["withdrawn_kzt"]
        model = run_attack(w, DEFAULT_RULES.with_(model_on=True), plan).attack_metrics()["withdrawn_kzt"]
        self.assertLess(model, base)
