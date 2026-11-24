"""Правила антифрода банка-двойника и сценарные вмешательства «что если».

Три типа действия:
- block  - перевод отклоняется сразу (лимиты);
- alert  - сигнал аналитику, счёт замораживается через reaction_delay_min, перевод проходит;
- realtime - модель в реальном времени: приостанавливает перевод и сразу замораживает счёт.

Пороги по умолчанию условные: суточные лимиты банков РК публично не найдены
(research/02-angle.md, вопрос 4). Признак «один телефон у нескольких клиентов» -
из пересказа требований АРРФР к выявлению дропперов (там же, вопрос 1).
"""
from __future__ import annotations

from dataclasses import dataclass, asdict, replace
from typing import List, Optional


@dataclass
class Rules:
    # 1. лимит одного перевода
    amount_limit_on: bool = True
    amount_limit: int = 1_000_000
    # 2. суточный лимит исходящих
    daily_limit_on: bool = True
    daily_limit: int = 3_000_000
    # 3. скорость: больше N исходящих за окно
    velocity_on: bool = True
    velocity_n: int = 5
    velocity_window_min: float = 60
    # 4. новый получатель + крупная сумма -> сигнал на получателя
    new_recipient_on: bool = True
    new_recipient_amount: int = 300_000
    # 5. молодой счёт получает крупную сумму
    account_age_on: bool = True
    account_age_days: int = 14
    account_age_amount: int = 100_000
    # 6. один телефон у нескольких клиентов
    shared_phone_on: bool = True
    shared_phone_n: int = 3
    shared_phone_amount: int = 50_000
    # реакция банка на сигналы правил 3-6 и заявления жертв
    reaction_delay_min: float = 30
    victim_reports_on: bool = True
    victim_notice_median_min: float = 720   # жертва замечает в среднем через 12 ч (гипотеза)
    # «что если»: модель на графе
    model_on: bool = False
    model_threshold: Optional[float] = None   # None = рабочий порог из файла модели
    # «что если»: сценарное правило, в РК не действует (есть только для онлайн-займов)
    first_hold_on: bool = False
    first_hold_amount: int = 150_000
    first_hold_min: float = 180
    hold_victim_cancel_p: float = 0.25      # доля жертв, которые успевают одуматься (гипотеза)

    def to_dict(self) -> dict:
        return asdict(self)

    def with_(self, **kw) -> "Rules":
        return replace(self, **kw)


RULE_META: List[dict] = [
    {"key": "amount_limit", "title": "Лимит одного перевода", "action": "block",
     "param": "amount_limit", "unit": "₸"},
    {"key": "daily_limit", "title": "Суточный лимит исходящих", "action": "block",
     "param": "daily_limit", "unit": "₸"},
    {"key": "velocity", "title": "Много переводов за час", "action": "alert",
     "param": "velocity_n", "unit": "шт/ч"},
    {"key": "new_recipient", "title": "Новый получатель и крупная сумма", "action": "alert",
     "param": "new_recipient_amount", "unit": "₸"},
    {"key": "account_age", "title": "Молодой счёт получает крупную сумму", "action": "alert",
     "param": "account_age_days", "unit": "дней"},
    {"key": "shared_phone", "title": "Один телефон у нескольких клиентов", "action": "alert",
     "param": "shared_phone_n", "unit": "клиентов"},
]

WHATIF_META: List[dict] = [
    {"key": "model", "title": "Модель на графе переводов", "action": "realtime",
     "param": "model_threshold", "unit": "порог"},
    {"key": "first_hold", "title": "Задержка первого перевода новому получателю (сценарий)",
     "action": "hold", "param": "first_hold_min", "unit": "мин"},
]

DEFAULT_RULES = Rules()


# Границы значений для редактора правил: фронт берёт их из rule_meta, API проверяет по ним же.
_LIMITS = {'amount_limit': ('amount_limit_on', 50000, 5000000, 50000), 'daily_limit': ('daily_limit_on', 100000, 20000000, 100000), 'velocity_n': ('velocity_on', 2, 30, 1), 'new_recipient_amount': ('new_recipient_on', 10000, 2000000, 10000), 'account_age_days': ('account_age_on', 1, 90, 1), 'shared_phone_n': ('shared_phone_on', 2, 10, 1)}
for _m in RULE_META:
    _on, _lo, _hi, _st = _LIMITS[_m["param"]]
    _m.update({"on_param": _on, "min": _lo, "max": _hi, "step": _st,
               "default": getattr(DEFAULT_RULES, _m["param"])})
