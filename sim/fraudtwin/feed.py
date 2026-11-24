"""Лента переводов для интерфейса (шаг «Защита»): риск и причина словами по каждому
переводу атаки и честные переводы, которые задела мера.

Только экспорт. Логика симулятора не меняется: оценка снимается перехватом on_tx и
обёрткой вокруг _log / _tx одного прогона, состояние счётов не трогается
(tests/test_feed.py сверяет метрики и журнал с обычным прогоном).

Риск перевода = большее из двух: оценка модели по карте отправителя (те же признаки,
что у движка в момент перевода) и по карте получателя (как на экране клиента).
"""
from __future__ import annotations

from typing import Dict, List, Optional

from .world import World, WATCHED_CHANNELS
from .rules import Rules
from .schemes import AttackPlan
from .engine import Sim, ATTACK_KINDS
from .model import Scorer, default_scorer
from .client_check import (NORMAL, IDX, _logit, _days, _minutes, _plural, _n, recipient_view,
                           vector, thresholds)

HONEST_LIMIT = 40      # сколько задержанных честных переводов отдаём строками (счётчик полный)


def _short(key: str, v: dict, sender: bool) -> Optional[str]:
    """Причина одной строкой для таблицы. Факты те же, что на экране клиента."""
    card = "карты отправителя" if sender else "карты получателя"
    if key == "young" and v["age_days"] < 365:
        return f"Возраст {card}: {_days(int(v['age_days']))}"
    if key == "phone" and v["phone_share"] >= 2:
        return f"На одном номере телефона {_plural(v['phone_share'], 'карта', 'карты', 'карт')}"
    if key == "strangers":
        k = v["n_new_src"] or v["n_src"]
        return f"За сутки прислали {_plural(k, 'новый отправитель', 'новых отправителя', 'новых отправителей')}" if k >= 2 else None
    if key == "transit" and v["in_kzt"] > 0 and (sender or v["out_kzt"] > 0):
        if sender:
            return f"Пришло {_n(v['in_kzt'])}\u00a0₸ и через {_minutes(v['dwell_min'])} уходит дальше"
        return f"Деньги с карты получателя уходят дальше через {_minutes(v['dwell_min'])}"
    if key == "chain" and v["max_src_pass"] > 0.3:
        return "Деньги пришли с транзитных карт"
    if key == "new_recipient" and not sender:
        return "Получатель новый для отправителя"
    return None


def _why(sc: Scorer, x: List[float], v: dict, sender: bool, k: int = 2) -> str:
    """Главные причины: насколько падает риск, если группу признаков сделать обычной."""
    base = _logit(sc(x))
    out = []
    for key, repl in NORMAL.items():
        y = list(x)
        for f, val in repl.items():
            y[IDX[f]] = val
        delta = base - _logit(sc(y))
        text = _short(key, v, sender)
        if text and delta > 0.1:
            out.append((delta, text))
    out.sort(key=lambda r: -r[0])
    return ". ".join(t for _, t in out[:k])


def _sender_x(sim: Sim, tx, t: float) -> Optional[List[float]]:
    """Признаки отправителя как у движка. _features правит только кэш pas: возвращаем его."""
    if tx.src < 0 or tx.channel not in WATCHED_CHANNELS:
        return None
    a = sim._a(tx.src)
    pas = a.pas
    new_out = bool(tx.dst >= 0 and tx.dst not in a.known)
    x = sim._features(tx.src, a, t, tx.amount, new_out, tx.channel)
    a.pas = pas
    return x


