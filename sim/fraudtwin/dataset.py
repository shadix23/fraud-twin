"""Генератор датасета синтетических миров для обучения модели риска.

Каждый мир: случайный профиль банка (размер, доли сегментов, общие телефоны),
случайные настройки правил и одна атака из библиотеки со случайными числовыми
параметрами вокруг пресета. Структура схемы (слои, ветвление, карусель, число
жертв на цепочку, сегменты, вывод) не меняется: так проверка «на схеме, которой
не было при обучении» остаётся честной.

Строка датасета = исходящий перевод под наблюдением правил, признаки на момент
решения (model.FEATURE_NAMES), метка = отправитель дроп.
Только стандартная библиотека; numpy нужен лишь скрипту обучения.
"""
from __future__ import annotations

import random
from dataclasses import replace
from typing import Dict, List

from .engine import Sim
from .model import HeuristicScorer
from .rules import Rules
from .schemes import PRESETS, plan_attack
from .world import BankProfile, generate_world

NUMERIC_JITTER = ["n_chains", "victim_amount", "pause_min", "chunk_max", "chunk_gap_min",
                  "drop_age_days", "victim_window_min"]


def _jit(rng: random.Random, v, lo=0.6, hi=1.6):
    x = v * rng.uniform(lo, hi)
    return max(1, int(round(x))) if isinstance(v, int) else max(1.0, x)


def random_profile(rng: random.Random) -> BankProfile:
    return BankProfile(
        n_clients=rng.randint(1200, 2600),
        share_student=rng.uniform(0.10, 0.28), share_pensioner=rng.uniform(0.08, 0.22),
        share_entrepreneur=rng.uniform(0.05, 0.15),
        p2p_per_client_day=rng.uniform(0.6, 1.3), p2p_median_kzt=rng.uniform(8_000, 20_000),
        share_new_recipient=rng.uniform(0.08, 0.25), share_young_accounts=rng.uniform(0.01, 0.06),
        share_shared_phone=rng.uniform(0.04, 0.14), seed=rng.randrange(10**6),
    )


def random_rules(rng: random.Random) -> Rules:
    r = Rules()
    kw = {}
    for name in ("amount_limit", "daily_limit", "velocity", "new_recipient", "account_age",
                 "shared_phone"):
        kw[f"{name}_on"] = rng.random() < 0.8
    kw.update(amount_limit=_jit(rng, r.amount_limit), daily_limit=_jit(rng, r.daily_limit),
              new_recipient_amount=_jit(rng, r.new_recipient_amount),
              account_age_days=_jit(rng, r.account_age_days),
              reaction_delay_min=_jit(rng, r.reaction_delay_min, 0.3, 3))
    return r.with_(**kw)


def random_scheme(rng: random.Random, key: str):
    p = PRESETS[key]
    kw = {k: _jit(rng, getattr(p, k)) for k in NUMERIC_JITTER}
    kw["drops_per_phone"] = max(1, p.drops_per_phone + rng.randint(-1, 1))
    kw["victim_chunk_max"] = int(min(p.victim_chunk_max, _jit(rng, kw["victim_amount"], 0.4, 3)))
    kw["start_min"] = rng.uniform(7 * 60, 15 * 60)
    return replace(p, **kw)


def sample_world(seed: int, scheme_key: str) -> Dict[str, list]:
    rng = random.Random(seed)
    world = generate_world(random_profile(rng))
    rules = random_rules(rng)
    plan = plan_attack(world, random_scheme(rng, scheme_key), seed=rng.randrange(10**6))
    rows: list = []
    sim = Sim(world, rules, plan, all_honest=True, collect=rows, scorer=HeuristicScorer()).run()
    flagged = {cid for cid, a in sim.acc.items() if a.flagged_at is not None} | sim.blocked_accs
    return {
        "X": [r[0] for r in rows], "y": [r[1] for r in rows], "src": [r[2] for r in rows],
        "victim": [1 if r[3] == "victim" else 0 for r in rows],
        "rule_flag": [1 if r[2] in flagged else 0 for r in rows],
    }


def build(n_per_scheme: int, seed0: int = 1000) -> List[dict]:
    out = []
    for si, key in enumerate(PRESETS):
        for i in range(n_per_scheme):
            seed = seed0 + si * 100_000 + i
            d = sample_world(seed, key)
            d["scheme"], d["world"] = key, seed
            out.append(d)
    return out
