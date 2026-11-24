"""Событийная симуляция: честный трафик + атака проходят через правила банка.

Пересылки дропов порождаются динамически: если счёт заморожен или перевод
отклонён, деньги остаются у дропа (перехвачены или застряли).

Для скорости (ИИ-мошенник гоняет сотни прогонов) атака считается только на
честных переводах, которые касаются её участников: все признаки правил и модели
считаются по самому счёту, поэтому результат точно совпадает с полным прогоном.
Цена для честных клиентов считается отдельным прогоном без атаки и кешируется.
"""
from __future__ import annotations

import heapq
import math
import random
from collections import deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .world import World, Tx, WATCHED_CHANNELS, CARD, BIZ, EXT_IN, P2P
from .rules import Rules
from .schemes import AttackPlan, children, cashout_target
from .model import FEATURE_NAMES, Scorer, default_scorer

CH_CODE = {P2P: 0.0, "atm": 1.0, "crypto": 2.0}

DAY = 1440.0
ATTACK_KINDS = {"victim", "drop", "cashout"}


@dataclass
class Acc:
    known: set = field(default_factory=set)
    out_times: deque = field(default_factory=deque)
    day_out: Dict[int, int] = field(default_factory=dict)
    ins: deque = field(default_factory=deque)     # (t, amount, src, src_pass, new_for_src)
    outs: deque = field(default_factory=deque)    # (t, amount)
    score: float = 0.0
    pas: float = 0.0                              # «транзитность» счёта на момент последней отправки
    flagged_at: Optional[float] = None
    flag_rule: Optional[str] = None
    frozen_at: Optional[float] = None
    frozen_by: Optional[str] = None


def _sigmoid(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-z))