def assess(sim: Sim, t: float, tx, sc: Scorer) -> dict:
    """Риск и причина одного перевода на момент t, до решения движка."""
    medium = thresholds(sc)["medium"]
    best = {"risk": 0.0, "why": "", "side": ""}
    x = _sender_x(sim, tx, t)
    if x is not None:
        s = float(sc(x))
        if s >= medium:
            best = {"risk": s, "why": _why(sc, x, recipient_view(sim, tx.src, t), True), "side": "src"}
        else:
            best["risk"] = s
    if tx.dst >= 0:
        v = recipient_view(sim, tx.dst, t)
        if v["frozen"]:
            return {"risk": 1.0, "why": "Карта получателя уже заморожена банком", "side": "dst"}
        if v["n_in"] >= 1:
            a = sim.acc.get(tx.src)
            new_rec = a is None or tx.dst not in a.known
            xr = vector(v, tx.amount, new_rec, t)
            s = float(sc(xr))
            if s > best["risk"]:
                best = {"risk": s, "why": _why(sc, xr, v, False) if s >= medium else "", "side": "dst"}
        elif best["risk"] < medium and tx.kind == "victim":
            best["why"] = "У карты получателя нет движения за сутки: модели нечего оценить"
    best["risk"] = round(best["risk"], 3)
    return best


def run_attack_feed(world: World, rules: Rules, plan: AttackPlan, seed: int = 11,
                    scorer: Optional[Scorer] = None) -> Sim:
    """run_attack, но в каждой записи журнала есть risk, why и side."""
    sc = scorer or default_scorer()
    sim = Sim(world, rules, plan, all_honest=False, seed=seed, scorer=scorer)
    notes: Dict[int, dict] = {}

    def hook(s: Sim, t: float, tx) -> None:
        if tx.kind in ATTACK_KINDS:
            notes[id(tx)] = assess(s, t, tx, sc)

    plain_log = sim._log

    def log(tx, t: float, status: str, rule: str = "") -> None:
        plain_log(tx, t, status, rule)
        n = notes.get(id(tx))
        if n:
            sim.log[-1].update(n)

    sim.on_tx = hook
    sim._log = log        # обёртка одного прогона, класс Sim не меняется
    return sim.run()


def honest_feed(world: World, rules: Rules, scorer: Optional[Scorer] = None) -> dict:
    """Честные переводы, которые задела мера: прогон всего честного трафика без атаки.
    Счётчики совпадают с honest_cost, строки - те самые переводы."""
    sc = scorer or default_scorer()
    sim = Sim(world, rules, None, all_honest=True, scorer=sc)
    rows: List[dict] = []
    total = {"blocked": 0, "suspended": 0, "held": 0}
    plain_tx = sim._tx

    def tx_(t: float, tx, released: bool = False) -> None:
        before = (sim.h_blocked, sim.h_suspended, sim.h_held)
        note = None
        if not released and rules.model_on and tx.kind == "honest":
            x = _sender_x(sim, tx, t)
            if x is not None:
                note = (x, recipient_view(sim, tx.src, t))
        plain_tx(t, tx, released)
        after = (sim.h_blocked, sim.h_suspended, sim.h_held)
        if after == before:
            return
        if after[0] > before[0]:
            status = "blocked"
            rule = "amount_limit" if tx.amount > rules.amount_limit else "daily_limit"
            risk, why = None, ("Сумма выше лимита одного перевода" if rule == "amount_limit"
                               else "Превышен суточный лимит исходящих")
        elif after[1] > before[1]:
            status, rule = "suspended", "model"
            risk = round(float(sc(note[0])), 3) if note else None
            why = _why(sc, note[0], note[1], True) if note else ""
        else:
            status, rule = "held", "first_hold"
            risk, why = None, f"Первый перевод новому получателю: задержка {int(rules.first_hold_min)} мин"
        total[status] += 1
        if status != "held" or total["held"] <= HONEST_LIMIT:
            rows.append({"t": round(t, 1), "src": tx.src, "dst": tx.dst, "amount": tx.amount,
                         "kind": "honest", "status": status, "rule": rule, "channel": tx.channel,
                         "risk": risk, "why": why})

    sim._tx = tx_
    sim.run()
    return {"rows": rows, "total": total, "watched": sim.h_watched}
