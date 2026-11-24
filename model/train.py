"""Обучение модели риска на синтетических мирах и честный бенчмарк.

    cd fraud-twin/sim && .venv/bin/python ../model/train.py --worlds 80

1. Датасет: worlds миров на каждую из 5 схем (fraudtwin.dataset), ~1-2 мин на Mac CPU.
2. Leave-one-scheme-out: учим на 4 схемах, проверяем на пятой, которой модель не видела.
   Сравнение на уровне счёта (дроп или нет): правила банка / эвристика дня 1 / бустинг.
3. Деньги: в демо-банке (5 000 клиентов) атака каждой схемы против правил и правил +
   модели, обученной БЕЗ этой схемы. Плюс цена для честных клиентов.
4. Итоговая модель (все 5 схем) -> sim/fraudtwin/model_gbdt.json (инференс на чистом Python),
   бенчмарк -> model/benchmark.json.

Бустинг: HistGradientBoostingClassifier из scikit-learn (гистограммный бустинг, как
LightGBM). LightGBM на этом Mac не грузится без системной libomp, ставить её вне venv
не стали. GNN не обучали: отложено, см. benchmark.json -> notes.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, roc_auc_score

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "sim"))

from fraudtwin import DEFAULT_RULES, PRESETS, BankProfile, generate_world, plan_attack  # noqa: E402
from fraudtwin.dataset import build  # noqa: E402
from fraudtwin.engine import honest_cost, run_attack  # noqa: E402
from fraudtwin.model import FEATURE_NAMES, HeuristicScorer, TreeScorer, MODEL_PATH  # noqa: E402
from fraudtwin.schemes import preset  # noqa: E402

HONEST_FLAG_RATE = 0.0005   # рабочий порог: модель приостанавливает 5 из 10 тыс. честных переводов
SCHEME_RU = {k: p.title for k, p in PRESETS.items()}


def stack(ds):
    X = np.array([x for d in ds for x in d["X"]], dtype=np.float64)
    cols = {k: np.array([v for d in ds for v in d[k]]) for k in ("y", "src", "victim", "rule_flag")}
    cols["world"] = np.array([d["world"] for d in ds for _ in d["y"]])
    cols["scheme"] = np.array([d["scheme"] for d in ds for _ in d["y"]])
    return X, cols


def fit(X, y):
    clf = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.08, max_leaf_nodes=15,
                                         min_samples_leaf=40, l2_regularization=1.0,
                                         class_weight={0: 1, 1: 5}, random_state=0)
    return clf.fit(X, y)


def export(clf, threshold, meta) -> dict:
    trees = []
    for it in clf._predictors:
        nodes = it[0].nodes
        trees.append([[int(n["feature_idx"]) if not n["is_leaf"] else -1,
                       float(n["num_threshold"]), int(n["left"]), int(n["right"]),
                       float(n["value"])] for n in nodes])
    return {"name": "бустинг на графовых признаках", "threshold": float(threshold),
            "baseline": float(np.ravel(clf._baseline_prediction)[0]), "features": FEATURE_NAMES,
            "trees": trees, "meta": meta}


def account_level(cols, score):
    """Счёт = (мир, id). Скор счёта = максимум по его исходящим переводам."""
    key = cols["world"].astype(np.int64) * 1_000_000 + cols["src"].astype(np.int64)
    order = np.argsort(key, kind="stable")
    k, s = key[order], score[order]
    uniq, start = np.unique(k, return_index=True)
    acc_score = np.maximum.reduceat(s, start)
    acc_y = np.maximum.reduceat(cols["y"][order], start)
    acc_rule = np.maximum.reduceat(cols["rule_flag"][order], start)
    return acc_y, acc_score, acc_rule


def pr_at(y, flag):
    tp = int(((flag == 1) & (y == 1)).sum())
    fp = int(((flag == 1) & (y == 0)).sum())
    return {"precision": round(tp / max(1, tp + fp), 3), "recall": round(tp / max(1, int(y.sum())), 3)}


def threshold_for(clf, X, y):
    s = clf.predict_proba(X[y == 0])[:, 1]
    return float(np.quantile(s, 1 - HONEST_FLAG_RATE))


def money_test(world, key, scorer):
    """Атака пресета в демо-банке: правила против правил + модель."""
    world.clear_attack()
    plan = plan_attack(world, preset(key), seed=1)
    base = run_attack(world, DEFAULT_RULES, plan).attack_metrics()
    with_m = run_attack(world, DEFAULT_RULES.with_(model_on=True), plan, scorer=scorer).attack_metrics()
    world.clear_attack()
    cost = honest_cost(world, DEFAULT_RULES.with_(model_on=True), scorer=scorer)
    return {
        "attempted_kzt": base["attempted_kzt"],
        "rules_withdrawn_kzt": base["withdrawn_kzt"],
        "model_withdrawn_kzt": with_m["withdrawn_kzt"],
        "rules_withdrawn_pct": round(100 * base["withdrawn_kzt"] / base["attempted_kzt"], 1),
        "model_withdrawn_pct": round(100 * with_m["withdrawn_kzt"] / base["attempted_kzt"], 1),
        "model_honest_suspended_per_10k": round(cost["suspended"] * 10_000 / max(1, cost["honest_watched_tx"]), 1),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worlds", type=int, default=80, help="миров на схему")
    args = ap.parse_args()
    t0 = time.time()
    ds = build(args.worlds)
    X, cols = stack(ds)
    y = cols["y"]
    t_data = time.time() - t0
    print(f"датасет: {len(ds)} миров, {len(y)} переводов, дропских {int(y.sum())}, {t_data:.0f} с")

    heur = HeuristicScorer()
    h_all = np.array([heur(list(x)) for x in X])
    demo = generate_world(BankProfile())
    rows, keep = [], []
    for key in PRESETS:
        tr, te = cols["scheme"] != key, cols["scheme"] == key
        clf = fit(X[tr], y[tr])
        thr = threshold_for(clf, X[tr], y[tr])
        p = clf.predict_proba(X[te])[:, 1]
        sub = {k: v[te] for k, v in cols.items()}
        ay, a_gb, a_rule = account_level(sub, p)
        _, a_h, _ = account_level(sub, h_all[te])
        loso = TreeScorer(export(clf, thr, {}))
        keep.append(loso)  # id() скорера - ключ кеша honest_cost
        row = {
            "held_out": key, "title": SCHEME_RU[key],
            "accounts": int(len(ay)), "drops": int(ay.sum()),
            "pr_auc": {"rules": round(float(average_precision_score(ay, a_rule)), 3),
                       "heuristic": round(float(average_precision_score(ay, a_h)), 3),
                       "boosting": round(float(average_precision_score(ay, a_gb)), 3)},
            "roc_auc_boosting": round(float(roc_auc_score(ay, a_gb)), 3),
            "at_threshold": {"rules": pr_at(ay, a_rule),
                             "heuristic": pr_at(ay, (a_h >= heur.threshold).astype(int)),
                             "boosting": pr_at(ay, (a_gb >= thr).astype(int))},
            "money": money_test(demo, key, loso),
            "money_heuristic": money_test(demo, key, heur),
        }
        rows.append(row)
        pa = row["pr_auc"]
        m = row["money"]
        print(f"{key:15s} PR-AUC правила {pa['rules']:.3f} эвристика {pa['heuristic']:.3f} "
              f"бустинг {pa['boosting']:.3f} | выведено {m['rules_withdrawn_pct']}% -> "
              f"{m['model_withdrawn_pct']}% (эвристика {row['money_heuristic']['model_withdrawn_pct']}%), "
              f"честных приостановлено {m['model_honest_suspended_per_10k']}/10к")

    clf = fit(X, y)
    thr = threshold_for(clf, X, y)
    mean = lambda f: round(float(np.mean([f(r) for r in rows])), 3)  # noqa: E731
    summary = {
        "pr_auc_mean": {k: mean(lambda r, k=k: r["pr_auc"][k]) for k in ("rules", "heuristic", "boosting")},
        "withdrawn_pct_mean": {"rules": mean(lambda r: r["money"]["rules_withdrawn_pct"]),
                               "heuristic": mean(lambda r: r["money_heuristic"]["model_withdrawn_pct"]),
                               "boosting": mean(lambda r: r["money"]["model_withdrawn_pct"])},
    }
    meta = {"trained_on": list(PRESETS), "worlds": len(ds), "rows": int(len(y)),
            "drop_rows": int(y.sum()), "algo": "HistGradientBoosting (scikit-learn)",
            "summary": summary}
    with open(MODEL_PATH, "w", encoding="utf-8") as f:
        json.dump(export(clf, thr, meta), f, ensure_ascii=False, separators=(",", ":"))
    bench = {
        "synthetic": True,
        "how": "leave-one-scheme-out: модель учится на 4 схемах и проверяется на пятой; "
               "уровень счёта (дроп или нет); деньги - атака пресета в демо-банке 5 000 клиентов",
        "dataset": meta, "threshold_honest_flag_rate": HONEST_FLAG_RATE,
        "rows": rows, "summary": summary,
        "notes": ["Всё на синтетике: это проверка обобщения на новую схему, а не качество на данных банка.",
                  "GNN (GraphSAGE) не обучали: в этой сборке только CPU Mac, отложено в «что дальше».",
                  "LightGBM заменён гистограммным бустингом scikit-learn (тот же класс алгоритмов)."],
        "seconds": round(time.time() - t0),
    }
    with open(os.path.join(HERE, "benchmark.json"), "w", encoding="utf-8") as f:
        json.dump(bench, f, ensure_ascii=False, indent=1)
    print("итог:", json.dumps(summary, ensure_ascii=False), f"порог {thr:.3f}", f"{time.time()-t0:.0f} с")


if __name__ == "__main__":
    main()
