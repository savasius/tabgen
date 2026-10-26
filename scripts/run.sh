#!/usr/bin/env bash
# Run TabGen locally: API + built web app on one port.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -x .venv/bin/python ]] || { echo "Run ./scripts/setup.sh first." >&2; exit 1; }
# shellcheck disable=SC1091
source .venv/bin/activate

PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"   # HOST=0.0.0.0 to open it from your phone on the same Wi-Fi
# (re)build the web app when it is missing or older than its sources
if [[ ! -f apps/web/dist/index.html ]] || [[ -n "$(find apps/web/src apps/web/public apps/web/index.html apps/web/package.json \
      -newer apps/web/dist/index.html -print -quit)" ]]; then
  echo "Building the web app…"
  (cd apps/web && { [[ -d node_modules ]] || npm ci --no-audit --no-fund; } && npm run build)
fi

URL="http://localhost:${PORT}"
if [[ "$(uname)" == "Darwin" && -z "${NO_BROWSER:-}" ]]; then (sleep 2 && open "$URL") & fi
echo "TabGen → $URL"
exec uvicorn tabgen_api.main:app --host "$HOST" --port "$PORT"
