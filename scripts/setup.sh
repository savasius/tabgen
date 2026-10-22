#!/usr/bin/env bash
# One-time setup: Python venv + models + web build. Safe to re-run.
# macOS (Apple Silicon or Intel) and Linux. Needs: python3 (3.10-3.12), ffmpeg, node 20+.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1; }

if [[ "$(uname)" == "Darwin" ]]; then
  missing=()
  need ffmpeg || missing+=(ffmpeg)
  need node || missing+=(node)
  if ! need python3.12 && ! need python3.11; then missing+=(python@3.12); fi
  if ((${#missing[@]})); then
    if need brew; then
      say "Installing with Homebrew: ${missing[*]}"
      brew install "${missing[@]}"
    else
      echo "Please install Homebrew (https://brew.sh) or these tools manually: ${missing[*]}" >&2
      exit 1
    fi
  fi
fi

for tool in ffmpeg node npm; do
  need "$tool" || { echo "Missing $tool — please install it first." >&2; exit 1; }
done

PY="${PYTHON:-}"
if [[ -z "$PY" ]]; then
  for c in python3.12 python3.11 python3.10 python3; do
    if need "$c"; then PY="$c"; break; fi
  done
fi
"$PY" -c 'import sys; assert (3,10) <= sys.version_info[:2] <= (3,12), sys.version' 2>/dev/null || {
  echo "Need Python 3.10-3.12 (found: $("$PY" --version 2>&1)). On macOS: brew install python@3.12" >&2; exit 1; }

if [[ ! -x .venv/bin/python ]]; then
  say "Creating .venv with $PY"
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install -q -U pip wheel setuptools

say "Installing PyTorch"
if [[ "$(uname)" == "Linux" ]] && ! need nvidia-smi; then
  pip install -q torch torchaudio --index-url https://download.pytorch.org/whl/cpu
else
  pip install -q torch torchaudio   # macOS wheels include Apple Silicon (MPS) support
fi

say "Installing analysis pipeline + API"
pip install -q -e workers/analysis -e apps/api
# S-KEY pins old torch/numpy versions; install without its deps (they are already satisfied).
pip install -q --no-deps "skey @ git+https://github.com/deezer/s-key@918b83d273568d5041569bb8068843d19a335726"
pip install -q --no-deps nnAudio==0.3.3

say "Downloading model weights (one time, ~1 GB)"
python -m tabgen_analysis.prefetch

say "Building web app"
(cd apps/web && npm ci --no-audit --no-fund && npm run build)

say "Done. Start with:  ./scripts/run.sh   (then open http://localhost:8000)"
