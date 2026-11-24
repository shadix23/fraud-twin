import os
os.environ["FT_LIVE_BUDGET_S"] = "0"   # детерминированный режим по числу поколений
import unittest

from fraudtwin.redteam import evaluate, search, search_live
from fraudtwin.report import calib_profile, calib_rules, normalize
from fraudtwin.schemes import PRESETS, preset
from fraudtwin.world import generate_world


class SearchRobustTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        c = normalize(None)
        cls.world = generate_world(calib_profile(c))
        cls.rules = calib_rules(c)

    def test_strict_rules_attack_not_better_than_profile_search(self):
        """Атака, найденная при более строгих правилах, не даёт на правилах профиля больше,
        чем лучший результат поиска на профиле (иначе поиск недобирает, как было 67,9% против 100%)."""
        for key in ("student_crypto", "carousel"):
            for limit in (300_000, 500_000, 700_000):
                strict = self.rules.with_(amount_limit=limit)
                found = search(self.world, key, strict, restarts=2, use_bank=False)
                fit_on_profile, _ = evaluate(self.world, self.rules, preset(key, **found["overrides"]))
                best = search_live(self.world, key, self.rules)["best"]["fit"]
                self.assertGreaterEqual(best, int(fit_on_profile),
                                        f"{key} limit {limit}: search {best} < strict attack {fit_on_profile}")

    def test_lower_bound_flag_and_determinism(self):
        a = search_live(self.world, "student_crypto", self.rules)
        b = search_live(self.world, "student_crypto", self.rules)
        self.assertIs(a["lower_bound"], True)
        self.assertEqual(a["best"]["fit"], b["best"]["fit"])
        self.assertEqual(a["overrides"], b["overrides"])
        self.assertEqual(a["search"]["restarts"], 2)

    def test_not_worse_than_plain_search(self):
        for key in PRESETS:
            plain = search(self.world, key, self.rules, use_bank=False)["best"]["fit"]
            live = search_live(self.world, key, self.rules)["best"]["fit"]
            self.assertGreaterEqual(live, plain)


if __name__ == "__main__":
    unittest.main()
