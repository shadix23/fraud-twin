"""«Как это видит клиент»: оценка получателя ДО перевода и причины простыми словами.

Обученная модель (model_gbdt.json) скорит счёт по его поведению в момент, когда он
отправляет деньги. Для экрана клиента та же модель смотрит на карту получателя:
что эта карта уже сделала за последние сутки (сколько незнакомых людей прислали
деньги, как быстро они ушли дальше, возраст карты, сколько карт на одном телефоне,
транзитны ли сами отправители). Деньги клиента в расчёт не входят: перевода ещё нет.

Честное ограничение: у свежей дроп-карты истории ещё нет, поэтому первая жертва
часто проходит без предупреждения. Это число считается и показывается (stats).

    python3 -m fraudtwin.client_check --out ../app/public/scenarios
"""
from __future__ import annotations

import argparse
import json
import math
import os
from typing import Callable, Dict, List, Optional

from .engine import DAY, Sim
from .model import FEATURE_NAMES, Scorer, default_scorer
from .rules import DEFAULT_RULES, Rules
from .schemes import PRESETS, plan_attack, preset
from .world import P2P, World, generate_world

IDX = {n: i for i, n in enumerate(FEATURE_NAMES)}

# Уровни экрана. Высокий = рабочий порог модели (5 из 10 тыс. честных переводов
# при обучении). Средний подобран так, чтобы мягкую подсказку видели не больше
# ~1% честных переводов (см. stats.honest в ответе).
MEDIUM_FACTOR = 0.35          # средний порог = 0.35 * высокий
SYNTH_NOTE = "Синтетика, оценка: цифры из двойника банка, не из данных BCC."


def thresholds(scorer: Optional[Scorer] = None) -> Dict[str, float]:
    sc = scorer or default_scorer()
    hi = float(sc.threshold)
    return {"high": round(hi, 4), "medium": round(hi * MEDIUM_FACTOR, 4)}


