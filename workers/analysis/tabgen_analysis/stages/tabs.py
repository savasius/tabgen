"""Assemble playable tab: quantize, Viterbi, techniques, alphaTex/MusicXML."""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import soundfile as sf

from .. import fingering, tab_export, techniques
from ..fingering import chord_pitch_classes, detect_tuning, tuning_names

log = logging.getLogger(__name__)

# v2: global Viterbi fingering (fitted on GuitarSet + IDMT), split-bend merge before fingering.
MODEL_KEY = "tab-viterbi-2"


def _chord_at_factory(chords: list[dict]):
    def chord_at(t: float) -> str | None:
        for c in chords:
            if float(c["start"]) - 0.02 <= t < float(c["end"]):
                lab = c.get("label")
                return None if lab in (None, "N") else lab
        return None
    return chord_at


def _hint_weight_factory(sections: list[dict]):
    solo = {(s["start"], s["end"]) for s in sections if s.get("label") in ("solo", "inst")}

    def w(t: float) -> float:
        for a, b in solo:
            if a <= t < b:
                return 0.08  # melody: barely use chord tones
        return 0.4
    return w


def _solo_at_factory(sections: list[dict]):
    ranges = [(s["start"], s["end"]) for s in sections if s.get("label") in ("solo", "inst")]

    def solo_at(t: float) -> bool:
        return any(a <= t < b for a, b in ranges)
    return solo_at


def _centroids(audio_path: Path | None, notes: list[dict]) -> dict[int, float]:
    if audio_path is None or not audio_path.exists() or not notes:
        return {}
    try:
        y, sr = sf.read(str(audio_path), dtype="float32")
    except Exception:
        return {}
    mono = y.mean(axis=1) if getattr(y, "ndim", 1) == 2 else y
    out: dict[int, float] = {}
    for i, n in enumerate(notes):
        a = int(max(0, float(n["start"]) * sr))
        b = int(min(len(mono), float(n["end"]) * sr))
        if b - a < 64:
            continue
        sl = np.asarray(mono[a:b], dtype=np.float64)
        spec = np.abs(np.fft.rfft(sl * np.hanning(len(sl))))
        freqs = np.fft.rfftfreq(len(sl), 1 / sr)
        denom = spec.sum() or 1.0
        out[i] = float((spec * freqs).sum() / denom)
    return out


def _chord_shape_fallback(chords: list[dict], bars: list[dict], tuning: list[int]) -> list[dict]:
    """Last-resort rhythm tab from chord shapes. Every note is low-confidence guesswork."""
    notes = []
    for bar in bars:
        t0, t1 = float(bar["start"]), float(bar["end"])
        label = None
        for c in chords:
            if c["start"] <= t0 + 0.05 < c["end"] and c.get("label") not in (None, "N"):
                label = c["label"]
                break
        pcs = chord_pitch_classes(label) if label else None
        if not pcs:
            continue
        for s, open_p in enumerate(tuning):
            hit = None
            for fret in range(0, 13):
                midi = open_p + fret
                if midi % 12 in pcs:
                    hit = (s, fret, midi)
                    break
            if hit is None:
                continue
            s, fret, midi = hit
            notes.append({
                "start": t0,
                "end": t1,
                "midi": midi,
                "velocity": 0.4,
                "confidence": 0.2,
                "bends": None,
                "source": "chord-shape-fallback",
                "low_confidence": True,
                "string": fingering.display_string(s),
                "string_i": s,
                "fret": fret,
                "techniques": [],
            })
    return notes


