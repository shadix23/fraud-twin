"""Калибровка двойника под банк и отчёт краш-теста для фрод-директора.

Калибровка: несколько агрегатов банка (размер, доли сегментов, лимиты, задержка
заморозки) пересобирают синтетический мир и правила. Это имитация адаптации:
реальный банк даёт агрегаты, а не данные клиентов.

Отчёт: все схемы библиотеки, найденная ИИ-мошенником дыра в каждой, четыре
варианта защиты и цена для честных клиентов. Все числа - прогоны синтетического
банка, параметры - гипотезы (research/02-angle.md).
"""
from __future__ import annotations

from dataclasses import asdict
from typing import Dict, List, Optional, Tuple

from .engine import honest_cost, run_attack
from .redteam import search_live, search_strong, STRONG_MODEL
from .rules import DEFAULT_RULES, Rules
from .schemes import PRESETS, plan_attack, preset
from .world import BankProfile, World

# --- калибровка ------------------------------------------------------------

# ползунок: (куда, мин, макс, шаг, подпись, единица)
CALIB_FIELDS: List[dict] = [
    {"key": "n_clients", "target": "profile", "min": 2000, "max": 10000, "step": 1000,
     "title": "Клиентов в двойнике", "unit": ""},
    {"key": "share_student", "target": "profile", "min": 0.05, "max": 0.40, "step": 0.01,
     "title": "Доля студентов", "unit": "%"},
    {"key": "share_pensioner", "target": "profile", "min": 0.05, "max": 0.35, "step": 0.01,
     "title": "Доля пенсионеров", "unit": "%"},
    {"key": "amount_limit", "target": "rules", "min": 200_000, "max": 3_000_000, "step": 100_000,
     "title": "Лимит одного перевода", "unit": "₸"},
    {"key": "daily_limit", "target": "rules", "min": 500_000, "max": 10_000_000, "step": 250_000,
     "title": "Суточный лимит исходящих", "unit": "₸"},
    {"key": "reaction_delay_min", "target": "rules", "min": 5, "max": 120, "step": 5,
     "title": "Задержка заморозки после сигнала", "unit": "мин"},
]
PROFILE_KEYS = [f["key"] for f in CALIB_FIELDS if f["target"] == "profile"]
RULE_KEYS = [f["key"] for f in CALIB_FIELDS if f["target"] == "rules"]

DEFAULT_CALIB = {"n_clients": 5000, "share_student": 0.18, "share_pensioner": 0.15,
                 "amount_limit": 1_000_000, "daily_limit": 3_000_000, "reaction_delay_min": 30}

# Готовые профили: считаются заранее и лежат в JSON (подстраховка без сервера).
CALIB_PRESETS: List[dict] = [
    {"id": "demo", "name": "Демо-банк", "note": "условный универсальный банк",
     "values": dict(DEFAULT_CALIB)},
    {"id": "digital", "name": "Цифровой банк", "note": "молодые клиенты, быстрые лимиты, реакция 15 мин",
     "values": {"n_clients": 8000, "share_student": 0.30, "share_pensioner": 0.08,
                "amount_limit": 500_000, "daily_limit": 2_000_000, "reaction_delay_min": 15}},
    {"id": "regional", "name": "Региональный банк", "note": "много пенсионеров, высокие лимиты, реакция 60 мин",
     "values": {"n_clients": 3000, "share_student": 0.10, "share_pensioner": 0.30,
                "amount_limit": 2_000_000, "daily_limit": 5_000_000, "reaction_delay_min": 60}},
]


class CalibError(ValueError):
    pass


def normalize(calib: Optional[dict]) -> dict:
    """Проверка и округление значений ползунков. Пустой ввод = демо-банк."""
    out = dict(DEFAULT_CALIB)
    if not calib:
        return out
    bad = set(calib) - set(DEFAULT_CALIB)
    if bad:
        raise CalibError(f"Неизвестные параметры калибровки: {sorted(bad)}")
    for f in CALIB_FIELDS:
        k = f["key"]
        if k not in calib:
            continue
        try:
            v = float(calib[k])
        except (TypeError, ValueError):
            raise CalibError(f"{f['title']}: нужно число")
        if not (f["min"] <= v <= f["max"]):
            raise CalibError(f"{f['title']}: от {f['min']} до {f['max']}")
        out[k] = round(v, 2) if f["unit"] == "%" else int(round(v))
    if out["daily_limit"] < out["amount_limit"]:
        raise CalibError("Суточный лимит не может быть меньше лимита одного перевода")
    return out


def calib_profile(c: dict) -> BankProfile:
    return BankProfile(**{k: c[k] for k in PROFILE_KEYS})


def calib_rules(c: dict) -> Rules:
    return DEFAULT_RULES.with_(**{k: c[k] for k in RULE_KEYS})


def calib_name(c: dict) -> str:
    for p in CALIB_PRESETS:
        if p["values"] == c:
            return p["name"]
    return "Ваш банк (калибровка)"


def preset_id(c: dict) -> Optional[str]:
    for p in CALIB_PRESETS:
        if p["values"] == c:
            return p["id"]
    return None


