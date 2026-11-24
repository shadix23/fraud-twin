#!/bin/bash
# Собирает папку деплоя Fraud Twin v20: статика + Python-функция. Затем preview-деплой.
#   vercel/build-deploy.sh [папка деплоя] [--deploy]
# Статику перед этим собери: cd app && npm run build:static (или что даёт app/dist-static).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; FT="$HERE/.."
OUT="${1:-$FT/.deploy}"
PROJ="${VERCEL_PROJECT_JSON:-}"
mkdir -p "$OUT/.vercel"
find "$OUT" -mindepth 1 -maxdepth 1 ! -name .vercel -exec rm -rf {} +
cp -R "$FT/app/dist-static/." "$OUT/"
cp -R "$HERE/api" "$OUT/api"; cp "$HERE/vercel.json" "$HERE/requirements.txt" "$OUT/"
cp -R "$FT/sim/fraudtwin" "$OUT/fraudtwin"
find "$OUT" -name __pycache__ -prune -exec rm -rf {} +
[ -f "$OUT/.vercel/project.json" ] || { [ -n "$PROJ" ] && cp "$PROJ" "$OUT/.vercel/project.json"; } || true
echo "собрано: $OUT"
if [ "${2:-}" = "--deploy" ]; then cd "$OUT" && npx -y vercel@latest deploy; fi
