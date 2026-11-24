"""Скор риска для «что если: модель на графе».

Обученная модель - градиентный бустинг на онлайн-признаках счёта (обучение:
fraud-twin/model/train.py, нужен scikit-learn). Здесь только инференс на чистом
Python по деревьям из JSON, поэтому симулятор и API работают без numpy/sklearn.
Если файла модели нет, используется прежняя эвристика (и это видно в model_info()).
"""
from __future__ import annotations

import json
import math
import os
from typing import Callable, List, Optional

FEATURE_NAMES: List[str] = [
    "log_amount", "new_recipient", "log_account_age", "phone_share",
    "log_in_24h", "log_out_24h", "out_in_ratio", "dwell_min", "n_in_24h", "n_src_24h",
    "n_new_src_24h", "n_out_24h", "max_src_pass", "hour", "channel", "pass_through",
]
FEATURE_RU = {
    "log_amount": "сумма перевода", "new_recipient": "новый получатель",
    "log_account_age": "возраст счёта", "phone_share": "клиентов на одном телефоне",
    "log_in_24h": "пришло за 24 ч", "log_out_24h": "ушло за 24 ч",
    "out_in_ratio": "ушло / пришло", "dwell_min": "сколько деньги пролежали",
    "n_in_24h": "входящих за 24 ч", "n_src_24h": "разных отправителей",
    "n_new_src_24h": "незнакомых отправителей", "n_out_24h": "исходящих за 24 ч",
    "max_src_pass": "транзитность отправителей (2-й шаг графа)", "hour": "час",
    "channel": "канал", "pass_through": "транзитность счёта",
}

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model_gbdt.json")

Scorer = Callable[[List[float]], float]


def _sigmoid(z: float) -> float:
    if z < -40:
        return 0.0
    return 1.0 / (1.0 + math.exp(-z))


class HeuristicScorer:
    """Ручная формула дня 1. Остаётся как запасной вариант и как бейзлайн."""
    name = "эвристика"
    threshold = 0.6

    def __call__(self, x: List[float]) -> float:
        f = dict(zip(FEATURE_NAMES, x))
        young = 1.0 if math.expm1(f["log_account_age"]) < 60 else 0.0
        shared = 1.0 if f["phone_share"] >= 3 else 0.0
        unk = min(f["n_new_src_24h"], 3)
        pas, new = f["pass_through"], f["new_recipient"]
        z = (-6 + 3.0 * pas + 0.7 * unk + 1.2 * new + young + shared
             + 2.5 * f["max_src_pass"] + 2.0 * pas * min(unk, 1) * new)
        return _sigmoid(z)


class TreeScorer:
    """Бустинг деревьев: raw = baseline + сумма листьев, риск = sigmoid(raw)."""

    def __init__(self, data: dict):
        self.name = data.get("name", "бустинг")
        self.threshold = float(data.get("threshold", 0.5))
        self.baseline = float(data["baseline"])
        self.trees = [[tuple(n) for n in t] for t in data["trees"]]  # (f, thr, left, right, value)
        self.meta = data.get("meta", {})

    def __call__(self, x: List[float]) -> float:
        raw = self.baseline
        for nodes in self.trees:
            i = 0
            while True:
                f, thr, left, right, val = nodes[i]
                if f < 0:
                    raw += val
                    break
                i = left if x[f] <= thr else right
        return _sigmoid(raw)


_DEFAULT: Optional[Scorer] = None


def load_scorer(path: str = MODEL_PATH) -> Optional[TreeScorer]:
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return TreeScorer(json.load(f))


def default_scorer() -> Scorer:
    global _DEFAULT
    if _DEFAULT is None:
        _DEFAULT = load_scorer() or HeuristicScorer()
    return _DEFAULT


def model_info() -> dict:
    sc = default_scorer()
    meta = getattr(sc, "meta", {})
    return {"name": sc.name, "trained": isinstance(sc, TreeScorer),
            "threshold": sc.threshold, **meta}
