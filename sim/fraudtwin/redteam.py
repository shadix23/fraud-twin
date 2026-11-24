"""ИИ-мошенник: эволюционный поиск параметров схемы, которые обходят правила банка.

Это оптимизатор, а не нейросеть. Цель мошенника: выведено ₸ минус стоимость схемы
(выплаты дропам). Число жертв и суммы фиксированы пресетом, меняется «как» -
дробление, пауза, слои, возраст и телефоны дроп-карт, канал вывода.
Популяция 20, 10 поколений = 200 прогонов симулятора (~1-3 с на Mac),
лучший вариант перепроверяется на трёх случайных зёрнах атаки.
"""
from __future__ import annotations

import math
import random
import time
from dataclasses import replace
from typing import Dict, List, Tuple

from .engine import run_attack
from .rules import Rules, DEFAULT_RULES
from .schemes import PRESETS, SchemeParams, plan_attack, preset
from .world import World

# (тип, мин, макс) - log: непрерывный в лог-шкале, int: целый, choice: варианты
GENES: Dict[str, tuple] = {
    "victim_chunk_max": ("log", 30_000, 1_500_000),
    "layers": ("int", 1, 3),
    "fan_out": ("int", 1, 3),
    "pause_min": ("log", 2, 360),
    "chunk_max": ("log", 30_000, 1_200_000),
    "chunk_gap_min": ("log", 1, 90),
    "drop_age_days": ("log", 3, 400),
    "drops_per_phone": ("int", 1, 6),
    "cashout": ("choice", ("crypto", "atm", "ext", "crypto+atm", "atm+ext")),
}
PARAM_RU = {
    "victim_chunk_max": "жертва платит частями", "layers": "слоёв дропов",
    "fan_out": "ветвление", "pause_min": "пауза дропа, мин",
    "chunk_max": "части дропа до", "chunk_gap_min": "между частями, мин",
    "drop_age_days": "возраст карты, дней", "drops_per_phone": "карт на телефон",
    "cashout": "вывод",
}
CASHOUT = {"crypto": {"crypto": 1.0}, "atm": {"atm": 1.0}, "ext": {"ext": 1.0},
           "crypto+atm": {"crypto": 0.5, "atm": 0.5}, "atm+ext": {"atm": 0.5, "ext": 0.5}}
CASHOUT_RU = {"crypto": "крипто-обменник", "atm": "банкомат", "ext": "карта другого банка",
              "crypto+atm": "крипта и банкомат", "atm+ext": "банкомат и другой банк"}

Genome = Dict[str, object]


def _cashout_key(mix: Dict[str, float]) -> str:
    for k, v in CASHOUT.items():
        if v == mix:
            return k
    return "crypto+atm" if "crypto" in mix else "atm+ext"


def genome_of(p: SchemeParams) -> Genome:
    g = {k: getattr(p, k) for k in GENES if k != "cashout"}
    g["cashout"] = _cashout_key(p.cashout)
    return g


def params_of(base: SchemeParams, g: Genome) -> SchemeParams:
    kw = {k: v for k, v in g.items() if k != "cashout"}
    for k in ("victim_chunk_max", "chunk_max"):
        kw[k] = int(round(float(kw[k]) / 1000) * 1000)
    kw["pause_min"] = round(float(kw["pause_min"]), 1)
    kw["chunk_gap_min"] = round(float(kw["chunk_gap_min"]), 1)
    kw["drop_age_days"] = int(round(float(kw["drop_age_days"])))
    return replace(base, cashout=dict(CASHOUT[str(g["cashout"])]), **kw)


def _mutate(g: Genome, rng: random.Random, rate: float = 0.35, scale: float = 0.6) -> Genome:
    out = dict(g)
    for k, (kind, *spec) in GENES.items():
        if rng.random() > rate:
            continue
        if kind == "log":
            lo, hi = spec
            v = math.exp(math.log(float(out[k])) + rng.gauss(0, scale))
            out[k] = min(hi, max(lo, v))
        elif kind == "int":
            lo, hi = spec
            out[k] = min(hi, max(lo, int(out[k]) + rng.choice((-1, 1))))
        else:
            out[k] = rng.choice(spec[0])
    return out


def _cross(a: Genome, b: Genome, rng: random.Random) -> Genome:
    return {k: (a[k] if rng.random() < 0.5 else b[k]) for k in GENES}


def evaluate(world: World, rules: Rules, params: SchemeParams, seed: int = 1) -> Tuple[float, dict]:
    world.clear_attack()
    plan = plan_attack(world, params, seed=seed)
    m = run_attack(world, rules, plan).attack_metrics()
    world.clear_attack()
    return m["withdrawn_kzt"] - m["scheme_cost_kzt"], m


def _top_rule(m: dict) -> str:
    hits = m.get("rule_hits") or {}
    return max(hits, key=hits.get) if hits else ""


def _n(x: float) -> str:
    return f"{int(x):,}".replace(",", "\u00a0")


