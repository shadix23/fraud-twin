import os
os.environ["FT_LIVE_BUDGET_S"] = "0"   # детерминированный режим по числу поколений
"""B2: параметр lang. Тексты переводятся, числа и структура те же, в en нет кириллицы.

cd sim && .venv/bin/python -m unittest tests.test_i18n -v
"""
import json
import re
import unittest

from fraudtwin import i18n
from fraudtwin.i18n import MISSED, norm_lang, tr_text, translate

CYR = re.compile("[а-яА-ЯёЁ]")


def numbers(o, acc=None):
    acc = [] if acc is None else acc
    if isinstance(o, dict):
        for k, v in o.items():
            acc.append(k)
            numbers(v, acc)
    elif isinstance(o, list):
        for v in o:
            numbers(v, acc)
    elif not isinstance(o, str):
        acc.append(o)
    return acc


def strings(o, acc=None):
    acc = [] if acc is None else acc
    if isinstance(o, dict):
        for v in o.values():
            strings(v, acc)
    elif isinstance(o, list):
        for v in o:
            strings(v, acc)
    elif isinstance(o, str):
        acc.append(o)
    return acc


class UnitTest(unittest.TestCase):
    def test_lang_normalised(self):
        self.assertEqual(norm_lang("en"), "en")
        self.assertEqual(norm_lang("kk"), "ru")
        self.assertEqual(norm_lang(None), "ru")

    def test_ru_is_identity(self):
        d = {"a": "Банкомат"}
        self.assertIs(translate(d, "ru"), d)
        self.assertEqual(translate(d, "xx"), d)

    def test_numbers_localised(self):
        self.assertEqual(tr_text("Пришло 1 300 000 ₸ и через 4 мин уходит дальше"),
                         "₸1,300,000 arrived and moves on after 4 min")
        self.assertEqual(tr_text("Вариант ИИ-мошенника выводит 13,6 млн ₸ из 16,5 млн ₸ (83%), молчат 2 из 6 правил. "
                                 "Перепроверка на трёх других атаках: 12,0 млн ₸, 11,3 млн ₸, 10,0 млн ₸."),
                         "The AI fraudster's variant cashes out ₸13.6M of ₸16.5M (83%); 2 of 6 rules stay silent. "
                         "Rechecked on three other attacks: ₸12.0M, ₸11.3M, ₸10.0M.")

    def test_plural_and_compound(self):
        self.assertEqual(tr_text("Возраст карты отправителя: 1 день. На одном номере телефона 2 карты"),
                         "Sender card age: 1 day. 2 cards on one phone number")

    def test_non_russian_untouched(self):
        self.assertEqual(tr_text("student_crypto"), "student_crypto")
        self.assertEqual(translate({"n": 1.5, "ok": True, "x": None}, "en"), {"n": 1.5, "ok": True, "x": None})

    def test_unknown_string_is_reported(self):
        MISSED.clear()
        self.assertEqual(tr_text("Совсем новая фраза"), "Совсем новая фраза")
        self.assertIn("Совсем новая фраза", MISSED)
        MISSED.clear()


class PayloadTest(unittest.TestCase):
    """Реальные ответы: ru и en совпадают по числам и структуре, в en нет кириллицы."""

    @classmethod
    def setUpClass(cls):
        try:
            from fastapi.testclient import TestClient
        except Exception:  # pragma: no cover
            raise unittest.SkipTest("нет fastapi/httpx")
        from fraudtwin.api import app
        cls.c = TestClient(app)
        MISSED.clear()

    def both(self, method, url, body=None):
        out = {}
        for lang in ("ru", "en"):
            if method == "get":
                r = self.c.get(url, params={"lang": lang})
            else:
                r = self.c.post(url, json={**(body or {}), "lang": lang})
            self.assertEqual(r.status_code, 200, r.text)
            out[lang] = r.json()
        return out["ru"], out["en"]

    def check(self, ru, en):
        self.assertEqual(numbers(ru), numbers(en))
        self.assertFalse([s for s in strings(en) if CYR.search(s)])
        txt = json.dumps([ru, en], ensure_ascii=False)
        self.assertNotIn("—", txt)
        self.assertNotIn("–", txt)
        self.assertEqual(len(strings(ru)), len(strings(en)))

    def test_world_and_attack(self):
        for url in ("/world", "/attack/structuring", "/model", "/client-check"):
            ru, en = self.both("get", url)
            self.check(ru, en)
        ru, en = self.both("post", "/world", {"calib": {"reaction_delay_min": 15}})
        self.check(ru, en)
        self.assertIn(en["name"], ("Your bank (calibrated)", "Digital bank"))

    def test_redteam_rule_variants(self):
        variants = [None, {"amount_limit": 500000, "velocity_on": False},
                    {"new_recipient_amount": 900000, "account_age_days": 5, "shared_phone_n": 8},
                    {"amount_limit_on": False, "daily_limit_on": False, "velocity_on": False,
                     "new_recipient_on": False, "account_age_on": False, "shared_phone_on": False}]
        for scheme in ("student_crypto", "structuring", "fake_seller"):
            for rules in variants:
                ru, en = self.both("post", "/redteam", {"scheme": scheme, "rules": rules, "generations": 3})
                self.check(ru, en)
        self.assertEqual(MISSED, set())

    def test_whatif_and_client_check(self):
        for scheme in ("student_crypto", "carousel"):
            ru, en = self.both("post", "/whatif", {"scheme": scheme})
            self.check(ru, en)
            for hole in (True, False):
                ru, en = self.both("post", "/client-check", {"scheme": scheme, "hole": hole})
                self.check(ru, en)
        self.assertEqual(MISSED, set())

    def test_report(self):
        ru, en = self.both("post", "/report", {})
        self.check(ru, en)
        self.assertEqual(MISSED, set())
        self.assertIn("Rerun the crash test", json.dumps(en))

    def test_default_lang_is_ru_and_errors(self):
        r = self.c.post("/redteam", json={"scheme": "student_crypto", "generations": 2})
        self.assertTrue(CYR.search(json.dumps(r.json(), ensure_ascii=False)))
        r = self.c.post("/world", json={"calib": {"amount_limit": 1}, "lang": "en"})
        self.assertEqual(r.status_code, 422)
        self.assertFalse(CYR.search(r.text.replace("\\u", "")), r.text)
        r = self.c.post("/attack", json={"scheme": "nope", "lang": "en"})
        self.assertEqual(r.status_code, 404)
        self.assertFalse(CYR.search(json.dumps(r.json(), ensure_ascii=False)))
        r = self.c.get("/world", params={"lang": "zz"})   # неизвестный язык = ru
        self.assertEqual(r.json()["name"], "Демо-банк")


if __name__ == "__main__":
    unittest.main()