class Sim:
    def __init__(self, world: World, rules: Rules, plan: Optional[AttackPlan] = None,
                 all_honest: bool = False, seed: int = 11, scorer: Optional[Scorer] = None,
                 collect: Optional[list] = None):
        self.w = world
        self.r = rules
        self.scorer = scorer or default_scorer()
        self.collect = collect             # сбор признаков для датасета: (x, y, src, kind)
        self.on_tx = None                  # зонд «до перевода» (client_check): f(sim, t, tx)
        self.blocked_accs: set = set()
        self.plan = plan
        self.rng = random.Random(seed)
        self.horizon = world.profile.horizon_h * 60.0
        self.acc: Dict[int, Acc] = {}
        self.heap: List[Tuple[float, int, int, object]] = []
        self.seq = 0
        self.drop_set = set(plan.drops) if plan else set()
        self.victim_set = set(plan.victims) if plan else set()
        self.drop_chain = plan.drop_chain() if plan else {}
        self.drop_layer = plan.drop_layer() if plan else {}
        self.chain_by_id = {c.id: c for c in plan.chains} if plan else {}
        self.bal: Dict[int, int] = {d: 0 for d in self.drop_set}
        self.withdrawn = 0
        self.withdrawn_by: Dict[str, int] = {}
        self.chain_out: Dict[int, int] = {}
        self.victim_delivered = 0
        self.log: List[dict] = []          # переводы атаки для анимации
        self.freezes: List[dict] = []
        self.rule_hits: Dict[str, int] = {}
        # честная сторона
        self.h_watched = 0
        self.h_blocked = 0
        self.h_held = 0
        self.h_alerts = 0
        self.h_suspended = 0
        self.h_frozen: set = set()

        honest = world.honest
        if plan and not all_honest:
            involved = self.drop_set | self.victim_set
            honest = [tx for tx in honest if tx.src in involved or tx.dst in involved]
        self.attack_on = plan is not None
        for tx in honest:
            self._push(tx.t, 0, tx)
        if plan:
            for tx in plan.victim_txs + plan.cover_txs:
                self._push(tx.t, 0, tx)

    # ---------- служебное
    def _push(self, t: float, kind: int, data) -> None:
        self.seq += 1
        heapq.heappush(self.heap, (t, self.seq, kind, data))

    def _a(self, cid: int) -> Acc:
        a = self.acc.get(cid)
        if a is None:
            a = Acc()
            c = self.w.client(cid)
            if c is not None:
                a.known = set(c.friends)
            self.acc[cid] = a
        return a

    def _is_client(self, cid: int) -> bool:
        return cid >= 0

    def _honest_acc(self, cid: int) -> bool:
        return cid >= 0 and cid not in self.drop_set and cid not in self.victim_set

    def _frozen(self, cid: int, t: float) -> bool:
        if cid < 0:
            return False
        a = self.acc.get(cid)
        return a is not None and a.frozen_at is not None and a.frozen_at <= t

    def _flag(self, cid: int, t: float, rule: str, delay: float) -> None:
        if cid < 0:
            return
        a = self._a(cid)
        if cid in self.drop_set or cid in self.victim_set:
            self.rule_hits[rule] = self.rule_hits.get(rule, 0) + 1
        elif self._honest_acc(cid):
            self.h_alerts += 1
        if a.flagged_at is None:
            a.flagged_at, a.flag_rule = t, rule
        if a.frozen_at is None:
            self._push(t + delay, 1, (cid, rule))

    # ---------- признаки счёта для модели
    def _features(self, s: int, a: Acc, t: float, amount: int, new_out: bool, channel: str) -> List[float]:
        """Онлайн-признаки отправителя на момент перевода: сам перевод, счёт, поток
        денег за 24 ч и 2-й шаг графа (насколько транзитны те, кто прислал деньги).
        Порядок совпадает с model.FEATURE_NAMES."""
        while a.ins and a.ins[0][0] < t - DAY:
            a.ins.popleft()
        while a.outs and a.outs[0][0] < t - DAY:
            a.outs.popleft()
        inn = sum(x[1] for x in a.ins)
        out = sum(x[1] for x in a.outs) + amount
        pas = 0.0
        dwell = DAY
        if inn > 0:
            dwell = t - a.ins[-1][0]
            fast = 1.0 if dwell < 90 else math.exp(-(dwell - 90) / 240)
            pas = min(1.0, out / inn) * fast * min(1.0, inn / 50_000)
        a.pas = pas
        c = self.w.client(s)
        return [
            math.log1p(amount), 1.0 if new_out else 0.0,
            math.log1p(c.account_age_days if c else 0), float(self.w.phone_share(s)),
            math.log1p(inn), math.log1p(out), min(5.0, out / inn) if inn > 0 else 0.0,
            min(dwell, DAY), float(len(a.ins)), float(len({x[2] for x in a.ins})),
            float(len({x[2] for x in a.ins if x[4]})), float(len(a.outs) + 1),
            max((x[3] for x in a.ins), default=0.0), (t % DAY) / 60.0,
            CH_CODE.get(channel, 0.0), pas,
        ]

    # ---------- основной цикл
    def run(self) -> "Sim":
        while self.heap:
            t, _, kind, data = heapq.heappop(self.heap)
            if t > self.horizon:
                break
            if kind == 0:
                self._tx(t, data)
            elif kind == 1:
                cid, rule = data
                a = self._a(cid)
                if a.frozen_at is None:
                    a.frozen_at, a.frozen_by = t, rule
                    if cid in self.drop_set:
                        self.freezes.append({"t": round(t, 1), "id": cid, "rule": rule,
                                             "chain": self.drop_chain.get(cid, -1),
                                             "balance": self.bal.get(cid, 0)})
                    elif self._honest_acc(cid):
                        self.h_frozen.add(cid)
            elif kind == 2:
                self._release(t, data)
            elif kind == 3:
                self._forward(t, *data)
            elif kind == 4:
                if self.r.victim_reports_on:
                    self._flag(data, t, "victim_report", self.r.reaction_delay_min)
        return self

    def _reject(self, tx: Tx, status: str, t: float, rule: str = "") -> None:
        if tx.kind in ATTACK_KINDS:
            if tx.src in self.drop_set:
                self.bal[tx.src] += tx.amount   # деньги остались у дропа
            self._log(tx, t, status, rule)

    def _log(self, tx: Tx, t: float, status: str, rule: str = "") -> None:
        self.log.append({"t": round(t, 1), "src": tx.src, "dst": tx.dst, "amount": tx.amount,
                         "kind": tx.kind, "chain": tx.chain, "hop": tx.hop,
                         "status": status, "rule": rule, "channel": tx.channel})

    def _tx(self, t: float, tx: Tx, released: bool = False) -> None:
        r = self.r
        attack = tx.kind in ATTACK_KINDS
        watched = tx.channel in WATCHED_CHANNELS and tx.src >= 0
        honest_src = tx.kind == "honest" and self._honest_acc(tx.src)
        if watched and honest_src and not released:
            self.h_watched += 1
        if self.on_tx is not None and not released:
            self.on_tx(self, t, tx)

        if self._frozen(tx.src, t):
            return self._reject(tx, "frozen_src", t, self.acc[tx.src].frozen_by or "")
        if tx.dst >= 0 and self._frozen(tx.dst, t):
            return self._reject(tx, "frozen_dst", t, self.acc[tx.dst].frozen_by or "")

        sa = self._a(tx.src) if tx.src >= 0 else None
        new_out = bool(sa is not None and tx.dst >= 0 and tx.dst not in sa.known)

        if watched and not released:
            feats = self._features(tx.src, sa, t, tx.amount, new_out, tx.channel)
            if self.collect is not None:
                self.collect.append((feats, 1 if tx.src in self.drop_set else 0, tx.src, tx.kind))
            # --- блокирующие правила
            if r.amount_limit_on and tx.amount > r.amount_limit:
                self.blocked_accs.add(tx.src)
                if honest_src:
                    self.h_blocked += 1
                self._hit(tx, "amount_limit")
                return self._reject(tx, "blocked", t, "amount_limit")
            day = int(t // DAY)
            if r.daily_limit_on and sa.day_out.get(day, 0) + tx.amount > r.daily_limit:
                self.blocked_accs.add(tx.src)
                if honest_src:
                    self.h_blocked += 1
                self._hit(tx, "daily_limit")
                return self._reject(tx, "blocked", t, "daily_limit")
            # --- модель в реальном времени
            # обученная модель считается только когда включена (ИИ-мошенник гоняет сотни прогонов)
            score = self.scorer(feats) if r.model_on else 0.0
            sa.score = score
            thr = r.model_threshold if r.model_threshold is not None else self.scorer.threshold
            if r.model_on and score >= thr:
                if honest_src:
                    self.h_suspended += 1
                self._hit(tx, "model")
                a = sa
                if a.frozen_at is None:
                    a.frozen_at, a.frozen_by = t, "model"
                    if a.flagged_at is None:
                        a.flagged_at, a.flag_rule = t, "model"
                    if tx.src in self.drop_set:
                        self.freezes.append({"t": round(t, 1), "id": tx.src, "rule": "model",
                                             "chain": self.drop_chain.get(tx.src, -1),
                                             "balance": self.bal.get(tx.src, 0) + tx.amount})
                    elif self._honest_acc(tx.src):
                        self.h_frozen.add(tx.src)
                return self._reject(tx, "suspended", t, "model")
            # --- сценарий: задержка первого перевода новому получателю
            if (r.first_hold_on and tx.channel == P2P and new_out and tx.dst >= 0
                    and tx.amount >= r.first_hold_amount):
                if honest_src:
                    self.h_held += 1
                if attack:
                    self._log(tx, t, "held", "first_hold")
                self._push(t + r.first_hold_min, 2, tx)
                return
            # --- сигнальные правила (перевод проходит)
            sa.out_times.append(t)
            while sa.out_times and sa.out_times[0] < t - r.velocity_window_min:
                sa.out_times.popleft()
            if r.velocity_on and len(sa.out_times) > r.velocity_n:
                self._flag(tx.src, t, "velocity", r.reaction_delay_min)
            if tx.dst >= 0:
                dc = self.w.client(tx.dst)
                if r.new_recipient_on and new_out and tx.amount >= r.new_recipient_amount:
                    self._flag(tx.dst, t, "new_recipient", r.reaction_delay_min)
                if (r.account_age_on and dc and dc.account_age_days < r.account_age_days
                        and tx.amount >= r.account_age_amount):
                    self._flag(tx.dst, t, "account_age", r.reaction_delay_min)
                if (r.shared_phone_on and tx.amount >= r.shared_phone_amount
                        and self.w.phone_share(tx.dst) >= r.shared_phone_n):
                    self._flag(tx.dst, t, "shared_phone", r.reaction_delay_min)
            if (r.shared_phone_on and tx.amount >= r.shared_phone_amount
                    and self.w.phone_share(tx.src) >= r.shared_phone_n):
                self._flag(tx.src, t, "shared_phone", r.reaction_delay_min)

        self._deliver(t, tx, new_out)

    def _hit(self, tx: Tx, rule: str) -> None:
        if tx.kind in ATTACK_KINDS:
            self.rule_hits[rule] = self.rule_hits.get(rule, 0) + 1

    def _release(self, t: float, tx: Tx) -> None:
        if tx.kind == "victim" and self.rng.random() < self.r.hold_victim_cancel_p:
            return self._log(tx, t, "cancelled", "first_hold")
        if self._frozen(tx.src, t) or (tx.dst >= 0 and self._frozen(tx.dst, t)):
            st = "frozen_src" if self._frozen(tx.src, t) else "frozen_dst"
            return self._reject(tx, st, t, "first_hold")
        self._tx(t, tx, released=True)

    def _deliver(self, t: float, tx: Tx, new_out: bool) -> None:
        sa = self._a(tx.src) if tx.src >= 0 else None
        if sa is not None and tx.channel in WATCHED_CHANNELS:
            day = int(t // DAY)
            sa.day_out[day] = sa.day_out.get(day, 0) + tx.amount
            sa.outs.append((t, tx.amount))
        if sa is not None and tx.dst >= 0:
            sa.known.add(tx.dst)
        if tx.dst >= 0 and tx.channel not in (CARD, BIZ):
            da = self._a(tx.dst)
            da.ins.append((t, tx.amount, tx.src, sa.pas if sa else 0.0, new_out))

        if tx.kind not in ATTACK_KINDS:
            return
        self._log(tx, t, "ok")
        if tx.kind == "victim":
            self.victim_delivered += tx.amount
            notice = self.r.victim_notice_median_min * math.exp(self.rng.gauss(0, 0.5))
            self._push(t + notice, 4, tx.dst)
        if tx.dst in self.drop_set:
            self.bal[tx.dst] += tx.amount
            p = self.plan.params
            pause = max(1.0, p.pause_min * math.exp(self.rng.gauss(0, 0.4)))
            self._push(t + pause, 3, (tx.dst, tx.amount, tx.hop, tx.chain))
        else:
            # дошло до точки вывода
            self.withdrawn += tx.amount
            self.withdrawn_by[tx.channel] = self.withdrawn_by.get(tx.channel, 0) + tx.amount
            self.chain_out[tx.chain] = self.chain_out.get(tx.chain, 0) + tx.amount

    def _forward(self, t: float, d: int, amount: int, pos: int, chain_id: int) -> None:
        if self._frozen(d, t):
            return
        take = min(amount, self.bal[d])
        if take <= 0:
            return
        p = self.plan.params
        chain = self.chain_by_id[chain_id]
        path_len = p.layers * p.cycles
        layer = pos % p.layers
        nxt = pos + 1
        if nxt >= path_len:
            targets = [cashout_target(self.w, p, self.rng) + ("cashout",)]
        elif nxt % p.layers == 0:
            targets = [(chain.layers[0][0], P2P, "drop")]          # карусель: назад в голову
        else:
            targets = [(c, P2P, "drop") for c in children(chain, d, layer, p.fan_out)]
        if not targets:
            return
        self.bal[d] -= take
        share = take // len(targets)
        rest = take - share * len(targets)
        k = 0
        for i, (dst, ch, kind) in enumerate(targets):
            amt = share + (rest if i == 0 else 0)
            while amt > 0:
                part = min(amt, p.chunk_max)
                amt -= part
                jitter = self.rng.random() * 1.5
                self._push(t + k * p.chunk_gap_min + jitter, 0,
                           Tx(t + k * p.chunk_gap_min, d, dst, part, ch, kind=kind,
                              chain=chain_id, hop=nxt))
                k += 1

    # ---------- итоги
    def attack_metrics(self) -> dict:
        p = self.plan
        frozen_bal = sum(self.bal[d] for d in self.drop_set if self._frozen(d, self.horizon))
        stuck = sum(self.bal[d] for d in self.drop_set if not self._frozen(d, self.horizon))
        prevented = p.attempted_kzt - self.victim_delivered
        caught = {self.drop_chain[d] for d in self.drop_set if self._frozen(d, self.horizon)}
        start = min(tx.t for tx in p.victim_txs) if p.victim_txs else 0.0
        first = min((f["t"] for f in self.freezes), default=None)
        in_flight = max(0, self.victim_delivered - self.withdrawn - frozen_bal - stuck)
        return {
            "scheme": p.params.key,
            "attempted_kzt": p.attempted_kzt,
            "withdrawn_kzt": self.withdrawn,
            "intercepted_kzt": frozen_bal + prevented,
            "frozen_kzt": frozen_bal,
            "prevented_kzt": prevented,
            "stuck_kzt": stuck + in_flight,
            "withdrawn_by_channel": self.withdrawn_by,
            "chains_total": len(p.chains),
            "chains_caught": len(caught),
            "drops_total": len(p.drops),
            "drops_frozen": sum(1 for d in self.drop_set if self._frozen(d, self.horizon)),
            "minutes_to_first_freeze": None if first is None else round(first - start, 1),
            "rule_hits": self.rule_hits,
            "scheme_cost_kzt": p.params.cost_kzt(),
        }

    def honest_metrics(self) -> dict:
        n = max(1, self.h_watched)
        honest_clients = sum(1 for c in self.w.clients[: self.w.profile.n_clients])
        return {
            "honest_watched_tx": self.h_watched,
            "blocked": self.h_blocked,
            "held": self.h_held,
            "suspended": self.h_suspended,
            "alerts": self.h_alerts,
            "frozen_clients": len(self.h_frozen),
            "delayed_per_10k": round((self.h_blocked + self.h_held + self.h_suspended) * 10_000 / n, 1),
            "frozen_clients_pct": round(100 * len(self.h_frozen) / max(1, honest_clients), 2),
        }


def run_attack(world: World, rules: Rules, plan: AttackPlan, seed: int = 11,
               scorer: Optional[Scorer] = None) -> Sim:
    return Sim(world, rules, plan, all_honest=False, seed=seed, scorer=scorer).run()


_HONEST_CACHE: Dict[tuple, dict] = {}


def honest_cost(world: World, rules: Rules, scorer: Optional[Scorer] = None) -> dict:
    """Цена правил для честных клиентов: прогон всего честного трафика без атаки."""
    sc = scorer or default_scorer()
    key = (id(world), id(sc), tuple(sorted(rules.to_dict().items())))
    if key not in _HONEST_CACHE:
        _HONEST_CACHE[key] = Sim(world, rules, None, all_honest=True, scorer=sc).run().honest_metrics()
    return _HONEST_CACHE[key]
