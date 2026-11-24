"""Готовые прогоны в JSON для фронта (подстраховка демо без бэкенда).

python3 -m fraudtwin.export --out ../app/public/scenarios
Результат: <out>/ru/*.json и <out>/en/*.json (профили в p_<id>/), числа одинаковые, тексты на языке.
Для текущего фронта ru дублируется по старому пути <out>/*.json (флаг --no-legacy выключает).
Те же функции отдаёт FastAPI (/world, /attack) с параметром lang.
"""
from __future__ import annotations

import argparse
import json
import os
import random
from typing import Dict, List, Optional

from .world import World, generate_world, BankProfile, SEGMENT_RU
from .rules import Rules, DEFAULT_RULES, RULE_META, WHATIF_META
from .schemes import PRESETS, plan_attack, preset
from .engine import honest_cost
from .feed import run_attack_feed, honest_feed
from .client_check import thresholds
from .i18n import LANGS, translate
from .model import model_info

BENCH_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "model", "benchmark.json")


def model_payload() -> dict:
    """Модель и честный бенчмарк (leave-one-scheme-out) для интерфейса."""
    info = model_info()
    out = {"name": info["name"], "trained": info["trained"], "algo": info.get("algo"),
           "worlds": info.get("worlds"), "rows": info.get("rows"), "summary": info.get("summary"),
           "benchmark": []}
    if os.path.exists(BENCH_PATH):
        with open(BENCH_PATH, encoding="utf-8") as f:
            b = json.load(f)
        out["benchmark"] = [{"key": r["held_out"], "title": r["title"], "pr_auc": r["pr_auc"],
                             "rules_pct": r["money"]["rules_withdrawn_pct"],
                             "heuristic_pct": r["money_heuristic"]["model_withdrawn_pct"],
                             "boosting_pct": r["money"]["model_withdrawn_pct"],
                             "honest_per_10k": r["money"]["model_honest_suspended_per_10k"]}
                            for r in b["rows"]]
        out["notes"] = b.get("notes", [])
    return out

SEG_CODE = {"student": "s", "employee": "e", "pensioner": "p", "entrepreneur": "i",
            "merchant": "m", "crypto_trader": "c", "drop": "d"}

WHATIF_VARIANTS = {
    "base": {},
    "model": {"model_on": True},
    "hold": {"first_hold_on": True},
    "model_hold": {"model_on": True, "first_hold_on": True},
}


def bank_payload(world: World, rules: Rules, name: str = "Демо-банк",
                 calib: Optional[dict] = None) -> dict:
    from .report import CALIB_FIELDS, CALIB_PRESETS, DEFAULT_CALIB, preset_id
    n = world.profile.n_clients
    c = calib or dict(DEFAULT_CALIB)
    return {
        "synthetic": True,
        "name": name,
        "calib": c,
        "calib_preset": preset_id(c),
        "calib_fields": CALIB_FIELDS,
        "calib_presets": CALIB_PRESETS,
        "summary": world.summary(),
        "segments_ru": SEGMENT_RU,
        "cloud": "".join(SEG_CODE[c.segment] for c in world.clients[:n]),
        "rules": rules.to_dict(),
        "rule_meta": RULE_META,
        "whatif_meta": WHATIF_META,
        "presets": [{"key": p.key, "title": p.title, "source": p.source,
                     "params": p.to_dict(), "drops": p.n_drops()} for p in PRESETS.values()],
        "honest_cost": {k: honest_cost(world, rules.with_(**v)) for k, v in WHATIF_VARIANTS.items()},
        # те самые честные переводы, из которых сложена цена меры (лента на шаге «Защита»)
        "honest_feed": {k: honest_feed(world, rules.with_(**v)) for k, v in WHATIF_VARIANTS.items()},
        "model": {**model_payload(), "threshold": thresholds()["high"]},
    }


def _node(world: World, cid: int, role: str, **extra) -> dict:
    if cid == world.specials.atm:
        return {"id": cid, "role": "atm", "label": "Банкомат"}
    if cid == world.specials.ext:
        return {"id": cid, "role": "ext", "label": "Другой банк"}
    c = world.client(cid)
    d = {"id": cid, "role": role, "seg": c.segment, "age": c.account_age_days,
         "phone_share": world.phone_share(cid)}
    d.update(extra)
    return d


