"""FastAPI поверх симулятора. Ответы в том же формате, что готовые прогоны JSON.

    cd fraud-twin/sim && .venv/bin/uvicorn fraudtwin.api:app --port 8410

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
from .model import model_info
from .redteam import hole_scenario, search
from .rules import DEFAULT_RULES, Rules
from .schemes import PRESETS, plan_attack, preset
from .report import (CalibError, PROFILE_KEYS, build_report, calib_name, calib_profile,
                     calib_rules, normalize)
from .world import generate_world

BENCH = os.path.join(os.path.dirname(__file__), "..", "..", "model", "benchmark.json")

app = FastAPI(title="Fraud Twin API", version="0.3")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_lock = threading.Lock()   # атака временно добавляет дропов в мир
_worlds: "OrderedDict[tuple, object]" = OrderedDict()   # калиброванные миры, последние 4
_cache: Dict[tuple, dict] = {}


def _calib(c: Optional[dict]) -> dict:
    try:
        return normalize(c)
    except CalibError as e:
        raise HTTPException(422, str(e))


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
    allowed = set(DEFAULT_RULES.to_dict())
    bad = set(over) - allowed
    if bad:
        raise HTTPException(422, f"Неизвестные параметры правил: {sorted(bad)}")
    return base.with_(**over)


def _ckey(c: dict) -> tuple:
    return tuple(sorted(c.items()))


def _key(key: str) -> str:
    if key not in PRESETS:
        raise HTTPException(404, f"Нет схемы {key}. Есть: {list(PRESETS)}")
    return key


class CalibReq(BaseModel):
    calib: Optional[dict] = None   # ползунки калибровки, пусто = демо-банк


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
def world():
    with _lock:
        return _bank(_calib(None))


@app.post("/world")
def world_calibrated(req: CalibReq):
    c = _calib(req.calib)
    with _lock:
        return _bank(c)


@app.get("/attack/{key}")
def attack(key: str):
    _key(key)
    with _lock:
        return _attack(_calib(None), key)


@app.post("/attack")
def attack_calibrated(req: AttackReq):
    _key(req.scheme)
    c = _calib(req.calib)
    with _lock:
        return _attack(c, req.scheme)


class RedteamReq(AttackReq):
    rules: Optional[dict] = None
    generations: int = 10


@app.post("/redteam")
def redteam(req: RedteamReq):
    _key(req.scheme)
    c = _calib(req.calib)
    rules = _rules(c, req.rules)
    with _lock:
        w = _world_for(c)
        res = search(w, req.scheme, rules, gens=max(2, min(20, req.generations)))
        res["scenario"] = hole_scenario(w, res, rules)
    return res


@app.post("/report")
def report(req: CalibReq):
    """Отчёт краш-теста по всем схемам: ~4-6 с на 5 000 клиентов."""
    c = _calib(req.calib)
    k = ("report",) + _ckey(c)
    with _lock:
        if k not in _cache:
            _cache[k] = build_report(_world_for(c), calib_rules(c), calib_name(c), c)
        return _cache[k]


@app.get("/report")
def report_default():
    return report(CalibReq())


@app.on_event("startup")
def _warm():
    """Отчёт демо-банка считается ~15 с: прогреваем кэш в фоне при старте."""
    threading.Thread(target=lambda: report(CalibReq()), daemon=True).start()


class WhatifReq(AttackReq):
    overrides: Optional[dict] = None   # параметры схемы (например, найденная дыра)
    rules: Optional[dict] = None       # исходные правила банка
    whatif: dict = {"model_on": True}  # вмешательство


@app.post("/whatif")
def whatif(req: WhatifReq):
    _key(req.scheme)
    c = _calib(req.calib)
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
        return {"synthetic": True, "scheme": req.scheme,
                "before": {"metrics": before, "honest": honest_cost(w, before_r)},
                "after": {"metrics": after, "honest": honest_cost(w, after_r)}}


class ClientCheckReq(AttackReq):
    rules: Optional[dict] = None       # правила банка (по умолчанию из калибровки)
    overrides: Optional[dict] = None   # параметры схемы; пусто и hole=true -> дыра ИИ-мошенника
    hole: bool = True


@app.post("/client-check")
def client_check(req: ClientCheckReq):
    """Как это видит клиент: оценка карты получателя до перевода. ~0,5-1,5 с без кэша."""
    _key(req.scheme)
    c = _calib(req.calib)
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
        return _cache[k]


@app.get("/client-check")
def client_check_default():
    return client_check(ClientCheckReq())


@app.get("/model")
def model():
    bench = None
    if os.path.exists(BENCH):
        with open(BENCH, encoding="utf-8") as f:
            bench = json.load(f)
    return {"model": model_info(), "benchmark": bench}


@app.get("/health")
def health():
    return {"ok": True, "worlds": len(_worlds)}


# Собранный фронт (app/dist) с того же адреса: один процесс для демо.
# Маршруты API объявлены выше и имеют приоритет над статикой.
_DIST = os.path.join(os.path.dirname(__file__), "..", "..", "app", "dist")
if os.path.isdir(_DIST):
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="app")