# --- отчёт -----------------------------------------------------------------

VARIANTS = {
    "base": {},
    "model": {"model_on": True},
    "hold": {"first_hold_on": True},
    "model_hold": {"model_on": True, "first_hold_on": True},
}
VARIANT_RU = {
    "base": "Текущие правила банка",
    "model": "Модель на графе переводов",
    "hold": "Задержка первого перевода новому получателю",
    "model_hold": "Модель и задержка вместе",
}


def _short(m: dict) -> dict:
    return {"withdrawn": m["withdrawn_kzt"], "intercepted": m["intercepted_kzt"],
            "attempted": m["attempted_kzt"], "chains_caught": m["chains_caught"],
            "chains_total": m["chains_total"], "rule_hits": m["rule_hits"]}


def _variants(world: World, rules: Rules, params) -> Dict[str, dict]:
    world.clear_attack()
    plan = plan_attack(world, params, seed=1)
    out = {k: _short(run_attack(world, rules.with_(**kw), plan).attack_metrics())
           for k, kw in VARIANTS.items()}
    world.clear_attack()
    return out


def _pct(a: float, b: float) -> float:
    return round(100 * a / b, 1) if b else 0.0


def build_report(world: World, rules: Rules, name: str, calib: dict,
                 redteam: Optional[Dict[str, dict]] = None, fast: bool = False) -> dict:
    """Отчёт по всем схемам. redteam: готовые результаты search по ключу схемы."""
    schemes = []
    for key, p in PRESETS.items():
        rt = (redteam or {}).get(key) or (search_live if fast else search_strong)(world, key, rules)
        lib = _variants(world, rules, preset(key))
        hole = _variants(world, rules, preset(key, **rt["overrides"]))
        # гонка вооружений: ИИ-мошенник ищет заново, уже против модели на графе
        rm = (search_live(world, key, rules.with_(model_on=True)) if fast else
              search_strong(world, key, rules.with_(model_on=True), **STRONG_MODEL))
        schemes.append({
            "rematch": {"withdrawn": rm["best"]["metrics"]["withdrawn_kzt"],
                        "attempted": rm["best"]["metrics"]["attempted_kzt"],
                        "pct": rm["best"]["pct"], "diff": rm["best"]["diff"]},
            "key": key, "title": p.title, "source": p.source,
            "lib": lib, "hole": hole,
            "diff": rt["best"]["diff"], "silent_rules": rt["best"]["silent_rules"],
            "hints": rt["best"]["hints"], "evals": rt["evals"],
            "lower_bound": True, "restart_pct": rt["search"]["restart_pct"],
            "rematch_restart_pct": rm["search"]["restart_pct"],
            "recheck_withdrawn": rt["best"]["recheck_withdrawn_kzt"],
        })

    honest = {k: honest_cost(world, rules.with_(**kw)) for k, kw in VARIANTS.items()}
    measures = []
    for k in VARIANTS:
        lib_w = sum(s["lib"][k]["withdrawn"] for s in schemes)
        hole_w = sum(s["hole"][k]["withdrawn"] for s in schemes)
        h = honest[k]
        measures.append({"key": k, "title": VARIANT_RU[k], "lib_withdrawn": lib_w,
                         "hole_withdrawn": hole_w, "delayed_per_10k": h["delayed_per_10k"],
                         "frozen_clients": h["frozen_clients"],
                         "frozen_clients_pct": h["frozen_clients_pct"]})

    rematch_w = sum(s["rematch"]["withdrawn"] for s in schemes)
    attempted = sum(s["lib"]["base"]["attempted"] for s in schemes)
    hole_attempted = sum(s["hole"]["base"]["attempted"] for s in schemes)
    rematch_attempted = sum(s["rematch"]["attempted"] for s in schemes)
    base = measures[0]
    holes = [s for s in schemes if s["hole"]["base"]["withdrawn"] > s["lib"]["base"]["withdrawn"] * 1.05]
    summary = {
        "schemes": len(schemes),
        "holes_found": len(holes),
        "attempted": attempted,
        "lib_withdrawn": base["lib_withdrawn"],
        "hole_withdrawn": base["hole_withdrawn"],
        "lib_pct": _pct(base["lib_withdrawn"], attempted),
        # у найденной схемы свой объём попыток (дробление меняет число переводов): доли считаем к нему
        "hole_attempted": hole_attempted,
        "hole_pct": _pct(base["hole_withdrawn"], hole_attempted),
        "rematch_withdrawn": rematch_w,
        "rematch_attempted": rematch_attempted,
        "rematch_pct": _pct(rematch_w, rematch_attempted),
        "lower_bound": True,   # найденное ИИ - нижняя оценка: на экране «не меньше»
    }
    return {
        "synthetic": True,
        "bank": {"name": name, "calib": calib, "preset": preset_id(calib),
                 "clients": len(world.clients), "honest_tx": len(world.honest),
                 "rules": {k: getattr(rules, k) for k in RULE_KEYS}},
        "summary": summary,
        "schemes": schemes,
        "measures": measures,
        "recommendations": recommend(schemes, measures, rules, rematch_w),
        "caveats": [
            "Цифровой двойник: клиенты и переводы смоделированы, реальных данных нет.",
            "Параметры двойника и пороги правил - гипотезы. Суточные лимиты банков РК "
            "публично не найдены, они заданы калибровкой.",
            "Суммы - за одни сутки атаки в двойнике, это не прогноз потерь реального банка.",
            "Задержка первого перевода новому получателю в РК для переводов не действует, "
            "это сценарий для обсуждения.",
            "Модель обучена только на синтетике; честная проверка - на схеме, которой "
            "модель не видела при обучении (model/benchmark.json).",
        ],
    }


