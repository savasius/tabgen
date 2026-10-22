#!/usr/bin/env bash
# Dev mode: API with auto-reload on :8000 and Vite dev server (hot reload) on :5173.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source .venv/bin/activate

uvicorn tabgen_api.main:app --reload --reload-dir apps/api --reload-dir workers/analysis --port 8000 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null' EXIT
cd apps/web && npm run dev