# ---------------------------------------------------------------- признаки получателя
def recipient_view(sim: Sim, dst: int, t: float) -> dict:
    """Что карта получателя сделала за сутки до момента t. Без изменения состояния."""
    a = sim.acc.get(dst)
    ins = [x for x in a.ins if x[0] >= t - DAY] if a else []
    outs = [x for x in a.outs if x[0] >= t - DAY] if a else []
    inn = sum(x[1] for x in ins)
    out = sum(x[1] for x in outs)
    # сколько деньги лежали: от поступления до ближайшей отправки после него
    gaps = []
    for ti, *_ in ins:
        nxt = [to for to, _ in outs if to >= ti]
        if nxt:
            gaps.append(min(nxt) - ti)
    if gaps:
        dwell = sorted(gaps)[len(gaps) // 2]
    elif ins:
        dwell = t - ins[-1][0]
    else:
        dwell = DAY
    pas = 0.0
    if inn > 0 and out > 0:
        fast = 1.0 if dwell < 90 else math.exp(-(dwell - 90) / 240)
        pas = min(1.0, out / inn) * fast * min(1.0, inn / 50_000)
    c = sim.w.client(dst)
    return {
        "age_days": c.account_age_days if c else 0,
        "phone_share": sim.w.phone_share(dst),
        "in_kzt": inn, "out_kzt": out, "n_in": len(ins), "n_out": len(outs),
        "n_src": len({x[2] for x in ins}), "n_new_src": len({x[2] for x in ins if x[4]}),
        "max_src_pass": max((x[3] for x in ins), default=0.0),
        "dwell_min": min(dwell, DAY), "pass_through": pas,
        "frozen": sim._frozen(dst, t),
    }


def vector(v: dict, amount: int, new_recipient: bool, t: float) -> List[float]:
    """Вектор в порядке model.FEATURE_NAMES (как у дропа в момент пересылки)."""
    inn, out = v["in_kzt"], v["out_kzt"]
    return [
        math.log1p(amount), 1.0 if new_recipient else 0.0,
        math.log1p(v["age_days"]), float(v["phone_share"]),
        math.log1p(inn), math.log1p(out), min(5.0, out / inn) if inn > 0 else 0.0,
        v["dwell_min"], float(v["n_in"]), float(v["n_src"]), float(v["n_new_src"]),
        float(max(1, v["n_out"])), v["max_src_pass"], (t % DAY) / 60.0, 0.0, v["pass_through"],
    ]


# ---------------------------------------------------------------- причины словами
# Группа признаков -> «как у обычной карты». Вклад группы = насколько падает риск,
# если эти признаки сделать обычными (occlusion, честно для деревьев).
NORMAL = {
    "young": {"log_account_age": math.log1p(1000)},
    "phone": {"phone_share": 1.0},
    "strangers": {"n_in_24h": 1.0, "n_src_24h": 1.0, "n_new_src_24h": 0.0,
                  "log_in_24h": math.log1p(15_000)},
    "transit": {"pass_through": 0.0, "out_in_ratio": 0.0, "dwell_min": DAY,
                "log_out_24h": 0.0, "n_out_24h": 1.0},
    "chain": {"max_src_pass": 0.0},
    "new_recipient": {"new_recipient": 0.0},
}


def _n(x: float) -> str:
    # неразрывные пробелы: сумма не рвётся между разрядами и перед знаком валюты на узком экране
    return f"{int(round(x)):,}".replace(",", "\u00a0")


def _plural(n: int, one: str, few: str, many: str) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return f"{n} {one}"
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return f"{n} {few}"
    return f"{n} {many}"


def _days(d: int) -> str:
    return _plural(d, "день", "дня", "дней")


def _minutes(m: float) -> str:
    m = max(1, int(round(m)))
    if m >= 120:
        h = round(m / 60)
        return f"{h} ч"
    return f"{m} мин"


def reason_text(key: str, v: dict) -> Optional[str]:
    if key == "young":
        return f"Карте всего {_days(int(v['age_days']))}." if v["age_days"] < 365 else None
    if key == "phone":
        n = v["phone_share"]
        return (f"На один номер телефона в банке оформлено {_plural(n, 'карта', 'карты', 'карт')} "
                f"разных людей.") if n >= 2 else None
    if key == "strangers":
        k = v["n_new_src"] or v["n_src"]
        if k < 2:
            return None
        return (f"За сутки на эту карту прислали деньги {_plural(k, 'человек', 'человека', 'человек')}, "
                f"которые раньше ей не переводили. Всего {_n(v['in_kzt'])}\u00a0₸.")
    if key == "transit":
        if v["out_kzt"] <= 0 or v["in_kzt"] <= 0:
            return None
        return (f"За сутки на карту пришло {_n(v['in_kzt'])}\u00a0₸ и примерно через "
                f"{_minutes(v['dwell_min'])} ушло дальше. Деньги здесь не задерживаются.")
    if key == "new_recipient":
        return "Вы раньше не переводили деньги этому получателю."
    if key == "chain":
        return ("Деньги на эту карту приходят с карт, которые тоже сразу "
                "пересылают их дальше. Так выглядит цепочка дропов.") if v["max_src_pass"] > 0.3 else None
    return None


def _logit(p: float) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def explain(scorer: Scorer, x: List[float], v: dict, k: int = 3) -> List[dict]:
    """Вклад группы в лог-шансах: при насыщенном риске (0,99) вероятность почти не
    меняется, а лог-шансы показывают, какой признак тянет сильнее."""
    base = _logit(scorer(x))
    out = []
    for key, repl in NORMAL.items():
        y = list(x)
        for f, val in repl.items():
            y[IDX[f]] = val
        delta = base - _logit(scorer(y))
        text = reason_text(key, v)
        if text and delta > 0.1:
            out.append({"key": key, "text": text, "weight": round(delta, 2)})
    out.sort(key=lambda r: -r["weight"])
    return out[:k]


# ---------------------------------------------------------------- проверка одного перевода
def level_of(score: float, thr: Dict[str, float]) -> str:
    if score >= thr["high"]:
        return "high"
    return "medium" if score >= thr["medium"] else "low"


ACTION = {"high": "cancel", "medium": "confirm", "low": "proceed", "blocked": "blocked"}


def check(sim: Sim, t: float, src: int, dst: int, amount: int,
          scorer: Optional[Scorer] = None, explain_k: int = 3) -> dict:
    """Оценка получателя перед переводом.

    basis: flow - у карты за сутки было движение денег, модель его оценила;
           no_history - движения не было, модели нечего оценивать (риск low);
           blocked - карта уже заморожена правилами банка, перевод не пройдёт.
    """
    sc = scorer or sim.scorer
    thr = thresholds(sc)
    sa = sim.acc.get(src)
    c = sim.w.client(src)
    known = sa.known if sa is not None else set(c.friends if c else [])
    new_rec = dst not in known
    v = recipient_view(sim, dst, t)
    x = vector(v, amount, new_rec, t)
    if v["frozen"]:
        basis, score = "blocked", 1.0
    elif v["n_in"] >= 1:
        basis, score = "flow", sc(x)
    else:
        basis, score = "no_history", 0.0
    lvl = "blocked" if basis == "blocked" else level_of(score, thr)
    reasons: List[dict] = []
    if basis == "blocked":
        reasons = [{"key": "blocked", "weight": 1.0,
                    "text": "Банк уже приостановил операции по этой карте."}]
    elif explain_k and lvl != "low":
        reasons = explain(sc, x, v, explain_k)
    return {"score": round(score, 4), "level": lvl, "action": ACTION[lvl], "basis": basis,
            "new_recipient": new_rec,
            "recipient": {k: (round(val, 3) if isinstance(val, float) else val) for k, val in v.items()},
            "reasons": reasons}


# ---------------------------------------------------------------- прогоны и честные цифры
def probe_attack(world: World, plan, rules: Rules = DEFAULT_RULES,
                 scorer: Optional[Scorer] = None) -> List[dict]:
    """Проверка получателя перед каждой жертвой: первая часть перевода = момент решения.
    Прогон с правилами банка как есть (модель в блокировке не участвует)."""
    rows: List[dict] = []
    seen: set = set()
    by_drop: Dict[int, int] = {}

    def hook(sim: Sim, t: float, tx) -> None:
        if tx.kind != "victim" or (tx.src, tx.dst) in seen:
            return
        seen.add((tx.src, tx.dst))
        r = check(sim, t, tx.src, tx.dst, tx.amount, scorer, explain_k=3)
        r.update(t=round(t, 1), src=tx.src, dst=tx.dst, amount=tx.amount, chain=tx.chain,
                 victim_no=by_drop.get(tx.dst, 0) + 1)
        by_drop[tx.dst] = r["victim_no"]
        rows.append(r)

    sim = Sim(world, rules, plan, scorer=scorer)
    sim.on_tx = hook
    sim.run()
    return rows


_HONEST: Dict[tuple, dict] = {}


def probe_honest(world: World, rules: Rules = DEFAULT_RULES, scorer: Optional[Scorer] = None) -> dict:
    """Ложные предупреждения: все честные переводы P2P клиенту банка за сутки, без атаки."""
    sc = scorer or default_scorer()
    key = (id(world), len(world.clients), id(sc), tuple(sorted(rules.to_dict().items())))
    if key in _HONEST:
        return _HONEST[key]
    cnt = {"low": 0, "medium": 0, "high": 0, "blocked": 0}
    example: Dict[str, dict] = {}

    def hook(sim: Sim, t: float, tx) -> None:
        if tx.kind != "honest" or tx.channel != P2P or tx.src < 0 or tx.dst < 0:
            return
        r = check(sim, t, tx.src, tx.dst, tx.amount, sc, explain_k=0)
        cnt[r["level"]] += 1
        # честный крупный перевод новому получателю: пример экрана «всё в порядке»
        if r["level"] == "low" and r["new_recipient"] and r["basis"] == "flow":
            best = example.get("low")
            if best is None or abs(tx.amount - 579_000) < abs(best["amount"] - 579_000):
                r.update(t=round(t, 1), src=tx.src, dst=tx.dst, amount=tx.amount)
                example["low"] = r

    sim = Sim(world, rules, None, all_honest=True, scorer=sc)
    sim.on_tx = hook
    sim.run()
    n = max(1, sum(cnt.values()))
    per = lambda k: round(cnt[k] * 10_000 / n, 1)
    res = {"honest_p2p_tx": n, "warned_high": cnt["high"], "warned_medium": cnt["medium"],
           "blocked_by_rules": cnt["blocked"],
           "high_per_10k": per("high"), "medium_per_10k": per("medium"),
           "warned_per_10k": round((cnt["high"] + cnt["medium"]) * 10_000 / n, 1),
           "blocked_by_rules_per_10k": per("blocked"),
           "example": example.get("low")}
    _HONEST[key] = res
    return res


def victim_stats(rows: List[dict], cancel_share: float = DEFAULT_RULES.hold_victim_cancel_p) -> dict:
    """Сколько жертв увидели бы предупреждение до перевода.
    warned = high или medium от модели; blocked = карта уже заморожена правилами
    (перевод не пройдёт и без экрана, в заслугу экрану не засчитывается)."""
    n = len(rows)
    lv = lambda r: r["level"]
    hi = sum(1 for r in rows if lv(r) == "high")
    med = sum(1 for r in rows if lv(r) == "medium")
    blk = sum(1 for r in rows if lv(r) == "blocked")
    first = [r for r in rows if r["victim_no"] == 1]
    later = [r for r in rows if r["victim_no"] > 1]
    pct = lambda a, b: round(100 * a / b, 1) if b else 0.0
    warned_kzt = sum(r["amount"] for r in rows if lv(r) in ("high", "medium"))
    return {
        "victims": n, "warned": hi + med, "warned_high": hi, "warned_medium": med,
        "warned_pct": pct(hi + med, n), "blocked_by_rules": blk, "blocked_pct": pct(blk, n),
        "silent": n - hi - med - blk, "silent_pct": pct(n - hi - med - blk, n),
        "first_on_card": len(first),
        "first_on_card_silent": sum(1 for r in first if lv(r) == "low"),
        "first_on_card_silent_pct": pct(sum(1 for r in first if lv(r) == "low"), len(first)),
        "repeat_on_card": len(later),
        "repeat_on_card_warned": sum(1 for r in later if lv(r) in ("high", "medium")),
        "repeat_on_card_warned_pct": pct(sum(1 for r in later if lv(r) in ("high", "medium")), len(later)),
        "repeat_on_card_blocked": sum(1 for r in later if lv(r) == "blocked"),
        "repeat_on_card_silent": sum(1 for r in later if lv(r) == "low"),
        "first_part_kzt": sum(r["amount"] for r in rows),
        "warned_kzt": warned_kzt,
        "cancel_share_hypothesis": cancel_share,
        "saved_kzt_est": int(warned_kzt * cancel_share),
    }


# ---------------------------------------------------------------- экран телефона
SCREEN = {
    "high": {
        "title": "Похоже на карту дроппера",
        "subtitle": "Мы приостановили перевод, деньги пока у вас. Вот что нас насторожило:",
        "question": "Вам звонили и просили срочно перевести деньги? Сотрудники банка и полиции так не делают.",
        "buttons": [{"id": "cancel", "label": "Отменить перевод", "primary": True},
                    {"id": "call", "label": "Позвонить в банк"},
                    {"id": "send_anyway", "label": "Всё равно отправить", "quiet": True}],
        "footnote": "Банк вправе приостановить перевод и обязан назвать причину (Закон РК о платежах, ст. 25-1, сверить).",
    },
    "medium": {
        "title": "Проверьте получателя",
        "subtitle": "Перевод ещё не отправлен. С этой картой есть странности:",
        "question": "Вы знаете этого человека лично? Если вас торопят по телефону, лучше отменить.",
        "buttons": [{"id": "send", "label": "Продолжить перевод", "primary": True},
                    {"id": "cancel", "label": "Отменить"}],
        "footnote": "",
    },
    "low": {
        "title": "Перевод отправлен",
        "subtitle": "Получатель проверен, ничего подозрительного.",
        "question": "",
        "buttons": [{"id": "done", "label": "Готово", "primary": True}],
        "footnote": "",
    },
    "blocked": {
        "title": "Перевод не выполнен",
        "subtitle": "Операции по карте получателя приостановлены банком. Деньги остались у вас.",
        "question": "Если вас просили перевести срочно, позвоните в банк по номеру на обороте карты.",
        "buttons": [{"id": "call", "label": "Позвонить в банк", "primary": True},
                    {"id": "done", "label": "Закрыть"}],
        "footnote": "",
    },
}

AFTER = {   # что показать после нажатия кнопки
    "cancel": "Перевод отменён. Деньги остались на вашей карте.",
    "call": "Соединяем с банком. Не называйте коды из SMS никому, даже сотруднику банка.",
    "send_anyway": "Перевод отправлен. Если поймёте, что это обман, сразу звоните в банк.",
}

NAMES = ["Ерлан С.", "Айдос Н.", "Данияр К.", "Мадина Т.", "Руслан Б.", "Алия Ж.", "Нурлан А.", "Асель М."]


def _hhmm(t: float) -> str:
    m = int(t) % int(DAY)
    return f"{m // 60:02d}:{m % 60:02d}"


def screen_case(r: dict) -> dict:
    """Один перевод в формате экрана. Имя, номер и карта - условные, по id получателя."""
    d = r["dst"]
    lvl = r["level"]
    return {
        "transfer": {"amount": r["amount"], "time": _hhmm(r["t"]), "new_recipient": r["new_recipient"],
                     "recipient": {"name": NAMES[d % len(NAMES)],
                                   "phone_mask": f"+7 7{d % 10}{(d // 10) % 10} *** ** {d % 100:02d}",
                                   "card_mask": f"**** {1000 + d % 9000}"}},
        "risk": {"score": r["score"], "level": lvl, "basis": r["basis"]},
        "reasons": [{"key": x["key"], "text": x["text"]} for x in r["reasons"]],
        "action": r["action"],
        "screen": SCREEN[lvl],
        "recipient_facts": r["recipient"],
    }


def _pick(rows: List[dict], pred: Callable[[dict], bool], target: int = 579_000) -> Optional[dict]:
    c = [r for r in rows if pred(r)]
    if not c:
        return None
    return min(c, key=lambda r: (len(r["reasons"]) < 2, abs(r["amount"] - target),
                                 -len(r["reasons"]), -r["score"]))


def client_payload(world: World, scheme: str, rules: Rules = DEFAULT_RULES,
                   overrides: Optional[dict] = None, title: Optional[str] = None,
                   scorer: Optional[Scorer] = None) -> dict:
    """Экран «Как это видит клиент»: главный случай (high), свежая карта (low, первая
    жертва), честный перевод (low), средний риск, если встретился, и честные цифры."""
    sc = scorer or default_scorer()
    world.clear_attack()
    plan = plan_attack(world, preset(scheme, **(overrides or {})), seed=1)
    rows = probe_attack(world, plan, rules, sc)
    world.clear_attack()
    honest = probe_honest(world, rules, sc)
    cases = {}
    hi = _pick(rows, lambda r: r["level"] == "high")
    if hi:
        cases["high"] = screen_case(hi)
    med = _pick(rows, lambda r: r["level"] == "medium")
    if med:
        cases["medium"] = screen_case(med)
    fresh = _pick(rows, lambda r: r["level"] == "low" and r["victim_no"] == 1)
    if fresh:
        cases["fresh_card"] = screen_case(fresh)
    if honest["example"]:
        cases["honest"] = screen_case(honest["example"])
    hstats = {k: v for k, v in honest.items() if k != "example"}
    return {
        "synthetic": True,
        "note": SYNTH_NOTE,
        "scheme": {"key": scheme, "title": title or PRESETS[scheme].title, "hole": bool(overrides)},
        "model": {"name": getattr(sc, "name", "модель"), "thresholds": thresholds(sc),
                  "how": "Та же обученная модель оценивает карту получателя по её движению денег "
                         "за сутки до перевода. Деньги клиента ещё никуда не ушли."},
        "demo": "high" if "high" in cases else next(iter(cases), None),
        "cases": cases,
        "after": AFTER,
        "stats": {"victims": victim_stats(rows), "honest": hstats},
    }


def hole_overrides(world: World, scheme: str, rules: Rules = DEFAULT_RULES, strong: bool = False) -> dict:
    """Дыра для демо клиента. strong=True (экспорт готовых прогонов): большой бюджет поиска;
    живой API считает короткий поиск, как /redteam."""
    from .redteam import search_live, search_strong
    world.clear_attack()
    res = (search_strong if strong else search_live)(world, scheme, rules)
    world.clear_attack()
    return dict(res["overrides"])


def all_schemes(world: World, rules: Rules = DEFAULT_RULES, hole: Optional[dict] = None,
                hole_scheme: str = "student_crypto", scorer: Optional[Scorer] = None) -> List[dict]:
    """Сводка по библиотеке схем (+ найденная дыра): сколько жертв предупреждены."""
    out = []
    items = [(k, None) for k in PRESETS] + ([(hole_scheme, hole)] if hole else [])
    for key, ov in items:
        world.clear_attack()
        rows = probe_attack(world, plan_attack(world, preset(key, **(ov or {})), seed=1), rules, scorer)
        world.clear_attack()
        s = victim_stats(rows)
        out.append({"key": key, "hole": bool(ov),
                    "title": ("Найденная дыра: " + PRESETS[key].title.lower()) if ov else PRESETS[key].title,
                    **{k: s[k] for k in ("victims", "warned", "warned_pct", "blocked_by_rules", "silent",
                                          "first_on_card", "first_on_card_silent", "repeat_on_card",
                                          "repeat_on_card_warned", "repeat_on_card_warned_pct",
                                          "repeat_on_card_blocked", "repeat_on_card_silent")}})
    return out


def demo_payload(world: World, rules: Rules = DEFAULT_RULES, scheme: str = "student_crypto",
                 overrides: Optional[dict] = None) -> dict:
    """Демо-экран: дыра, найденная ИИ-мошенником (переводы частями по 579 тыс. ₸)."""
    ov = overrides if overrides is not None else hole_overrides(world, scheme, rules)
    p = client_payload(world, scheme, rules, ov,
                       title="Найденная дыра: " + PRESETS[scheme].title.lower())
    p["by_scheme"] = all_schemes(world, rules, ov, scheme)
    return p


COUNT_KEYS = ("victims", "warned", "blocked_by_rules", "silent", "first_on_card", "first_on_card_silent",
              "repeat_on_card", "repeat_on_card_warned", "repeat_on_card_blocked", "repeat_on_card_silent")


def robust_stats(world: World, rules: Rules, scheme: str, overrides: dict,
                 attack_seeds: int = 8, honest_worlds: int = 6) -> dict:
    """Те же цифры на 8 случайных атаках дыры и 6 других демо-мирах (меньше шума выборки)."""
    from .world import BankProfile
    agg = {k: 0 for k in COUNT_KEYS}
    for seed in range(1, attack_seeds + 1):
        world.clear_attack()
        s = victim_stats(probe_attack(world, plan_attack(world, preset(scheme, **overrides), seed=seed), rules))
        world.clear_attack()
        for k in COUNT_KEYS:
            agg[k] += s[k]
    h = {"n": 0, "high": 0, "medium": 0, "blocked": 0}
    for i in range(1, honest_worlds + 1):
        r = probe_honest(generate_world(BankProfile(seed=i * 101)), rules)
        h["n"] += r["honest_p2p_tx"]
        h["high"] += r["warned_high"]
        h["medium"] += r["warned_medium"]
        h["blocked"] += r["blocked_by_rules"]
    pct = lambda a, b: round(100 * a / b, 1) if b else 0.0
    return {
        "attack_seeds": attack_seeds, "honest_worlds": honest_worlds,
        "victims": {**agg, "warned_pct": pct(agg["warned"], agg["victims"]),
                    "blocked_pct": pct(agg["blocked_by_rules"], agg["victims"]),
                    "silent_pct": pct(agg["silent"], agg["victims"]),
                    "first_on_card_silent_pct": pct(agg["first_on_card_silent"], agg["first_on_card"]),
                    "repeat_on_card_covered_pct": pct(agg["repeat_on_card_warned"] + agg["repeat_on_card_blocked"],
                                                      agg["repeat_on_card"])},
        "honest": {"honest_p2p_tx": h["n"], "warned_high": h["high"], "warned_medium": h["medium"],
                   "high_per_10k": round(h["high"] * 10_000 / max(1, h["n"]), 1),
                   "warned_per_10k": round((h["high"] + h["medium"]) * 10_000 / max(1, h["n"]), 1),
                   "blocked_by_rules_per_10k": round(h["blocked"] * 10_000 / max(1, h["n"]), 1)},
    }


def main() -> None:
    from .report import calib_profile, calib_rules, normalize
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "app",
                                                  "public", "scenarios"))
    args = ap.parse_args()
    c = normalize(None)
    world = generate_world(calib_profile(c))
    rules = calib_rules(c)
    ov = hole_overrides(world, "student_crypto", rules, strong=True)
    data = demo_payload(world, rules, overrides=ov)
    data["robust"] = robust_stats(world, rules, "student_crypto", ov)
    from .i18n import LANGS, translate
    # ru/, en/ и старый путь <out>/client_check.json (копия ru, пока фронт не переехал)
    for d, lang in [(os.path.join(args.out, lg), lg) for lg in LANGS] + [(args.out, "ru")]:
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, "client_check.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(translate(data, lang), f, ensure_ascii=False, separators=(",", ":"))
        print(path)
    print(json.dumps(data["robust"], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
