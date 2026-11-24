"""FastAPI поверх симулятора. Ответы в том же формате, что готовые прогоны JSON.

    cd fraud-twin/sim && .venv/bin/uvicorn fraudtwin.api:app --port 8410

Везде параметр lang (ru|en, по умолчанию ru): POST - поле тела, GET - ?lang=. Меняет только тексты,
числа и ключи одинаковые (fraudtwin/i18n.py).

GET  /world  | POST /world {"calib"?}             -> bank.json
GET  /attack/{key} | POST /attack {"scheme","calib"?} -> {key}.json
POST /redteam              {"scheme", "calib"?, "rules"?} -> redteam_{key}.json
GET  /report | POST /report {"calib"?}            -> report.json (отчёт краш-теста)
POST /whatif               {"scheme": key, "calib"?, "overrides": {...}?, "rules": {...}?, "whatif": {...}}
                           -> метрики до/после и цена для честных клиентов
GET  /model                -> описание модели и бенчмарк
GET  /client-check | POST /client-check {"scheme"?, "calib"?, "rules"?, "overrides"?, "hole"?: true}
                           -> экран клиента: риск получателя до перевода, причины, честные цифры
"""
from __future__ import annotations

import json
import os
import threading
from collections import OrderedDict
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .client_check import client_payload, demo_payload
from .engine import honest_cost, run_attack
from .export import bank_payload, scenario_payload
from .i18n import norm_lang, t as _t, translate
from .model import model_info
from .redteam import hole_scenario, search_live
from .rules import DEFAULT_RULES, RULE_META, Rules
from .schemes import PRESETS, plan_attack, preset
from .report import (CalibError, PROFILE_KEYS, build_report, calib_name, calib_profile,
                     calib_rules, normalize)
from .world import generate_world

BENCH = os.path.join(os.path.dirname(__file__), "..", "..", "model", "benchmark.json")

ON_VERCEL = bool(os.environ.get("VERCEL"))
REPORT_JSON = os.environ.get("FT_REPORT_JSON") or os.path.join(
    os.path.dirname(__file__), "..", "..", "app", "dist-static", "scenarios", "report.json")

app = FastAPI(title="Fraud Twin API", version="0.3")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_lock = threading.Lock()   # атака временно добавляет дропов в мир
_worlds: "OrderedDict[tuple, object]" = OrderedDict()   # калиброванные миры, последние 4
_cache: Dict[tuple, dict] = {}


def _calib(c: Optional[dict], lang: str = "ru") -> dict:
    try:
        return normalize(c)
    except CalibError as e:
        raise HTTPException(422, _t(str(e), lang))


def _world_for(c: dict):
    key = tuple(c[k] for k in PROFILE_KEYS)
    if key in _worlds:
        _worlds.move_to_end(key)
        return _worlds[key]
    w = generate_world(calib_profile(c))
    _worlds[key] = w
    while len(_worlds) > 4:
        _worlds.popitem(last=False)
    return w


def _rules(c: dict, over: Optional[dict] = None) -> Rules:
    base = calib_rules(c)
    if not over:
        return base
    defaults = DEFAULT_RULES.to_dict()
    bad = sorted(set(over) - set(defaults))
    if bad:
        raise HTTPException(422, {"code": "rule_unknown", "params": bad})
    meta = {m["param"]: m for m in RULE_META}
    for k, v in over.items():
        if isinstance(defaults[k], bool):
            if not isinstance(v, bool):
                raise HTTPException(422, {"code": "rule_type", "param": k, "expected": "bool"})
        elif v is not None:
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise HTTPException(422, {"code": "rule_type", "param": k, "expected": "number"})
            m = meta.get(k)
            if m and not (m["min"] <= v <= m["max"]):
                raise HTTPException(422, {"code": "rule_range", "param": k,
                                          "min": m["min"], "max": m["max"]})
    return base.with_(**over)


def _ckey(c: dict) -> tuple:
    return tuple(sorted(c.items()))


