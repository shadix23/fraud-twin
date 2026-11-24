import importlib.util
import unittest

from fraudtwin import generate_world
from fraudtwin.report import (CALIB_PRESETS, CalibError, DEFAULT_CALIB, build_report,
                              calib_profile, calib_rules, normalize)


class CalibTest(unittest.TestCase):
    def test_empty_is_demo(self):
        self.assertEqual(normalize(None), DEFAULT_CALIB)

    def test_rejects_out_of_range_and_unknown(self):
        with self.assertRaises(CalibError):
            normalize({"n_clients": 50})
        with self.assertRaises(CalibError):
            normalize({"password": 1})
        with self.assertRaises(CalibError):
            normalize({"amount_limit": 2_000_000, "daily_limit": 1_000_000})

    def test_presets_valid_and_change_world(self):
        for p in CALIB_PRESETS:
            self.assertEqual(normalize(p["values"]), p["values"])
        c = normalize({"n_clients": 2000, "share_student": 0.4, "reaction_delay_min": 5})
        w = generate_world(calib_profile(c))
        self.assertEqual(len(w.clients), 2000)
        seg = w.summary()["segments"]
        self.assertAlmostEqual(seg["student"] / 2000, 0.4, delta=0.01)
        self.assertEqual(calib_rules(c).reaction_delay_min, 5)


class ReportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        c = normalize({"n_clients": 2000})
        cls.rep = build_report(generate_world(calib_profile(c)), calib_rules(c), "тест", c)

    def test_shape_and_synthetic(self):
        r = self.rep
        self.assertTrue(r["synthetic"])
        self.assertEqual(len(r["schemes"]), 5)
        self.assertEqual([m["key"] for m in r["measures"]], ["base", "model", "hold", "model_hold"])
        self.assertTrue(r["caveats"])
        self.assertTrue(r["recommendations"])

    def test_hole_not_worse_than_library(self):
        # ИИ-мошенник оптимизирует выведено минус стоимость, поэтому сравниваем не строго
        s = self.rep["summary"]
        self.assertGreaterEqual(s["hole_withdrawn"], 0.9 * s["lib_withdrawn"])
        self.assertLessEqual(s["hole_withdrawn"], s["attempted"] * 2)

    def test_model_cuts_hole_losses(self):
        m = {x["key"]: x for x in self.rep["measures"]}
        self.assertLess(m["model"]["hole_withdrawn"], m["base"]["hole_withdrawn"])


class PayloadTest(unittest.TestCase):
    def test_every_log_node_is_in_graph(self):
        from fraudtwin.export import scenario_payload
        from fraudtwin.schemes import PRESETS
        for c in CALIB_PRESETS:
            w = generate_world(calib_profile(c["values"]))
            for key in PRESETS:
                sc = scenario_payload(w, key, calib_rules(c["values"]))
                ids = {n["id"] for n in sc["nodes"]}
                for r in sc["runs"].values():
                    for e in r["log"]:
                        self.assertIn(e["src"], ids)
                        self.assertIn(e["dst"], ids)


@unittest.skipUnless(importlib.util.find_spec("fastapi"), "fastapi есть только в .venv")
class ApiTest(unittest.TestCase):
    def test_calibrated_endpoints(self):
        from fastapi.testclient import TestClient
        from fraudtwin.api import app
        cl = TestClient(app)
        r = cl.post("/world", json={"calib": {"n_clients": 2000, "reaction_delay_min": 10}})
        self.assertEqual(r.status_code, 200)
        b = r.json()
        self.assertEqual(b["summary"]["clients"], 2000)
        self.assertEqual(b["rules"]["reaction_delay_min"], 10)
        self.assertIsNone(b["calib_preset"])
        r = cl.post("/attack", json={"scheme": "structuring", "calib": {"n_clients": 2000}})
        self.assertEqual(r.status_code, 200)
        self.assertIn("runs", r.json())
        self.assertEqual(cl.post("/world", json={"calib": {"n_clients": 1}}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
