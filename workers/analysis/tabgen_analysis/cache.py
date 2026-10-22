import json
import os
from pathlib import Path
from typing import Any, Callable

from .config import track_dir


def cached_json(audio_hash: str, stage_key: str, compute: Callable[[], Any]) -> Any:
    """Per-stage cache: data/tracks/<hash>/stages/<stage_key>.json.

    stage_key embeds the model/version so swapping one model only recomputes that stage.
    """
    path = track_dir(audio_hash) / "stages" / f"{stage_key}.json"
    if path.exists():
        return json.loads(path.read_text())
    result = compute()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(result))
    os.replace(tmp, path)
    return result


def write_json_atomic(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False))
    os.replace(tmp, path)