def recommend(schemes: List[dict], measures: List[dict], rules: Rules,
              rematch_w: float = 0) -> List[dict]:
    """Рекомендации из чисел отчёта: что закрыть первым и какой ценой."""
    out: List[dict] = []
    base = measures[0]
    # 1. лучшая мера: больше всего спасённых денег на дырах на один задержанный честный перевод
    best: Tuple[float, Optional[dict]] = (-1.0, None)
    for m in measures[1:]:
        saved = base["hole_withdrawn"] - m["hole_withdrawn"]
        extra = max(0.1, m["delayed_per_10k"] - base["delayed_per_10k"])
        score = saved / extra
        if saved > 0 and score > best[0]:
            best = (score, m)
    if best[1]:
        m = best[1]
        saved = base["hole_withdrawn"] - m["hole_withdrawn"]
        out.append({
            "title": f"Первым шагом: {m['title'].lower()}",
            "text": (f"На найденных дырах потери падают с {_mln(base['hole_withdrawn'])} до "
                     f"{_mln(m['hole_withdrawn'])} за сутки (минус {_pct(saved, base['hole_withdrawn']):.0f}%). "
                     f"Цена: задержано {_d(m['delayed_per_10k'])} честных переводов на 10 тыс. "
                     f"вместо {_d(base['delayed_per_10k'])}, заморожено честных клиентов: "
                     f"{m['frozen_clients']} вместо {base['frozen_clients']}."),
            "kind": "measure"})
    # 2. гонка вооружений: повторный поиск против модели
    found = [s for s in schemes if s["rematch"]["withdrawn"] > 0]
    out.append({
        "title": "Повторять краш-тест после каждого изменения",
        "text": (f"Дыры искались против текущих правил. Когда включена модель, ИИ-мошенник "
                 f"ищет заново и находит обход в {len(found)} схемах из {len(schemes)}: "
                 f"{_mln(rematch_w)} за сутки. Защита без повторной проверки устаревает."
                 if found else
                 "Повторный поиск ИИ-мошенника против модели обхода не нашёл. Повторять "
                 "краш-тест при каждом изменении правил и появлении новой схемы."),
        "where": [s["title"].lower() for s in found], "kind": "rematch"})
    # 3. самая дорогая дыра
    worst = max(schemes, key=lambda s: s["hole"]["base"]["withdrawn"])
    w = worst["hole"]["base"]
    silent = len(worst["silent_rules"])
    out.append({
        "title": f"Самая дорогая дыра: {worst['title'].lower()}",
        "text": (f"Вариант ИИ-мошенника выводит {_mln(w['withdrawn'])} из {_mln(w['attempted'])} "
                 f"({_pct(w['withdrawn'], w['attempted']):.0f}%), молчат {silent} из 6 правил. "
                 f"Перепроверка на трёх других атаках: "
                 + ", ".join(_mln(x) for x in worst["recheck_withdrawn"]) + "."),
        "kind": "hole"})
    # 4. поправки правил из подсказок ИИ-мошенника (без повторов)
    seen: Dict[str, List[str]] = {}
    for s in schemes:
        for h in s["hints"]:
            seen.setdefault(_hint_key(h), [h, []])[1].append(s["title"].lower())  # type: ignore
    for k, (text, where) in seen.items():
        out.append({"title": _HINT_TITLE.get(k, "Поправка правила"),
                    "text": text, "where": where, "kind": "rule"})
    return out


_HINT_TITLE = {
    "chunk": "Считать сумму новому получателю за 24 часа",
    "age": "Не доверять возрасту карты",
    "phone": "Связи по телефону искать по графу",
    "pause": "Замораживать быстрее, чем жертва заметит",
    "late": "Нужна реакция в реальном времени",
    "silent": "Отдельные переводы выглядят обычными",
}


def _hint_key(h: str) -> str:
    if h.startswith("Жертвы платят частями"):
        return "chunk"
    if h.startswith("Дроп-карты старше"):
        return "age"
    if h.startswith("На одном телефоне"):
        return "phone"
    if h.startswith("Деньги уходят дальше"):
        return "pause"
    if h.startswith("Правила замечают все цепочки"):
        return "late"
    if h.startswith("Ни одно правило"):
        return "silent"
    return h[:40]


def _mln(x: float) -> str:
    if x < 50_000:
        return "0 ₸" if x <= 0 else f"{int(x):,} ₸".replace(",", " ")
    return f"{x / 1e6:.1f}".replace(".", ",") + " млн ₸"


def _d(x: float) -> str:
    return str(x).replace(".", ",")