def hints(params: SchemeParams, rules: Rules, m: dict) -> List[str]:
    """Почему схема прошла: какие пороги она обошла. Человеческим языком."""
    out = []
    if rules.new_recipient_on and params.victim_chunk_max < rules.new_recipient_amount:
        out.append(f"Жертвы платят частями по {_n(params.victim_chunk_max)}\u00a0₸, ниже порога "
                   f"«новый получатель» {_n(rules.new_recipient_amount)}\u00a0₸. Считать сумму новому "
                   f"получателю за 24 часа, а не по одному переводу.")
    if rules.account_age_on and params.drop_age_days >= rules.account_age_days * 1.3:
        out.append(f"Дроп-карты старше {rules.account_age_days} дней (около {params.drop_age_days}): "
                   f"правило «молодой счёт» молчит. Купленные «прогретые» карты его обходят.")
    if rules.shared_phone_on and params.drops_per_phone < rules.shared_phone_n:
        out.append(f"На одном телефоне {params.drops_per_phone} карт(ы), порог правила "
                   f"{rules.shared_phone_n}. Связь видна только по графу.")
    if params.pause_min < rules.victim_notice_median_min / 4:
        out.append(f"Деньги уходят дальше через ~{params.pause_min:.0f} мин, а жертва замечает "
                   f"пропажу в среднем через {rules.victim_notice_median_min / 60:.0f} ч.")
    if m.get("chains_total") and m.get("chains_caught") == m.get("chains_total") and \
            m.get("withdrawn_kzt", 0) > 0.3 * m.get("attempted_kzt", 1):
        out.append(f"Правила замечают все цепочки, но поздно: счёт замораживается через "
                   f"{rules.reaction_delay_min:.0f} мин после сигнала, а деньги к этому времени "
                   f"уже выведены. Нужна реакция в реальном времени.")
    if not m.get("rule_hits"):
        out.append("Ни одно правило не сработало: каждый перевод по отдельности выглядит обычным.")
    return out


def search(world: World, key: str, rules: Rules = DEFAULT_RULES, pop: int = 20, gens: int = 10,
           seed: int = 5) -> dict:
    t0 = time.time()
    rng = random.Random(seed)
    base = PRESETS[key]
    base_fit, base_m = evaluate(world, rules, base)
    population = [genome_of(base)] + [_mutate(genome_of(base), rng, rate=0.6, scale=0.9)
                                      for _ in range(pop - 1)]
    history: List[dict] = []
    best: Tuple[float, Genome, dict] = (base_fit, genome_of(base), base_m)
    i = 0
    for gen in range(gens):
        scored = []
        for g in population:
            fit, m = evaluate(world, rules, params_of(base, g))
            scored.append((fit, g, m))
            i += 1
            history.append({"i": i, "gen": gen, "fit": int(fit),
                            "pct": round(100 * m["withdrawn_kzt"] / max(1, m["attempted_kzt"]), 1),
                            "caught": f"{m['chains_caught']}/{m['chains_total']}",
                            "rule": _top_rule(m)})
            if fit > best[0]:
                best = (fit, g, m)
        scored.sort(key=lambda x: -x[0])
        elite = [g for _, g, _ in scored[:2]]

        def pick():
            a, b = rng.sample(scored, 2)
            return (a if a[0] > b[0] else b)[1]
        population = elite + [_mutate(_cross(pick(), pick(), rng), rng) for _ in range(pop - 2)]

    # перепроверка лучшего на других случайных атаках
    bp = params_of(base, best[1])
    checks = [evaluate(world, rules, bp, seed=s)[1]["withdrawn_kzt"] for s in (2, 3, 4)]
    diff = []
    for k in GENES:
        a, b = genome_of(base)[k], genome_of(bp)[k]
        if a != b:
            fmt = (lambda v: CASHOUT_RU[v]) if k == "cashout" else (lambda v: v)
            diff.append({"param": k, "title": PARAM_RU[k], "from": fmt(a), "to": fmt(b)})
    bm = best[2]
    return {
        "synthetic": True,
        "scheme": key,
        "evals": i,
        "seconds": round(time.time() - t0, 2),
        "base": {"fit": int(base_fit), "metrics": base_m,
                 "pct": round(100 * base_m["withdrawn_kzt"] / max(1, base_m["attempted_kzt"]), 1)},
        "best": {"fit": int(best[0]), "metrics": bm, "params": bp.to_dict(), "diff": diff,
                 "pct": round(100 * bm["withdrawn_kzt"] / max(1, bm["attempted_kzt"]), 1),
                 "silent_rules": [r for r in ("amount_limit", "daily_limit", "velocity",
                                              "new_recipient", "account_age", "shared_phone")
                                  if not bm["rule_hits"].get(r)],
                 "recheck_withdrawn_kzt": checks,
                 "hints": hints(bp, rules, bm)},
        "overrides": {k: v for k, v in bp.to_dict().items()
                      if k in GENES or k == "cashout"},
        "history": history,
    }


def hole_scenario(world: World, result: dict, rules: Rules = DEFAULT_RULES) -> dict:
    """Сценарий найденной дыры в формате /attack: граф и прогоны «что если»."""
    from .export import scenario_payload
    ov = dict(result["overrides"])
    sc = scenario_payload(world, result["scheme"], rules, **ov)
    sc["scheme"]["title"] = "Найденная дыра: " + PRESETS[result["scheme"]].title.lower()
    return sc