def _key(key: str, lang: str = "ru") -> str:
    if key not in PRESETS:
        raise HTTPException(404, _t(f"Нет схемы {key}. Есть: {list(PRESETS)}", lang))
    return key


class CalibReq(BaseModel):
    calib: Optional[dict] = None   # ползунки калибровки, пусто = демо-банк
    lang: str = "ru"               # язык текстов в ответе: ru | en (цифры одинаковые)


class AttackReq(CalibReq):
    scheme: str = "student_crypto"


def _bank(c: dict) -> dict:
    k = ("world",) + _ckey(c)
    if k not in _cache:
        _cache[k] = bank_payload(_world_for(c), calib_rules(c), calib_name(c), c)
    return _cache[k]


def _attack(c: dict, key: str) -> dict:
    k = ("attack", key) + _ckey(c)
    if k not in _cache:
        _cache[k] = scenario_payload(_world_for(c), key, calib_rules(c))
    return _cache[k]


@app.get("/world")
def world(lang: str = "ru"):
    with _lock:
        return translate(_bank(_calib(None)), lang)


@app.post("/world")
def world_calibrated(req: CalibReq):
    c = _calib(req.calib, req.lang)
    with _lock:
        return translate(_bank(c), req.lang)


@app.get("/attack/{key}")
def attack(key: str, lang: str = "ru"):
    _key(key, lang)
    with _lock:
        return translate(_attack(_calib(None), key), lang)


@app.post("/attack")
def attack_calibrated(req: AttackReq):
    _key(req.scheme, req.lang)
    c = _calib(req.calib, req.lang)
    with _lock:
        return translate(_attack(c, req.scheme), req.lang)


class RedteamReq(AttackReq):
    rules: Optional[dict] = None
    generations: int = 10


@app.post("/redteam")
def redteam(req: RedteamReq):
    _key(req.scheme, req.lang)
    c = _calib(req.calib, req.lang)
    rules = _rules(c, req.rules)
    base = calib_rules(c)
    ck = ("redteam", req.scheme, req.generations, json.dumps(rules.to_dict(), sort_keys=True)) + _ckey(c)
    if ck in _cache:   # тот же запрос повторно (смена языка, возврат к правилам): без пересчёта
        return translate(_cache[ck], req.lang)
    with _lock:
        w = _world_for(c)
        res = search_live(w, req.scheme, rules, gens=max(2, min(12, req.generations)))
        res["scenario"] = hole_scenario(w, res, rules)
        honest, honest_base = _honest(w, rules), _honest(w, base)
    now, was = rules.to_dict(), base.to_dict()
    res["rules"] = now
    res["rules_changed"] = [{"param": k, "from": was[k], "to": now[k]} for k in now if now[k] != was[k]]
    res["honest"] = honest
    res["honest_base"] = honest_base
    res["source"] = "live"
    _cache[ck] = res
    if len([k for k in _cache if k[0] == "redteam"]) > 64:
        _cache.pop(next(k for k in _cache if k[0] == "redteam"))
    return translate(res, req.lang)


def _honest(w, rules: Rules) -> dict:
    h = honest_cost(w, rules)
    return {"delayed_per_10k": h["delayed_per_10k"], "frozen_clients_pct": h["frozen_clients_pct"],
            "blocked": h["blocked"]}


_static: dict = {}


def _static_report() -> dict:
    if not _static:
        with open(REPORT_JSON, encoding="utf-8") as f:
            _static.update(json.load(f))
    return _static


@app.post("/report")
def report(req: CalibReq):
    """Отчёт краш-теста по всем схемам. Живой расчёт идёт коротким поиском (fast), готовые прогоны
    (export) считаются большим бюджетом, поэтому живые числа могут быть чуть ниже: это нижняя оценка."""
    c = _calib(req.calib, req.lang)
    if ON_VERCEL and c == normalize(None) and os.path.exists(REPORT_JSON):
        return translate(_static_report(), req.lang)   # на Vercel демо-отчёт берётся из готового JSON
    k = ("report",) + _ckey(c)
    with _lock:
        if k not in _cache:
            _cache[k] = build_report(_world_for(c), calib_rules(c), calib_name(c), c, fast=True)
        return translate(_cache[k], req.lang)


