"""ИИ-мошенник: эволюционный поиск параметров схемы, которые обходят правила банка.

Это оптимизатор, а не нейросеть. Цель мошенника: выведено ₸ минус стоимость схемы
(выплаты дропам). Число жертв и суммы фиксированы пресетом, меняется «как» -
дробление, пауза, слои, возраст и телефоны дроп-карт, канал вывода.
Популяция 20, 10 поколений = 200 прогонов симулятора (~1-3 с на Mac),
лучший вариант перепроверяется на трёх случайных зёрнах атаки.
"""
from __future__ import annotations

import json
import math
import os
import random
import time
from dataclasses import replace
from typing import Dict, List, Optional, Tuple

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
        _k = params.drops_per_phone
        _w = ("карта" if _k % 10 == 1 and _k % 100 != 11 else
              "карты" if _k % 10 in (2, 3, 4) and _k % 100 not in (12, 13, 14) else "карт")
        out.append(f"На одном телефоне {_k} {_w}, порог правила "
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


SEEDS_PATH = os.path.join(os.path.dirname(__file__), "attack_seeds.json")
_seed_bank: Optional[Dict[str, List[Genome]]] = None


def seed_bank() -> Dict[str, List[Genome]]:
    """Лучшие известные атаки по схемам, найденные при любых правилах (файл attack_seeds.json).
    Файл статичный и лежит в репозитории: результат поиска не зависит от того, что считали раньше."""
    global _seed_bank
    if _seed_bank is None:
        try:
            with open(SEEDS_PATH, encoding="utf-8") as f:
                _seed_bank = json.load(f)
        except (OSError, ValueError):
            _seed_bank = {}
    return _seed_bank


def _clip(g: Genome) -> Genome:
    """Гены из файла приводим к допустимым границам и типам."""
    out: Genome = {}
    for k, (kind, *spec) in GENES.items():
        v = g.get(k)
        if kind == "log":
            out[k] = min(spec[1], max(spec[0], float(v)))
        elif kind == "int":
            out[k] = min(spec[1], max(spec[0], int(v)))
        else:
            out[k] = v if v in spec[0] else spec[0][0]
    return out


def _pct(m: dict) -> float:
    return round(100 * m["withdrawn_kzt"] / max(1, m["attempted_kzt"]), 1)


def search(world: World, key: str, rules: Rules = DEFAULT_RULES, pop: int = 20, gens: int = 10,
           seed: int = 5, restarts: int = 1, polish: int = 0, seeds: Optional[List[Genome]] = None,
           use_bank: bool = True, budget_s: Optional[float] = None) -> dict:
    """Эволюционный поиск. Результат - нижняя оценка («не меньше»): больший бюджет может найти больше.

    restarts: независимых запусков с разными зёрнами (seed, seed+1, ...), лучший по fit побеждает;
    seeds / банк: готовые атаки, перепроверяются на ТЕКУЩИХ правилах и входят в стартовую популяцию;
    polish: число оценок локального доводчика вокруг лучшего (шаг сужается).
    budget_s: бюджет по времени (живой режим). Порядок: посев из банка, эволюция до 55% бюджета,
    доводка до конца бюджета; число поколений и оценок тогда зависит от скорости машины.
    Без budget_s режим детерминированный (по числу поколений и оценок).
    Детерминизм: те же аргументы и тот же attack_seeds.json дают тот же ответ."""
    t0 = time.time()
    timed = budget_s is not None and budget_s > 0
    t_evo = t0 + (budget_s * 0.55 if timed else 0)
    t_end = t0 + (budget_s if timed else 0)
    cut = {"evo": False, "polish": False}
    base = PRESETS[key]
    base_fit, base_m = evaluate(world, rules, base)
    known: List[Genome] = []
    if seeds is not None:
        known = [_clip(g) for g in seeds]
    elif use_bank:
        known = [_clip(g) for g in seed_bank().get(key, [])]
    history: List[dict] = []
    best: Tuple[float, Genome, dict] = (base_fit, genome_of(base), base_m)
    i = 0
    cache: Dict[str, Tuple[float, dict]] = {}

    def ev(g: Genome) -> Tuple[float, dict]:
        p = params_of(base, g)
        ck = json.dumps(p.to_dict(), sort_keys=True)
        if ck not in cache:
            cache[ck] = evaluate(world, rules, p)
        return cache[ck]

    def record(g, fit, m, gen):
        nonlocal i, best
        i += 1
        history.append({"i": i, "gen": gen, "fit": int(fit), "pct": _pct(m),
                        "caught": f"{m['chains_caught']}/{m['chains_total']}", "rule": _top_rule(m)})
        if fit > best[0]:
            best = (fit, g, m)

    # известные атаки на текущих правилах
    seed_fits = []
    for g in known:
        fit, m = ev(g)
        seed_fits.append((fit, g))
    seed_fits.sort(key=lambda x: -x[0])
    start = [g for _, g in seed_fits[:max(0, pop // 3)]]

    restart_log = []
    for r in range(1 if timed else max(1, restarts)):
        rng = random.Random(seed + r)
        population = [genome_of(base)] + start
        while len(population) < pop:
            src = start[len(population) % len(start)] if start and r > 0 and rng.random() < 0.5 \
                else genome_of(base)
            population.append(_mutate(src, rng, rate=0.6, scale=0.9))
        best_r = -math.inf
        pct_r = 0.0
        for gen in range(gens):
            if timed and gen > 0 and time.time() > t_evo:
                cut["evo"] = True
                break
            scored = []
            for g in population:
                if timed and gen > 0 and time.time() > t_evo:
                    cut["evo"] = True
                    break
                fit, m = ev(g)
                scored.append((fit, g, m))
                if r == 0:
                    record(g, fit, m, gen)
                elif fit > best[0]:
                    record(g, fit, m, gens + r - 1)
                if fit > best_r:
                    best_r, pct_r = fit, _pct(m)
            if cut["evo"]:
                break
            scored.sort(key=lambda x: -x[0])
            elite = [g for _, g, _ in scored[:2]]

            def pick():
                a, b = rng.sample(scored, 2)
                return (a if a[0] > b[0] else b)[1]
            population = elite + [_mutate(_cross(pick(), pick(), rng), rng) for _ in range(pop - 2)]
        if timed and time.time() > t_evo:
            cut["evo"] = True
        restart_log.append({"seed": seed + r, "fit": int(best_r), "pct": pct_r})

    # посев прямо в историю, если известная атака оказалась лучше найденной с нуля
    for fit, g in seed_fits[:1]:
        if fit > best[0]:
            m = ev(g)[1]
            record(g, fit, m, gens)

    # локальный доводчик: мутации малого шага вокруг лучшего, шаг сужается
    if timed:
        rng = random.Random(seed + 1000)
        n_pol = 0
        while time.time() < t_end:
            frac = (time.time() - t0) / budget_s
            scale = 0.35 * (0.6 ** (max(0.0, frac - 0.5) * 12))
            g = _mutate(best[1], rng, rate=0.3, scale=scale)
            fit, m = ev(g)
            n_pol += 1
            if fit > best[0]:
                record(g, fit, m, gens + 1)
        cut["polish"] = True
    elif polish > 0:
        rng = random.Random(seed + 1000)
        steps = 6
        per = max(1, polish // steps)
        for s_i in range(steps):
            scale = 0.35 * (0.6 ** s_i)
            for _ in range(per):
                g = _mutate(best[1], rng, rate=0.3, scale=scale)
                fit, m = ev(g)
                if fit > best[0]:
                    record(g, fit, m, gens + max(1, restarts) + s_i)

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
    pcts = [x["pct"] for x in restart_log]
    return {
        "synthetic": True,
        "scheme": key,
        "evals": len(cache) + 1,
        "seconds": round(time.time() - t0, 2),
        # поиск даёт нижнюю оценку: настоящая дыра может быть больше. Фронт пишет «не меньше X%»
        "lower_bound": True,
        "budget_s": round(budget_s, 2) if timed else None,
        "search": {"restarts": max(1, restarts), "pop": pop, "gens": gens, "polish": polish,
                   "seeded": len(known), "restart_pct": pcts,
                   "spread_pct": round(max(pcts) - min(pcts), 1) if pcts else 0.0},
        "base": {"fit": int(base_fit), "metrics": base_m, "pct": _pct(base_m)},
        "best": {"fit": int(best[0]), "metrics": bm, "params": bp.to_dict(), "diff": diff,
                 "pct": _pct(bm),
                 "silent_rules": [r for r in ("amount_limit", "daily_limit", "velocity",
                                              "new_recipient", "account_age", "shared_phone")
                                  if not bm["rule_hits"].get(r)],
                 "recheck_withdrawn_kzt": checks,
                 "hints": hints(bp, rules, bm)},
        "overrides": {k: v for k, v in bp.to_dict().items()
                      if k in GENES or k == "cashout"},
        "history": history,
    }


# бюджеты: живой ответ (Vercel, 3-5 с) и экспорт (считается один раз, можно дольше)
LIVE = dict(pop=20, restarts=2, polish=150)
STRONG = dict(pop=30, gens=25, restarts=8, polish=900)
STRONG_MODEL = dict(restarts=12)   # против модели поверхность рваная: больше перезапусков


def live_budget_s() -> Optional[float]:
    """Бюджет живого поиска, с. FT_LIVE_BUDGET_S (0 или off = без времени, по поколениям).
    По умолчанию 3,5 с, на Vercel 1,8 с (там счёт в 5-6 раз медленнее Mac)."""
    v = os.environ.get("FT_LIVE_BUDGET_S")
    if v is None:
        return 1.8 if os.environ.get("VERCEL") else 3.5
    try:
        f = float(v)
    except ValueError:
        return None
    return f if f > 0 else None


def search_live(world: World, key: str, rules: Rules = DEFAULT_RULES, gens: int = 10, **kw) -> dict:
    cfg = {**LIVE, **({"restarts": 1} if rules.model_on else {}), "budget_s": live_budget_s(), **kw}   # с моделью оценка в 2-3 раза дороже
    return search(world, key, rules, gens=gens, **cfg)


def search_strong(world: World, key: str, rules: Rules = DEFAULT_RULES, **kw) -> dict:
    return search(world, key, rules, **{**STRONG, **kw})


def build_seed_bank(world_for, out_path: str = SEEDS_PATH, per_scheme: int = 6) -> dict:
    """Собирает банк атак: сильный поиск по схеме при разных правилах (профили банков, строгие лимиты,
    с моделью). world_for(calib) -> (world, rules). Запуск: python -m fraudtwin.redteam --build-seeds"""
    from .report import CALIB_PRESETS
    variants: List[dict] = [{}, {"amount_limit": 300_000}, {"amount_limit": 500_000},
                            {"amount_limit": 700_000}, {"model_on": True},
                            {"velocity_on": False}, {"shared_phone_on": False}]
    bank: Dict[str, List[Genome]] = {}
    for pr in CALIB_PRESETS:
        w, base_rules = world_for(pr["values"])
        for key in PRESETS:
            for v in variants:
                try:
                    rules = base_rules.with_(**v)
                except Exception:
                    continue
                res = search(w, key, rules, pop=30, gens=25, restarts=4, polish=400, use_bank=False)
                g = genome_of(preset(key, **res["overrides"]))
                bank.setdefault(key, []).append(g)
    # без повторов, не больше per_scheme: самые разные по выводу
    out = {}
    for key, gs in bank.items():
        uniq, seen = [], set()
        for g in gs:
            sig = json.dumps(g, sort_keys=True)
            if sig not in seen:
                seen.add(sig)
                uniq.append(g)
        out[key] = uniq[:per_scheme * 2]
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    return out


def hole_scenario(world: World, result: dict, rules: Rules = DEFAULT_RULES) -> dict:
    """Сценарий найденной дыры в формате /attack: граф и прогоны «что если»."""
    from .export import scenario_payload
    ov = dict(result["overrides"])
    sc = scenario_payload(world, result["scheme"], rules, **ov)
    sc["scheme"]["title"] = "Найденная дыра: " + PRESETS[result["scheme"]].title.lower()
    return sc


if __name__ == "__main__":
    import sys
    if "--build-seeds" in sys.argv:
        from .report import calib_profile, calib_rules
        from .world import generate_world

        def _wf(c):
            return generate_world(calib_profile(c)), calib_rules(c)
        r = build_seed_bank(_wf)
        print({k: len(v) for k, v in r.items()})
