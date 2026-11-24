"""Синтетический «честный» банк: клиенты, телефоны, круг общения, обычные переводы.

Только стандартная библиотека Python, чтобы симулятор запускался без установки
пакетов (Mac команды, ПК для генерации датасета).

Все числа по умолчанию - условные параметры двойника, а не статистика реального
банка. Калибровка по профилю банка - через BankProfile.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Set

# Каналы. Правила антифрода смотрят на P2P, банкомат и крипто (P2P к трейдеру).
# card - покупки у мерчантов, biz - выплаты мерчантам и трейдерам во внешний мир,
# ext_in - зарплата и пенсия из внешних источников.
P2P, ATM_CH, CRYPTO, CARD, BIZ, EXT_IN = "p2p", "atm", "crypto", "card", "biz", "ext_in"
WATCHED_CHANNELS = {P2P, ATM_CH, CRYPTO}

SEGMENTS = ["student", "employee", "pensioner", "entrepreneur", "merchant", "crypto_trader"]
SEGMENT_RU = {
    "student": "студент",
    "employee": "наёмный",
    "pensioner": "пенсионер",
    "entrepreneur": "ИП",
    "merchant": "мерчант",
    "crypto_trader": "крипто-трейдер P2P",
    "drop": "дроп",
}


@dataclass
class BankProfile:
    """Агрегаты банка для калибровки двойника (ползунки в интерфейсе позже)."""
    n_clients: int = 5000
    horizon_h: int = 24
    share_student: float = 0.18
    share_pensioner: float = 0.15
    share_entrepreneur: float = 0.10
    share_merchant: float = 0.05
    n_crypto_traders: int = 6
    p2p_per_client_day: float = 0.9      # переводов по номеру на клиента в сутки
    purchases_per_client_day: float = 1.6
    p2p_median_kzt: float = 12_000
    share_new_recipient: float = 0.15    # доля P2P незнакомым (покупки с рук, аренда)
    share_young_accounts: float = 0.03   # доля счетов младше 30 дней
    share_shared_phone: float = 0.08     # семьи с одним номером на двоих
    salary_day_share: float = 0.30       # доля наёмных, кому сегодня пришла зарплата
    # честные «транзитные» сценарии, похожие на дропов (трудные отрицательные примеры для модели)
    share_collectors: float = 0.012      # собирает деньги с друзей и платит организатору
    share_relays: float = 0.012          # получает от родственника и сразу передаёт дальше
    salary_rent_share: float = 0.3       # из получивших зарплату сразу платят аренду
    seed: int = 7


@dataclass
class Client:
    id: int
    segment: str
    account_age_days: int
    phone: int
    friends: List[int] = field(default_factory=list)


@dataclass
class Tx:
    t: float            # минуты от начала прогона
    src: int
    dst: int
    amount: int
    channel: str
    kind: str = "honest"   # honest | victim | drop | cashout | warmup
    chain: int = -1
    hop: int = -1


# Особые узлы (не клиенты банка): отрицательные id, id клиента = индекс в списке.
@dataclass
class Specials:
    atm: int
    ext: int


class World:
    def __init__(self, profile: BankProfile, clients: List[Client], specials: Specials,
                 honest: List[Tx]):
        self.profile = profile
        self.clients = clients
        self.specials = specials
        self.honest = honest
        self._phone_count: Dict[int, int] = {}
        for c in clients:
            self._phone_count[c.phone] = self._phone_count.get(c.phone, 0) + 1
        self.traders = [c.id for c in clients if c.segment == "crypto_trader"]
        self.merchants = [c.id for c in clients if c.segment == "merchant"]

    # Дропы добавляются в мир при планировании атаки (они тоже клиенты банка).
    def add_client(self, segment: str, account_age_days: int, phone: int) -> int:
        cid = len(self.clients)
        self.clients.append(Client(cid, segment, account_age_days, phone))
        self._phone_count[phone] = self._phone_count.get(phone, 0) + 1
        return cid

    def clear_attack(self) -> None:
        """Убирает дропов прошлой атаки: мир снова чистый банк."""
        del self.clients[self.profile.n_clients:]
        self._phone_count = {}
        for c in self.clients:
            self._phone_count[c.phone] = self._phone_count.get(c.phone, 0) + 1

    def client(self, cid: int) -> Optional[Client]:
        return self.clients[cid] if 0 <= cid < len(self.clients) else None

    def phone_share(self, cid: int) -> int:
        c = self.client(cid)
        return self._phone_count.get(c.phone, 1) if c else 1

    def new_phone(self) -> int:
        ph = 10_000_000 + len(self._phone_count)
        while ph in self._phone_count:
            ph += 1
        self._phone_count[ph] = 0
        return ph

    def summary(self) -> dict:
        seg: Dict[str, int] = {}
        for c in self.clients:
            seg[c.segment] = seg.get(c.segment, 0) + 1
        by_ch: Dict[str, int] = {}
        for tx in self.honest:
            by_ch[tx.channel] = by_ch.get(tx.channel, 0) + 1
        return {
            "profile": asdict(self.profile),
            "clients": len(self.clients),
            "segments": seg,
            "honest_tx": len(self.honest),
            "honest_by_channel": by_ch,
            "synthetic": True,
        }


def _lognormal(rng: random.Random, median: float, sigma: float) -> float:
    return median * math.exp(rng.gauss(0, sigma))


def _round_kzt(x: float) -> int:
    if x < 1000:
        return max(100, int(round(x / 10) * 10))
    return int(round(x / 100) * 100)


def _poisson(rng: random.Random, lam: float) -> int:
    # Кнут, для малых lam
    if lam <= 0:
        return 0
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p < L:
            return k
        k += 1


def _daytime(rng: random.Random, horizon_min: float) -> float:
    """Время в пределах горизонта с дневным пиком (ночью переводов мало)."""
    while True:
        t = rng.random() * horizon_min
        hour = (t / 60) % 24
        # активность: ночь 0.15, день 1.0
        w = 0.15 if hour < 7 else (1.0 if hour < 22 else 0.4)
        if rng.random() < w:
            return t


def generate_world(profile: Optional[BankProfile] = None) -> World:
    p = profile or BankProfile()
    rng = random.Random(p.seed)
    n = p.n_clients
    horizon = p.horizon_h * 60.0

    # --- сегменты
    n_trader = p.n_crypto_traders
    n_merchant = int(n * p.share_merchant)
    n_student = int(n * p.share_student)
    n_pens = int(n * p.share_pensioner)
    n_ent = int(n * p.share_entrepreneur)
    n_emp = n - n_trader - n_merchant - n_student - n_pens - n_ent
    segs = (["crypto_trader"] * n_trader + ["merchant"] * n_merchant + ["student"] * n_student
            + ["pensioner"] * n_pens + ["entrepreneur"] * n_ent + ["employee"] * n_emp)
    rng.shuffle(segs)

    clients: List[Client] = []
    phone_seq = 0
    for i, s in enumerate(segs):
        if rng.random() < p.share_young_accounts:
            age = rng.randint(1, 29)
        else:
            base = 400 if s == "student" else 1200
            age = int(min(7000, max(30, _lognormal(rng, base, 0.8))))
        clients.append(Client(i, s, age, phone_seq))
        phone_seq += 1

    # общие телефоны в семьях: второй клиент берёт номер первого
    for c in clients:
        if c.segment in ("merchant", "crypto_trader"):
            continue
        if rng.random() < p.share_shared_phone / 2:
            other = clients[rng.randrange(n)]
            if other.segment not in ("merchant", "crypto_trader"):
                other.phone = c.phone
    specials = Specials(atm=-1, ext=-2)

    # --- круг общения (известные получатели): 3-8 друзей, с перекосом в свой сегмент
    by_seg: Dict[str, List[int]] = {}
    for c in clients:
        by_seg.setdefault(c.segment, []).append(c.id)
    people = [c.id for c in clients if c.segment not in ("merchant", "crypto_trader")]
    for c in clients:
        if c.segment in ("merchant", "crypto_trader"):
            continue
        k = rng.randint(3, 8)
        fs: Set[int] = set()
        same = by_seg.get(c.segment, people)
        while len(fs) < k:
            pool = same if rng.random() < 0.5 else people
            f = pool[rng.randrange(len(pool))]
            if f != c.id:
                fs.add(f)
        c.friends = sorted(fs)

    merchants = by_seg.get("merchant", [])
    traders = by_seg.get("crypto_trader", [])
    # популярность мерчантов: степенной закон
    m_weights = [1.0 / (i + 1) ** 0.8 for i in range(len(merchants))]

    honest: List[Tx] = []
    days = horizon / 1440.0
    for c in clients:
        if c.segment in ("merchant", "crypto_trader"):
            continue
        # покупки
        for _ in range(_poisson(rng, p.purchases_per_client_day * days)):
            m = rng.choices(merchants, m_weights)[0]
            amt = _round_kzt(_lognormal(rng, 6_500, 0.9))
            honest.append(Tx(_daytime(rng, horizon), c.id, m, amt, CARD))
        # P2P по номеру
        rate = p.p2p_per_client_day * (1.3 if c.segment == "student" else 1.0)
        for _ in range(_poisson(rng, rate * days)):
            if rng.random() < p.share_new_recipient or not c.friends:
                dst = people[rng.randrange(len(people))]
                if dst == c.id:
                    continue
                med = p.p2p_median_kzt * 2.5  # с рук, аренда: крупнее
            else:
                dst = c.friends[rng.randrange(len(c.friends))]
                med = p.p2p_median_kzt
            r = rng.random()
            if r < 0.01:
                amt = _lognormal(rng, 900_000, 0.4)    # крупная покупка, машина, депозит
            elif r < 0.06:
                amt = _lognormal(rng, 180_000, 0.3)    # аренда
            else:
                amt = _lognormal(rng, med, 0.9)
            honest.append(Tx(_daytime(rng, horizon), c.id, dst, _round_kzt(amt), P2P))
        # банкомат
        if rng.random() < 0.15 * days * (2.0 if c.segment == "pensioner" else 1.0):
            amt = _round_kzt(_lognormal(rng, 40_000, 0.6))
            honest.append(Tx(_daytime(rng, horizon), c.id, specials.atm, amt, ATM_CH))
        # честная покупка крипты у P2P-трейдера
        if traders and c.segment in ("student", "employee", "entrepreneur") and rng.random() < 0.012 * days:
            amt = _round_kzt(_lognormal(rng, 120_000, 0.7))
            honest.append(Tx(_daytime(rng, horizon), c.id, rng.choice(traders), amt, CRYPTO))
        # входящие: зарплата и пенсия
        if c.segment == "employee" and rng.random() < p.salary_day_share * days:
            amt = _round_kzt(_lognormal(rng, 380_000, 0.5))
            honest.append(Tx(rng.uniform(9 * 60, 13 * 60) % horizon, specials.ext, c.id, amt, EXT_IN))
        if c.segment == "pensioner" and rng.random() < 0.1 * days:
            amt = _round_kzt(_lognormal(rng, 110_000, 0.3))
            honest.append(Tx(rng.uniform(8 * 60, 12 * 60) % horizon, specials.ext, c.id, amt, EXT_IN))
        # ИП платит сотрудникам (известным получателям)
        if c.segment == "entrepreneur" and c.friends and rng.random() < 0.2 * days:
            for f in rng.sample(c.friends, min(3, len(c.friends))):
                amt = _round_kzt(_lognormal(rng, 250_000, 0.4))
                honest.append(Tx(_daytime(rng, horizon), c.id, f, amt, P2P))

    # --- честные транзитные сценарии (гипотезы двойника, нужны, чтобы модель не училась
    # на ложном признаке «кто пересылает деньги - всегда дроп»)
    for c in clients:
        if c.segment in ("merchant", "crypto_trader") or not c.friends:
            continue
        r = rng.random()
        if r < p.share_collectors:
            # сбор на подарок, тур, общую покупку: много входящих, затем один крупный исходящий
            t0 = rng.uniform(8 * 60, horizon - 6 * 60)
            total = 0
            for _ in range(rng.randint(4, 12)):
                src = people[rng.randrange(len(people))] if rng.random() < 0.4 else rng.choice(c.friends)
                if src == c.id:
                    continue
                amt = _round_kzt(_lognormal(rng, 15_000, 0.5))
                total += amt
                honest.append(Tx(t0 + rng.uniform(0, 180), src, c.id, amt, P2P))
            dst = people[rng.randrange(len(people))]
            if dst != c.id and total > 0:
                honest.append(Tx(t0 + 180 + rng.uniform(10, 120), c.id, dst,
                                 _round_kzt(total * rng.uniform(0.9, 1.0)), P2P))
        elif r < p.share_collectors + p.share_relays:
            # передать деньги дальше по семье или снять наличными для родственника
            t0 = rng.uniform(8 * 60, horizon - 4 * 60)
            src = rng.choice(c.friends)
            amt = _round_kzt(_lognormal(rng, 250_000, 0.5))
            honest.append(Tx(t0, src, c.id, amt, P2P))
            fwd = _round_kzt(amt * rng.uniform(0.8, 1.0))
            if rng.random() < 0.4:
                honest.append(Tx(t0 + rng.uniform(20, 180), c.id, specials.atm, fwd, ATM_CH))
            else:
                dst = rng.choice(c.friends) if rng.random() < 0.6 else people[rng.randrange(len(people))]
                if dst != c.id:
                    honest.append(Tx(t0 + rng.uniform(20, 180), c.id, dst, fwd, P2P))
    salaried = [tx for tx in honest if tx.channel == EXT_IN and clients[tx.dst].segment == "employee"]
    for tx in salaried:
        if rng.random() < p.salary_rent_share:
            c = clients[tx.dst]
            dst = people[rng.randrange(len(people))] if rng.random() < 0.2 else rng.choice(c.friends or people)
            if dst != c.id:
                honest.append(Tx(tx.t + rng.uniform(30, 300), c.id, dst,
                                 _round_kzt(_lognormal(rng, 180_000, 0.3)), P2P))
    honest = [tx for tx in honest if tx.t <= horizon]

    # выплаты мерчантам и трейдерам во внешний мир (бизнес-канал, правила P2P не применяются)
    for m in merchants + traders:
        honest.append(Tx(horizon - 30 - rng.random() * 60, m, specials.ext,
                         _round_kzt(_lognormal(rng, 2_000_000, 0.8)), BIZ))

    honest.sort(key=lambda x: x.t)
    return World(p, clients, specials, honest)