@app.get("/report")
def report_default(lang: str = "ru"):
    return report(CalibReq(lang=lang))


@app.on_event("startup")
def _warm():
    """Отчёт демо-банка считается ~15 с: прогреваем кэш в фоне при старте (не на Vercel)."""
    if ON_VERCEL:
        return
    threading.Thread(target=lambda: report(CalibReq()), daemon=True).start()


class WhatifReq(AttackReq):
    overrides: Optional[dict] = None   # параметры схемы (например, найденная дыра)
    rules: Optional[dict] = None       # исходные правила банка
    whatif: dict = {"model_on": True}  # вмешательство


@app.post("/whatif")
def whatif(req: WhatifReq):
    _key(req.scheme, req.lang)
    c = _calib(req.calib, req.lang)
    before_r = _rules(c, req.rules)
    after_r = before_r.with_(**{k: v for k, v in req.whatif.items() if k in DEFAULT_RULES.to_dict()})
    with _lock:
        w = _world_for(c)
        w.clear_attack()
        try:
            plan = plan_attack(w, preset(req.scheme, **(req.overrides or {})), seed=1)
        except TypeError as e:
            raise HTTPException(422, str(e))
        before = run_attack(w, before_r, plan).attack_metrics()
        after = run_attack(w, after_r, plan).attack_metrics()
        w.clear_attack()
        return translate({"synthetic": True, "scheme": req.scheme,
                          "before": {"metrics": before, "honest": honest_cost(w, before_r)},
                          "after": {"metrics": after, "honest": honest_cost(w, after_r)}}, req.lang)


class ClientCheckReq(AttackReq):
    rules: Optional[dict] = None       # правила банка (по умолчанию из калибровки)
    overrides: Optional[dict] = None   # параметры схемы; пусто и hole=true -> дыра ИИ-мошенника
    hole: bool = True


@app.post("/client-check")
def client_check(req: ClientCheckReq):
    """Как это видит клиент: оценка карты получателя до перевода. ~0,5-1,5 с без кэша."""
    _key(req.scheme, req.lang)
    c = _calib(req.calib, req.lang)
    rules = _rules(c, req.rules)
    k = ("client", req.scheme, req.hole, json.dumps(req.overrides, sort_keys=True),
         json.dumps(req.rules, sort_keys=True)) + _ckey(c)
    with _lock:
        if k not in _cache:
            w = _world_for(c)
            try:
                if req.overrides is not None:
                    preset(req.scheme, **req.overrides)
                if req.overrides is None and req.hole:
                    _cache[k] = demo_payload(w, rules, req.scheme)
                else:
                    _cache[k] = client_payload(w, req.scheme, rules, req.overrides)
            except TypeError as e:
                raise HTTPException(422, str(e))
            finally:
                w.clear_attack()
        return translate(_cache[k], req.lang)


@app.get("/client-check")
def client_check_default(lang: str = "ru"):
    return client_check(ClientCheckReq(lang=lang))


@app.get("/model")
def model(lang: str = "ru"):
    bench = None
    if os.path.exists(BENCH):
        with open(BENCH, encoding="utf-8") as f:
            bench = json.load(f)
    return translate({"model": model_info(), "benchmark": bench}, lang)


@app.get("/health")
def health():
    with _lock:
        _world_for(_calib(None))   # прогрев демо-мира: первый /redteam не платит 0,1 с и импорты
    return {"ok": True, "worlds": len(_worlds)}


# Собранный фронт (app/dist) с того же адреса: один процесс для демо.
# Маршруты API объявлены выше и имеют приоритет над статикой.
_DIST = os.path.join(os.path.dirname(__file__), "..", "..", "app", "dist")
if os.path.isdir(_DIST):
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="app")
