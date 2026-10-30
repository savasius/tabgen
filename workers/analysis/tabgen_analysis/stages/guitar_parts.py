"""Find the separate guitars inside the Demucs guitar stem (see tabgen_analysis/parts.py).

Returns [] when the stem holds one guitar, so the song keeps its single tab. Otherwise one entry
per guitar with its own notes (and its own audio when the split came from stereo position).
Measured in eval/multi_bench.py.
"""

from __future__ import annotations

import logging
from pathlib import Path

import soundfile as sf

from .. import parts
from ..cache import cached_json
from ..config import track_dir
from . import transcribe as transcribe_stage

log = logging.getLogger(__name__)

MODEL_KEY = "parts-stereo1-role1"


def parts_dir(audio_hash: str) -> Path:
    return track_dir(audio_hash) / "parts" / MODEL_KEY


def part_audio_path(audio_hash: str, part_id: str) -> Path:
    return parts_dir(audio_hash) / f"{part_id}.wav"


def _stereo_split(audio_hash: str, guitar_path: Path) -> list[dict]:
    """Pan clusters as [{id, pan, share}], with their audio written next to the cache."""
    def compute():
        y, sr = sf.read(str(guitar_path), dtype="float32", always_2d=True)
        found = parts.stereo_parts(y)
        if len(found) < 2:
            return []
        d = parts_dir(audio_hash)
        d.mkdir(parents=True, exist_ok=True)
        out = []
        for k, p in enumerate(found):
            pid = f"s{k + 1}"
            sf.write(str(d / f"{pid}.wav"), p.audio, sr)
            out.append({"id": pid, "pan": round(p.pan, 3), "share": round(p.share, 3)})
        return out

    meta = cached_json(audio_hash, f"{MODEL_KEY}-stereo", compute)
    if any(not part_audio_path(audio_hash, m["id"]).exists() for m in meta):
        (track_dir(audio_hash) / "stages" / f"{MODEL_KEY}-stereo.json").unlink(missing_ok=True)
        meta = cached_json(audio_hash, f"{MODEL_KEY}-stereo", compute)
    return meta


def part_tag(meta: dict) -> str:
    """Cache tag for one part's audio. Includes the pan: part ids renumber when the split changes."""
    return f"{MODEL_KEY}-{meta['id']}-pan{meta['pan']:+.3f}"


def find_parts(audio_hash: str, guitar_path: Path, full_raw: dict, tuning: list[int]) -> list[dict]:
    """[{id, role, pan, share, split, audio, raw}] or [] for a single guitar."""
    stereo = _stereo_split(audio_hash, guitar_path)
    if stereo:
        raws = [cached_json(
            audio_hash, f"{transcribe_stage.MODEL_KEY}-src-{part_tag(m)}",
            lambda m=m: transcribe_stage.transcribe(part_audio_path(audio_hash, m["id"]), tuning))
            for m in stereo]
        cleaned = parts.dedupe_bleed([list(r.get("notes") or []) for r in raws])
        roles = parts.assign_roles(cleaned)
        out = []
        for m, raw, notes, role in zip(stereo, raws, cleaned, roles):
            if not notes:
                continue
            out.append({**m, "role": role, "split": "stereo", "tag": part_tag(m),
                        "audio": part_audio_path(audio_hash, m["id"]), "raw": {**raw, "notes": notes}})
        return out if len(out) > 1 else []

    notes = list(full_raw.get("notes") or [])
    if parts.classify_part(notes) != "mixed":
        return []
    split = parts.split_roles(notes)
    if not split:
        return []
    lead, rhythm = split
    meta = {k: v for k, v in full_raw.items() if k != "notes"}
    return [
        {"id": "r1", "role": "rhythm", "pan": 0.0, "share": None, "split": "role",
         "audio": guitar_path, "raw": {**meta, "notes": rhythm}},
        {"id": "r2", "role": "lead", "pan": 0.0, "share": None, "split": "role",
         "audio": guitar_path, "raw": {**meta, "notes": lead}},
    ]


def order(found: list[dict]) -> list[dict]:
    """Rhythm guitars first (left to right), lead last: the order guitarists read a score."""
    return sorted(found, key=lambda p: (p["role"] == "lead", p["pan"]))


def pan_label(pan: float) -> str:
    return "left" if pan < -0.33 else "right" if pan > 0.33 else "centre"
