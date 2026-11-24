"""Vercel Python-функция: тот же FastAPI, что локальный сервер, под префиксом /api."""
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, ROOT)
os.environ.setdefault("VERCEL", "1")
os.environ.setdefault("FT_REPORT_JSON", os.path.join(ROOT, "scenarios", "report.json"))

from fraudtwin.api import app as _app  # noqa: E402


async def app(scope, receive, send):
    """Срезаем префикс /api: внутри приложения маршруты без него."""
    if scope["type"] in ("http", "websocket"):
        path = scope.get("path", "")
        if path == "/api" or path.startswith("/api/"):
            scope = dict(scope, path=path[4:] or "/")
            if scope.get("raw_path"):
                scope["raw_path"] = scope["raw_path"][4:] or b"/"
    await _app(scope, receive, send)
