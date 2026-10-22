"""Tiny JSON-file song library (recent analyses). Personal use: no DB needed."""

import json
import threading
import time

from tabgen_analysis.cache import write_json_atomic
from tabgen_analysis.config import DATA_DIR

_PATH = DATA_DIR / "library.json"
_lock = threading.Lock()


def _load() -> dict:
    if _PATH.exists():
        return json.loads(_PATH.read_text())
    return {}


def upsert(analysis_id: str, meta: dict) -> None:
    with _lock:
        lib = _load()
        entry = lib.get(analysis_id, {})
        entry.update({k: v for k, v in meta.items() if v is not None})
        entry["id"] = analysis_id
        entry["updated_at"] = time.time()
        lib[analysis_id] = entry
        write_json_atomic(_PATH, lib)


def update(analysis_id: str, **fields) -> dict | None:
    with _lock:
        lib = _load()
        if analysis_id not in lib:
            return None
        lib[analysis_id].update(fields)
        write_json_atomic(_PATH, lib)
        return lib[analysis_id]


def get(analysis_id: str) -> dict | None:
    return _load().get(analysis_id)


def list_recent() -> list[dict]:
    return sorted(_load().values(), key=lambda e: e.get("updated_at", 0), reverse=True)