def scenario_payload(world: World, key: str, rules: Rules = DEFAULT_RULES, seed: int = 1,
                     context: int = 220, **overrides) -> dict:
    world.clear_attack()
    params = preset(key, **overrides)
    plan = plan_attack(world, params, seed=seed)
    runs = {}
    for name, kw in WHATIF_VARIANTS.items():
        # тот же прогон, в журнале добавлены risk и why для ленты переводов
        s = run_attack_feed(world, rules.with_(**kw), plan)
        runs[name] = {"metrics": s.attack_metrics(), "log": s.log, "freezes": s.freezes}

    nodes: Dict[int, dict] = {}
    layer = plan.drop_layer()
    chain = plan.drop_chain()
    for d in plan.drops:
        nodes[d] = _node(world, d, "drop", chain=chain[d], layer=layer[d])
    for ch in plan.chains:
        for v in ch.victims:
            nodes[v] = _node(world, v, "victim", chain=ch.id)
    links: List[dict] = []
    for e in (e for r in runs.values() for e in r["log"]):   # узлы из всех прогонов «что если»
        for cid in (e["src"], e["dst"]):
            if cid not in nodes:
                role = "trader" if cid >= 0 and world.client(cid).segment == "crypto_trader" else "sink"
                nodes[cid] = _node(world, cid, role)

    # контекст банка: друзья жертв и случайные честные клиенты со своими связями
    rng = random.Random(seed)
    ctx_ids: List[int] = []
    for v in plan.victims:
        for f in world.client(v).friends[:3]:
            ctx_ids.append(f)
            links.append({"source": v, "target": f, "kind": "honest"})
    n = world.profile.n_clients
    pool = [c.id for c in world.clients[:n] if c.segment not in ("merchant", "crypto_trader")]
    while len(set(ctx_ids)) < context:
        ctx_ids.append(rng.choice(pool))
    ctx = set(ctx_ids)
    for cid in ctx:
        if cid not in nodes:
            nodes[cid] = _node(world, cid, "honest")
    for cid in ctx:
        for f in world.client(cid).friends:
            if f in ctx and cid < f:
                links.append({"source": cid, "target": f, "kind": "honest"})

    world.clear_attack()
    return {
        "synthetic": True,
        "scheme": params.to_dict(),
        "drops": params.n_drops(),
        "chains": [{"id": c.id, "victims": c.victims, "layers": c.layers} for c in plan.chains],
        "nodes": list(nodes.values()),
        "links": links,
        "runs": runs,
        "horizon_min": world.profile.horizon_h * 60,
    }


def export_profile(out: str, calib: dict, name: str, langs=LANGS, legacy: bool = False,
                   sub: str = "") -> None:
    """Всё для одного профиля банка: bank, схемы, дыры ИИ-мошенника, отчёт.
    Считается один раз по-русски, затем для каждого языка тексты переводятся (числа те же).
    out/<lang>/<sub>/*.json; legacy=True дублирует ru в out/<sub>/*.json (старый путь фронта)."""
    from .redteam import search_strong, hole_scenario
    from .report import build_report, calib_profile, calib_rules

    targets = [(os.path.join(out, lang, sub), lang) for lang in langs]
    if legacy:
        targets.append((os.path.join(out, sub), "ru"))
    for d, _ in targets:
        os.makedirs(d, exist_ok=True)

    def dump(fname: str, data: dict) -> None:
        for d, lang in targets:
            with open(os.path.join(d, fname), "w", encoding="utf-8") as f:
                json.dump(translate(data, lang), f, ensure_ascii=False, separators=(",", ":"))

    world = generate_world(calib_profile(calib))
    rules = calib_rules(calib)
    dump("bank.json", bank_payload(world, rules, name, calib))
    rts = {}
    for key in PRESETS:
        data = scenario_payload(world, key, rules)
        dump(f"{key}.json", data)
        rt = search_strong(world, key, rules)
        rts[key] = rt
        rt_out = dict(rt)
        rt_out["scenario"] = hole_scenario(world, rt, rules)
        dump(f"redteam_{key}.json", rt_out)
        m = data["runs"]["base"]["metrics"]
        print(f"  {key:15s} {m['withdrawn_kzt']/1e6:5.1f}M -> дыра {rt['best']['metrics']['withdrawn_kzt']/1e6:5.1f}M "
              f"({rt['seconds']} с)")
    rep = build_report(world, rules, name, calib, rts)
    dump("report.json", rep)
    print(f"{name}: дыр {rep['summary']['holes_found']}/{rep['summary']['schemes']}, "
          f"уходит {rep['summary']['hole_withdrawn']/1e6:.1f}M из {rep['summary']['hole_attempted']/1e6:.1f}M, "
          f"с моделью {rep['summary']['rematch_withdrawn']/1e6:.1f}M")


def main() -> None:
    """Демо-банк в корень языковой папки, остальные профили в подпапки p_<id>."""
    from .report import CALIB_PRESETS
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "app",
                                                  "public", "scenarios"))
    ap.add_argument("--only", default=None, help="id профиля (demo, digital, regional)")
    ap.add_argument("--no-legacy", action="store_true",
                    help="не дублировать ru по старому пути <out>/*.json")
    args = ap.parse_args()
    for p in CALIB_PRESETS:
        if args.only and p["id"] != args.only:
            continue
        export_profile(args.out, p["values"], p["name"], legacy=not args.no_legacy,
                       sub="" if p["id"] == "demo" else f"p_{p['id']}")


if __name__ == "__main__":
    main()
