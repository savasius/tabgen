"""Align chords to the beat grid, group bars, snap sections to downbeats."""

from collections import Counter

import numpy as np

from ..chord_label import parse

SECTION_LABELS = {"intro", "verse", "chorus", "bridge", "inst", "solo", "outro", "break"}


def _beat_intervals(beats: list[float], duration: float) -> list[tuple[float, float]]:
    if not beats:
        return []
    ends = beats[1:] + [min(duration, beats[-1] + (np.median(np.diff(beats)) if len(beats) > 1 else 0.5))]
    return list(zip(beats, ends))


def chord_per_beat(chords: list[dict], intervals: list[tuple[float, float]]) -> list[str]:
    """Pick, for each beat, the chord label with the largest overlap."""
    out = []
    j = 0
    for b0, b1 in intervals:
        while j < len(chords) and chords[j]["end"] <= b0:
            j += 1
        overlap: dict[str, float] = {}
        k = j
        while k < len(chords) and chords[k]["start"] < b1:
            o = min(b1, chords[k]["end"]) - max(b0, chords[k]["start"])
            if o > 0:
                overlap[chords[k]["label"]] = overlap.get(chords[k]["label"], 0.0) + o
            k += 1
        out.append(max(overlap, key=overlap.get) if overlap else "N")
    return out


def snap_sections(segments: list[dict], downbeats: list[float], duration: float, max_snap: float = 1.5) -> list[dict]:
    db = np.asarray(downbeats)

    def snap(t: float) -> float:
        if len(db) == 0:
            return t
        i = int(np.argmin(np.abs(db - t)))
        return float(db[i]) if abs(db[i] - t) <= max_snap else t

    out = []
    for s in segments:
        if s["label"] not in SECTION_LABELS:
            continue
        start, end = snap(s["start"]), snap(s["end"])
        if out and abs(out[-1]["end"] - start) < max_snap:
            start = out[-1]["end"]
        if end - start < 1.0:
            continue
        if out and out[-1]["label"] == s["label"] and abs(out[-1]["end"] - start) < 0.01 and s["label"] in ("intro", "outro"):
            out[-1]["end"] = end
            continue
        out.append({"label": s["label"], "start": round(start, 3), "end": round(min(end, duration), 3)})
    return out


def build_grid(beats: list[float], downbeats: list[float], beat_labels: list[str],
               intervals: list[tuple[float, float]], sections: list[dict]) -> tuple[list[dict], list[dict], str]:
    """Returns (grid, bars, time_signature). grid = one entry per beat."""
    db_set = set(np.round(downbeats, 3).tolist())
    is_db = [round(b, 3) in db_set for b in beats]

    bars: list[dict] = []
    cur: list[int] = []
    for i, d in enumerate(is_db):
        if d and cur:
            bars.append({"beats": cur})
            cur = []
        cur.append(i)
    if cur:
        bars.append({"beats": cur})

    lengths = Counter(len(b["beats"]) for b in bars[1:-1] or bars)
    beats_per_bar = lengths.most_common(1)[0][0] if lengths else 4
    ts = f"{beats_per_bar}/4" if beats_per_bar in (2, 3, 4, 5, 6) else "4/4"

    def section_at(t: float) -> int | None:
        for si, s in enumerate(sections):
            if s["start"] - 0.05 <= t < s["end"] - 0.05:
                return si
        return None

    grid = []
    for bi, bar in enumerate(bars):
        bar["index"] = bi
        bar["start"] = round(intervals[bar["beats"][0]][0], 3)
        bar["end"] = round(intervals[bar["beats"][-1]][1], 3)
        bar["section"] = section_at(bar["start"] + 0.01)
        bar["pickup"] = bi == 0 and not is_db[bar["beats"][0]]
        for pos, i in enumerate(bar["beats"]):
            grid.append({"t": round(intervals[i][0], 3), "end": round(intervals[i][1], 3), "bar": bi,
                         "pos": pos + (beats_per_bar - len(bar["beats"]) if bar["pickup"] else 0),
                         "chord": beat_labels[i]})
    return grid, bars, ts


def merge_chords(grid: list[dict]) -> list[dict]:
    """Beat-quantized chord segments (consecutive beats with the same label)."""
    out: list[dict] = []
    for g in grid:
        if out and out[-1]["label"] == g["chord"]:
            out[-1]["end"] = g["end"]
            out[-1]["beats"] += 1
        else:
            out.append({"start": g["t"], "end": g["end"], "label": g["chord"], "beats": 1})
    for c in out:
        ch = parse(c["label"])
        c.update({"root": ch.root, "quality": None if ch.is_none else ch.quality, "bass": ch.bass,
                  "normal": ch.level("normal"), "basic": ch.level("basic")})
    return out
