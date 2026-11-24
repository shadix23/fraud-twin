import os
os.environ["FT_LIVE_BUDGET_S"] = "0"   # детерминированный режим по числу поколений
import unittest

try:
    from fastapi.testclient import TestClient
    from fraudtwin.api import app
except Exception:  # pragma: no cover
    app = None


@unittest.skipIf(app is None, "нет fastapi")
class RedteamContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(app)

    def post(self, **kw):
        return self.c.post("/redteam", json={"scheme": "student_crypto", "generations": 3, **kw})

    def test_default_rules_not_changed(self):
        r = self.post()
        self.assertEqual(r.status_code, 200)
        j = r.json()
        self.assertEqual(j["rules_changed"], [])
        self.assertEqual(j["honest"], j["honest_base"])
        self.assertEqual(j["source"], "live")
        self.assertEqual(set(j["honest"]), {"delayed_per_10k", "frozen_clients_pct", "blocked"})
        for k in ("base", "best", "history", "scenario", "seconds"):
            self.assertIn(k, j)
        self.assertIs(j["lower_bound"], True)   # поиск даёт нижнюю оценку: «не меньше X%»
        self.assertIn("restart_pct", j["search"])

    def test_changed_rules_move_honest(self):
        j = self.post(rules={"amount_limit": 200_000}).json()
        self.assertEqual(j["rules"]["amount_limit"], 200_000)
        self.assertEqual(j["rules_changed"], [{"param": "amount_limit", "from": 1_000_000, "to": 200_000}])
        self.assertGreater(j["honest"]["blocked"], j["honest_base"]["blocked"])

    def test_422_unknown(self):
        r = self.post(rules={"foo": 1})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["detail"], {"code": "rule_unknown", "params": ["foo"]})

    def test_422_range(self):
        for v in (10, 9_000_000):
            r = self.post(rules={"amount_limit": v})
            self.assertEqual(r.status_code, 422)
            self.assertEqual(r.json()["detail"], {"code": "rule_range", "param": "amount_limit",
                                                  "min": 50_000, "max": 5_000_000})

    def test_422_type_and_404(self):
        self.assertEqual(self.post(rules={"amount_limit": "x"}).status_code, 422)
        self.assertEqual(self.post(rules={"velocity_on": 1}).status_code, 422)
        r = self.c.post("/redteam", json={"scheme": "nope"})
        self.assertEqual(r.status_code, 404)

    def test_rule_meta_bounds(self):
        meta = self.c.get("/world").json()["rule_meta"]
        for m in meta:
            for k in ("on_param", "min", "max", "step", "default"):
                self.assertIn(k, m)
            self.assertTrue(m["min"] <= m["default"] <= m["max"])
