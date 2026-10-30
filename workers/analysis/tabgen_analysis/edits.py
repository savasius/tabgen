"""Hand corrections on top of the automatic analysis.

Stored per song in data/tracks/<hash>/edits.json, apart from the analysis files, so they survive
reanalysis (the user's correction is the ground truth; a new engine must not overwrite it):

  {"tabs":   {"all": [note, ...], "s1": [...]},     replaces that guitar's notes
   "chords": {"all": {"<beat index>": "A:min"}, ...},  per-beat chord labels
   "tempo_factor": 2 | 0.5,                            beat twice / half as fast (pipeline.run)
   "updated_at": 1730000000.0}

apply() rewrites tab notes, alphaTex/MusicXML, grid and chord segments, and marks what changed.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from . import tab_export
from .cache import write_json_atomic
from .chord_label import parse
from .config import track_dir
from .fingering import TUNING_NAMES
from .stages import post

MAX_FRET = 24
TECHNIQUES = {"bend", "slide", "hammer", "pull", "vibrato", "palmMute"}


def edits_path(audio_hash: str) -> Path:
    return track_dir(audio_hash) / "edits.json"


def load(audio_hash: str) -> dict:
    p = edits_path(audio_hash)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return {}


def _save(audio_hash: str, data: dict) -> dict:
    data["updated_at"] = time.time()
    if not data.get("tabs") and not data.get("chords") and not data.get("tempo_factor"):
        edits_path(audio_hash).unlink(missing_ok=True)
        return {}
    write_json_atomic(edits_path(audio_hash), data)
    return data


def _open_midi(tuning: list[str], string: int, capo: int) -> int:
    """MIDI of an open string; `string` is the tab's display number (1 = high e)."""
    names = tuning or TUNING_NAMES
    return tab_export._midi_from_name(names[len(names) - string]) + capo


def clean_notes(notes: list[dict], tuning: list[str], capo: int, duration: float) -> list[dict]:
    """Validate notes from the client; pitch always follows string + fret."""
    out = []
    n_strings = len(tuning or TUNING_NAMES)
    for n in notes:
        string, fret = int(n["string"]), int(n["fret"])
        start = max(0.0, float(n["start"]))
        end = min(float(duration), max(start + 0.02, float(n.get("end", start + 0.25))))
        if not 1 <= string <= n_strings or not 0 <= fret <= MAX_FRET:
            raise ValueError(f"string {string} / fret {fret} out of range")
        techs = [t for t in (n.get("techniques") or []) if t.get("type") in TECHNIQUES]
        out.append({
            "start": round(start, 4), "end": round(end, 4), "qstart": round(start, 4), "qend": round(end, 4),
            "t0": round(float(n.get("t0", start)), 4),
            "midi": _open_midi(tuning, string, capo) + fret, "string": string, "fret": fret,
            "velocity": n.get("velocity"), "confidence": n.get("confidence"),
            "low_confidence": False if n.get("edited") else bool(n.get("low_confidence")),
            "techniques": techs, "source": n.get("source") or "edit",
            **({"edited": True} if n.get("edited") else {}),
        })
    out.sort(key=lambda r: (r["start"], r["string"]))  # same order as the web editor
    return out


def set_tab(audio_hash: str, part: str, notes: list[dict] | None) -> dict:
    data = load(audio_hash)
    tabs = data.setdefault("tabs", {})
    if notes is None:
        tabs.pop(part, None)
    else:
        tabs[part] = notes
    return _save(audio_hash, data)


def set_chords(audio_hash: str, part: str, beats: dict[str, str] | None) -> dict:
    data = load(audio_hash)
    chords = data.setdefault("chords", {})
    if beats is None:
        chords.pop(part, None)
    else:
        for label in beats.values():
            if label != "N" and parse(label).root is None:
                raise ValueError(f"unknown chord {label!r}")
        chords[part] = {str(int(k)): v for k, v in beats.items()}
    return _save(audio_hash, data)


def set_tempo(audio_hash: str, factor: float | None) -> dict:
    """Store a tempo correction (2, 0.5, or None for automatic). Takes effect on reanalysis.
    Chord fixes are per beat, so they no longer line up with the new grid and are dropped;
    tab fixes are timed notes and carry over."""
    if factor not in (None, 0.5, 2):
        raise ValueError("tempo factor must be 2, 0.5 or automatic")
    data = load(audio_hash)
    if factor is None:
        data.pop("tempo_factor", None)
    else:
        data["tempo_factor"] = factor
    data.pop("chords", None)
    return _save(audio_hash, data)


def _retab(a: dict, tab: dict, notes: list[dict]) -> dict:
    tuning = tab.get("tuning") or TUNING_NAMES
    kw = {"title": (a.get("meta") or {}).get("title") or a["id"], "bpm": a["tempo"]["bpm"],
          "tuning": tuning, "ts": a["tempo"].get("time_signature") or "4/4"}
    tex = tab_export.to_alphatex(notes, a["bars"], a["beats"], a["duration"], **kw)
    stats = dict(tab.get("stats") or {})
    stats.update(n_notes=len(notes), n_low_confidence=sum(1 for n in notes if n.get("low_confidence")))
    return {**tab, "notes": notes, "alpha_tex": tex, "stats": stats, "edited": True}


def musicxml(a: dict, tab: dict) -> str:
    kw = {"title": (a.get("meta") or {}).get("title") or a["id"], "bpm": a["tempo"]["bpm"],
          "tuning": tab.get("tuning") or TUNING_NAMES, "ts": a["tempo"].get("time_signature") or "4/4"}
    return tab_export.to_musicxml(tab.get("notes") or [], a["bars"], a["beats"], a["duration"], **kw)


def _regrid(grid: list[dict], beats: dict[str, str]) -> list[dict]:
    out = [dict(g) for g in grid]
    for k, label in beats.items():
        i = int(k)
        if 0 <= i < len(out):
            out[i]["chord"] = label
            out[i]["edited"] = True
    return out


def apply(a: dict, data: dict | None = None) -> dict:
    """The analysis with the user's corrections applied (does not touch the file on disk)."""
    data = load(a["id"]) if data is None else data
    if not data:
        return a
    a = dict(a)
    tabs, chords = data.get("tabs") or {}, data.get("chords") or {}
    if "all" in tabs and a.get("tab"):
        a["tab"] = _retab(a, a["tab"], tabs["all"])
    if "all" in chords:
        a["grid"] = _regrid(a["grid"], chords["all"])
        a["chords"] = post.merge_chords(a["grid"])
    parts = []
    for p in a.get("parts") or []:
        p = dict(p)
        if p["id"] in tabs:
            p["tab"] = _retab(a, p["tab"], tabs[p["id"]])
        if p["id"] in chords:
            p["grid"] = _regrid(p.get("grid") or a["grid"], chords[p["id"]])
            p["chords"] = post.merge_chords(p["grid"])
            p["chords_source"] = "part"
        parts.append(p)
    if parts:
        a["parts"] = parts
    a["edits"] = {"tabs": sorted(tabs), "chords": sorted(chords), "updated_at": data.get("updated_at")}
    return a
