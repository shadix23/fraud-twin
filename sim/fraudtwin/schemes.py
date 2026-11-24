"""Библиотека схем дропперов. Каждая схема - набор параметров одного генератора.

Структура атаки: жертвы -> голова цепочки (дроп слоя 0) -> слои дропов (дерево с
ветвлением fan_out) -> вывод (банкомат, крипто-трейдер, внешний банк).
Карусель: после последнего слоя деньги возвращаются в голову цепочки cycles раз.

Факты в source взяты из research/02-angle.md (вопрос 4). Числа параметров по
умолчанию - гипотезы для симуляции, а не статистика: суточные лимиты, время вывода
и суммы в публичных источниках по РК не найдены.
"""
from __future__ import annotations

import math
import random
import zlib
from dataclasses import dataclass, field, asdict, replace
from typing import Dict, List, Optional

from .world import World, Tx, P2P, ATM_CH, CRYPTO

USD_KZT = 510  # условный курс для пересчёта выплат дропам


@dataclass
class SchemeParams:
    key: str
    title: str
    source: str
    n_chains: int = 10                # голов цепочек (ячеек)
    victims_per_chain: int = 2
    victim_amount: int = 400_000      # медиана суммы с одной жертвы
    victim_chunk_max: int = 10_000_000  # жертву просят переводить частями не больше
    victim_segments: tuple = ("pensioner", "employee")
    layers: int = 2                   # слоёв дропов
    fan_out: int = 2
    cycles: int = 1                   # >1 = карусель
    pause_min: float = 15.0           # медиана паузы дропа перед пересылкой
    chunk_max: int = 500_000          # дроп дробит пересылку на части не больше
    chunk_gap_min: float = 3.0
    cashout: Dict[str, float] = field(default_factory=lambda: {"crypto": 0.6, "atm": 0.4})
    drop_age_days: int = 30           # медиана возраста счёта дропа
    drops_per_phone: int = 3          # сколько дроп-карт на одном телефоне
    drop_segment: str = "student"
    start_min: float = 10 * 60        # начало атаки (10:00)
    victim_window_min: float = 240    # жертвы переводят в течение окна
    drop_fee_kzt: int = 140_000       # выплата дропу (200-350 USD, Nur.kz 31.03.2026)
    aged_account_premium_kzt: int = 60_000  # доплата за «прогретый» старый счёт (гипотеза)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["victim_segments"] = list(self.victim_segments)
        return d

    def n_drops(self) -> int:
        return self.n_chains * sum(self.fan_out ** k for k in range(self.layers))

    def cost_kzt(self) -> int:
        per = self.drop_fee_kzt + (self.aged_account_premium_kzt if self.drop_age_days >= 90 else 0)
        return self.n_drops() * per


PRESETS: Dict[str, SchemeParams] = {
    "student_crypto": SchemeParams(
        key="student_crypto",
        title="Студенческие карты, вывод в крипту",
        source="АФМ: куратор в Telegram вербует студентов (Azattyq Rýhy, 2026); "
               "конвертация в крипту через «обменник» (Zakon.kz, 2026)",
        n_chains=12, victims_per_chain=2, victim_amount=450_000,
        layers=2, fan_out=2, pause_min=15, chunk_max=400_000,
        cashout={"crypto": 0.8, "atm": 0.2}, drop_age_days=40, drops_per_phone=4,
    ),
    "social_fan": SchemeParams(
        key="social_fan",
        title="Звонок «службы безопасности», веер дропов",
        source="Типология социнженерии; обнал через банкоматы, Алматы 45 млн ₸ (Bes.media)",
        n_chains=8, victims_per_chain=1, victim_amount=1_400_000,
        victim_segments=("pensioner",),
        layers=2, fan_out=3, pause_min=8, chunk_max=600_000,
        cashout={"atm": 0.6, "ext": 0.4}, drop_age_days=6, drops_per_phone=6,
        drop_segment="employee",
    ),
    "structuring": SchemeParams(
        key="structuring",
        title="Дробление под лимит",
        source="Типология; суточные лимиты банков РК публично не найдены, лимит - параметр",
        n_chains=10, victims_per_chain=2, victim_amount=600_000, victim_chunk_max=200_000,
        layers=1, fan_out=1, pause_min=30, chunk_max=190_000, chunk_gap_min=12,
        cashout={"atm": 0.5, "crypto": 0.5}, drop_age_days=120, drops_per_phone=2,
    ),
    "fake_seller": SchemeParams(
        key="fake_seller",
        title="Фейковый продавец, много мелких жертв",
        source="Типология мошенничества с предоплатой; доля интернет-мошенничества - research/01",
        n_chains=4, victims_per_chain=15, victim_amount=45_000,
        victim_segments=("student", "employee", "entrepreneur"),
        layers=1, fan_out=1, pause_min=20, chunk_max=300_000, victim_window_min=600,
        cashout={"crypto": 0.5, "atm": 0.5}, drop_age_days=25, drops_per_phone=2,
    ),
    "carousel": SchemeParams(
        key="carousel",
        title="Карусель через сеть онлайн-казино",
        source="Караганда: 23 дроп-счёта, 415 млн ₸, колл-офис 24/7 (Bizmedia, 28.09.2026)",
        n_chains=6, victims_per_chain=3, victim_amount=350_000,
        layers=2, fan_out=2, cycles=2, pause_min=12, chunk_max=350_000,
        cashout={"ext": 0.7, "crypto": 0.3}, drop_age_days=60, drops_per_phone=4,
        drop_segment="employee",
    ),
}