def build_tab(
    raw: dict,
    *,
    beats: list[float],
    bars: list[dict],
    sections: list[dict],
    chords: list[dict],
    duration: float,
    bpm: float,
    ts: str,
    title: str,
    guitar_path: Path | None,
    capo: int = 0,
) -> dict:
    notes_in = list(raw.get("notes") or [])
    tuning, tuning_guess = detect_tuning(notes_in)
    chord_at = _chord_at_factory(chords)
    audio = techniques.load_audio(guitar_path)
    techniques.attach_onsets(notes_in, audio)
    # Basic Pitch writes one bent note as two; fold them before fingering so the tab shows
    # "7b9" on one string instead of a fake hammer-on to fret 9 (or 8 on another string).
    notes_in = techniques.resolve_continuations(techniques.merge_split_bends(notes_in, audio))
    assigned = fingering.assign_notes_v2(
        notes_in, tuning=tuning, capo=capo,
        chord_at=chord_at, hint_weight_at=_hint_weight_factory(sections),
    )
    assigned = [n for n in assigned if n.get("string") is not None]
    fallback = None
    if len(assigned) < 8:
        fallback = "chord-shape-fallback"
        assigned = _chord_shape_fallback(chords, bars, tuning)

    cents = _centroids(guitar_path, assigned)
    techniques.annotate(assigned, centroids=cents, solo_at=_solo_at_factory(sections),
                        audio_path=guitar_path, audio=audio)

    playable = [n for n in assigned if n.get("string") is not None]
    playable = tab_export.quantize_notes(playable, beats, duration)
    for n in playable:
        n["orig_start"] = n.get("orig_start", n["start"])
        n["orig_end"] = n.get("orig_end", n["end"])
        n["start"] = n["qstart"]
        n["end"] = n["qend"]
    names = tuning_names(tuning)
    tex = tab_export.to_alphatex(playable, bars, beats, duration, title=title, bpm=bpm, tuning=names, ts=ts)
    xml = tab_export.to_musicxml(playable, bars, beats, duration, title=title, bpm=bpm, tuning=names, ts=ts)

    n_low = sum(1 for n in playable if n.get("low_confidence"))
    tech_counts: dict[str, int] = {}
    tech_conf: dict[str, list[float]] = {}
    for n in playable:
        for t in n.get("techniques") or []:
            kind = t["type"]
            tech_counts[kind] = tech_counts.get(kind, 0) + 1
            tech_conf.setdefault(kind, []).append(float(t.get("confidence") or 0.0))
    # Drop bulky contour arrays from the API payload; keep a compact flag.
    compact = []
    for n in playable:
        row = {
            "start": n["start"], "end": n["end"],
            "qstart": n.get("qstart"), "qend": n.get("qend"),
            # heard onset before grid snapping (eval scores timing on this, not the 16th grid)
            "t0": round(float(n.get("orig_start", n["start"])), 4),
            "midi": n["midi"], "string": n["string"], "fret": n["fret"],
            "velocity": n.get("velocity"), "confidence": n.get("confidence"),
            "low_confidence": bool(n.get("low_confidence")),
            "techniques": n.get("techniques") or [],
            "source": n.get("source"),
        }
        if n.get("onset_ratio") is not None:
            row["onset_ratio"] = n["onset_ratio"]
        compact.append(row)

    return {
        "tuning": names,
        "tuning_guess": tuning_guess,
        "capo": capo,
        "notes": compact,
        "alpha_tex": tex,
        "technique_legend": techniques.LEGEND,
        "models": {
            "notes": raw.get("model"),
            "tabcnn": raw.get("tabcnn"),
            "fingering": MODEL_KEY,
        },
        "stats": {
            "n_notes": len(compact),
            "n_low_confidence": n_low,
            "fallback": fallback,
            "tabcnn_matched": (raw.get("tabcnn") or {}).get("n_notes_matched"),
            "techniques": tech_counts,
            "technique_confidence": {k: round(sum(v) / len(v), 3) for k, v in tech_conf.items()},
        },
        "musicxml": xml,
        "error": None,
    }


def empty_tab(reason: str, bars: list[dict] | None = None, beats: list[float] | None = None,
              duration: float = 1.0, bpm: float = 120, ts: str = "4/4", title: str = "") -> dict:
    bars = bars or [{"index": 0, "start": 0, "end": duration, "beats": [0]}]
    beats = beats or [0.0]
    tex = tab_export.to_alphatex([], bars, beats, duration, title=title, bpm=bpm, ts=ts)
    xml = tab_export.to_musicxml([], bars, beats, duration, title=title, bpm=bpm, ts=ts)
    return {
        "tuning": fingering.TUNING_NAMES,
        "tuning_guess": "standard",
        "capo": 0,
        "notes": [],
        "alpha_tex": tex,
        "technique_legend": techniques.LEGEND,
        "models": {},
        "stats": {"n_notes": 0, "n_low_confidence": 0, "fallback": reason},
        "musicxml": xml,
        "error": reason,
    }
