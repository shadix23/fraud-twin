"""Лента переводов: экспорт добавляет риск и причину, но не меняет прогон."""
import unittest

from fraudtwin.engine import honest_cost, run_attack
from fraudtwin.feed import honest_feed, run_attack_feed
from fraudtwin.rules import DEFAULT_RULES
from fraudtwin.schemes import PRESETS, plan_attack, preset
from fraudtwin.world import BankProfile, generate_world

EXTRA = ("risk", "why", "side")
VARIANTS = ({}, {"model_on": True}, {"first_hold_on": True}, {"model_on": True, "first_hold_on": True})


class FeedTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = generate_world(BankProfile())

    def test_attack_run_is_unchanged(self):
        for key in PRESETS:
            self.world.clear_attack()
            plan = plan_attack(self.world, preset(key), seed=1)
            for kw in VARIANTS:
                rules = DEFAULT_RULES.with_(**kw)
                a = run_attack(self.world, rules, plan)
                b = run_attack_feed(self.world, rules, plan)
                self.assertEqual(a.attack_metrics(), b.attack_metrics(), (key, kw))
                self.assertEqual(a.freezes, b.freezes, (key, kw))
                self.assertEqual(a.log, [{k: v for k, v in e.items() if k not in EXTRA} for e in b.log], (key, kw))
        self.world.clear_attack()

    def test_every_attack_transfer_has_risk(self):
        self.world.clear_attack()
        plan = plan_attack(self.world, preset("student_crypto"), seed=1)
        sim = run_attack_feed(self.world, DEFAULT_RULES.with_(model_on=True), plan)
        self.world.clear_attack()
        self.assertTrue(sim.log)
        for e in sim.log:
            self.assertTrue(0.0 <= e["risk"] <= 1.0, e)
            if e["status"] == "suspended":          # модель остановила: риск не ниже порога, причина названа
                self.assertGreaterEqual(e["risk"], sim.scorer.threshold - 1e-3, e)
                self.assertTrue(e["why"], e)

    def test_honest_rows_match_honest_cost(self):
        self.world.clear_attack()
        for kw in VARIANTS:
            rules = DEFAULT_RULES.with_(**kw)
            cost, feed = honest_cost(self.world, rules), honest_feed(self.world, rules)
            self.assertEqual(feed["total"], {k: cost[k] for k in ("blocked", "suspended", "held")}, kw)
            self.assertEqual(feed["watched"], cost["honest_watched_tx"], kw)
            for r in feed["rows"]:
                self.assertEqual(r["kind"], "honest")
                self.assertTrue(r["why"], r)


if __name__ == "__main__":
    unittest.main()