def preset(key: str, **overrides) -> SchemeParams:
    return replace(PRESETS[key], **overrides)


@dataclass
class Chain:
    id: int
    layers: List[List[int]]          # layers[k] = дропы слоя k
    victims: List[int]


@dataclass
class AttackPlan:
    params: SchemeParams
    chains: List[Chain]
    drops: List[int]
    victims: List[int]
    victim_txs: List[Tx]
    attempted_kzt: int
    rng_seed: int
    cover_txs: List[Tx] = field(default_factory=list)   # обычная жизнь дропа (маскировка)

    def drop_chain(self) -> Dict[int, int]:
        return {d: ch.id for ch in self.chains for layer in ch.layers for d in layer}

    def drop_layer(self) -> Dict[int, int]:
        return {d: k for ch in self.chains for k, layer in enumerate(ch.layers) for d in layer}


def children(chain: Chain, drop: int, layer: int, fan_out: int) -> List[int]:
    if layer + 1 >= len(chain.layers):
        return []
    idx = chain.layers[layer].index(drop)
    nxt = chain.layers[layer + 1]
    return nxt[idx * fan_out: idx * fan_out + fan_out]


def plan_attack(world: World, params: SchemeParams, seed: int = 1) -> AttackPlan:
    """Создаёт дроп-счета в мире и планирует переводы жертв. Пересылки дропов
    динамические: их порождает движок, потому что они зависят от блокировок."""
    rng = random.Random(seed * 7919 + zlib.crc32(params.key.encode()) % 1000)
    pool = [c.id for c in world.clients[: world.profile.n_clients]
            if c.segment in params.victim_segments]
    rng.shuffle(pool)

    chains: List[Chain] = []
    drops: List[int] = []
    phone = world.new_phone()
    on_phone = 0
    n_victims = params.n_chains * params.victims_per_chain
    victims = pool[:n_victims]
    for ch_id in range(params.n_chains):
        layers: List[List[int]] = []
        for k in range(params.layers):
            layer = []
            for _ in range(params.fan_out ** k):
                if on_phone >= max(1, params.drops_per_phone):
                    phone, on_phone = world.new_phone(), 0
                age = max(1, int(params.drop_age_days * math.exp(rng.gauss(0, 0.35))))
                d = world.add_client("drop", age, phone)
                on_phone += 1
                layer.append(d)
                drops.append(d)
            layers.append(layer)
        vs = victims[ch_id * params.victims_per_chain:(ch_id + 1) * params.victims_per_chain]
        chains.append(Chain(ch_id, layers, vs))

    victim_txs: List[Tx] = []
    attempted = 0
    for ch in chains:
        head = ch.layers[0][0]
        for v in ch.victims:
            total = max(5_000, int(params.victim_amount * math.exp(rng.gauss(0, 0.35)) / 100) * 100)
            attempted += total
            t = params.start_min + rng.random() * params.victim_window_min
            left = total
            while left > 0:
                part = min(left, params.victim_chunk_max)
                victim_txs.append(Tx(t, v, head, part, P2P, kind="victim", chain=ch.id, hop=0))
                left -= part
                t += 2 + rng.random() * 4
    victim_txs.sort(key=lambda x: x.t)
    # маскировка: у дроп-карты есть обычная жизнь - пара мелких входящих и исходящих
    people = [c.id for c in world.clients[: world.profile.n_clients]
              if c.segment not in ("merchant", "crypto_trader")]
    horizon = world.profile.horizon_h * 60.0
    cover: List[Tx] = []
    for d in drops:
        for _ in range(rng.randint(0, 3)):
            other = rng.choice(people)
            amt = max(500, int(rng.lognormvariate(math.log(8_000), 0.8) / 100) * 100)
            t = rng.uniform(7 * 60, horizon - 30)
            cover.append(Tx(t, other, d, amt, P2P) if rng.random() < 0.5 else Tx(t, d, other, amt, P2P))
    return AttackPlan(params, chains, drops, victims, victim_txs, attempted, seed, cover)


def cashout_target(world: World, params: SchemeParams, rng: random.Random):
    """Возвращает (узел, канал) вывода по смеси cashout."""
    kinds = list(params.cashout.keys())
    k = rng.choices(kinds, [params.cashout[x] for x in kinds])[0]
    if k == "atm":
        return world.specials.atm, ATM_CH
    if k == "crypto" and world.traders:
        return rng.choice(world.traders), CRYPTO
    return world.specials.ext, P2P  # межбанковский перевод на карту другого банка
