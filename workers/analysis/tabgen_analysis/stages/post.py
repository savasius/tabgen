"""Align chords to the beat grid, group bars, snap sections to downbeats."""

from collections import Counter

import numpy as np

from ..chord_label import NOTES, parse, pc

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


# ---- systemic chord post-process (not per-song) --------------------------------

_MAJ_EVIDENCE = {"maj", "maj7", "maj6", "7", "9", "maj9", "13", "11"}
_MIN_EVIDENCE = {"min", "min7", "min6", "min9", "minmaj7", "dim", "dim7", "hdim7"}
_TRIAD = {"maj", "min"}


def collapse_power_qualities(labels: list[str], minority_ratio: float = 0.20) -> list[str]:
    """Rewrite flickering major/minor labels on the same root as power chords (:5).

    Power-chord recordings have no third, so large-vocab models randomly pick maj vs min.
    A stable major or minor across the song is left alone. Isolated opposite-quality
    neighbors (F then Fm then F) count as flicker even if the global mix is uneven.
    """
    parsed = [parse(lab) for lab in labels]
    maj: dict[str, int] = {}
    mn: dict[str, int] = {}
    for c in parsed:
        if c.is_none or c.root is None or c.quality not in _TRIAD:
            continue
        if c.quality == "maj":
            maj[c.root] = maj.get(c.root, 0) + 1
        else:
            mn[c.root] = mn.get(c.root, 0) + 1
    collapse: set[str] = set()
    for root in set(maj) | set(mn):
        a, b = maj.get(root, 0), mn.get(root, 0)
        triad = a + b
        if triad >= 4 and a and b and min(a, b) / triad >= minority_ratio:
            collapse.add(root)

    out = []
    for i, (lab, c) in enumerate(zip(labels, parsed)):
        if c.is_none or c.root is None or c.quality not in _TRIAD:
            out.append(lab)
            continue
        if c.root in collapse:
            out.append(f"{c.root}:5")
            continue
        flicker = False
        for j in (i - 1, i + 1):
            if 0 <= j < len(parsed):
                n = parsed[j]
                if (not n.is_none) and n.root == c.root and n.quality in _TRIAD and n.quality != c.quality:
                    flicker = True
        out.append(f"{c.root}:5" if flicker else lab)
    return out


def _quality_mode(quality: str | None) -> str | None:
    if quality in _MIN_EVIDENCE:
        return "minor"
    if quality in _MAJ_EVIDENCE:
        return "major"
    return None


# Guitarists count a pulse in roughly this range. Beat This! (and most trackers)
# often lock onto 2× or ½× the felt beat; fold when the raw BPM is outside.
_GUITAR_BPM_LO = 70.0
_GUITAR_BPM_HI = 168.0


def fold_tempo_octave(beats: dict, duration: float | None = None) -> dict:
    """Rewrite a half- or double-time beat grid into a guitar-typical BPM.

    Not a per-song override: any tracker BPM below ~70 is doubled (midpoints
    inserted); any BPM above ~168 is halved (every other beat kept, preferring
    the parity that still hits the reported downbeats).
    """
    bpm = float(beats.get("bpm") or 0)
    raw = list(beats.get("beats") or [])
    down = list(beats.get("downbeats") or [])
    if bpm <= 0 or len(raw) < 4:
        return beats

    def _hits(seq: list[float]) -> int:
        if not down:
            return 0
        return sum(1 for d in down if any(abs(d - t) < 0.06 for t in seq))

    if bpm < _GUITAR_BPM_LO and (2 * bpm) <= _GUITAR_BPM_HI + 8:
        new_b: list[float] = []
        for i, t in enumerate(raw):
            new_b.append(float(t))
            if i + 1 < len(raw):
                new_b.append(round((t + raw[i + 1]) / 2.0, 4))
        if len(raw) >= 2:
            tail = raw[-1] + (raw[-1] - raw[-2]) / 2.0
            if duration is None or tail < float(duration) - 0.04:
                new_b.append(round(tail, 4))
        return {**beats, "beats": new_b, "bpm": round(bpm * 2.0, 1),
                "bpm_raw": round(bpm, 1), "tempo_folded": "double"}

    if bpm > _GUITAR_BPM_HI and (bpm / 2.0) >= _GUITAR_BPM_LO - 8:
        even, odd = raw[0::2], raw[1::2]
        new_b = even if _hits(even) >= _hits(odd) else odd
        if len(new_b) < 4:
            return beats
        new_db = [d for d in down if any(abs(d - t) < 0.06 for t in new_b)]
        if len(new_db) < 2:
            new_db = new_b[0::2]
        return {**beats, "beats": [round(t, 4) for t in new_b],
                "downbeats": [round(t, 4) for t in new_db],
                "bpm": round(bpm / 2.0, 1), "bpm_raw": round(bpm, 1),
                "tempo_folded": "half"}
    return beats


# Tonal hierarchy (Temperley-style) over chord *roots*, used to pick among
# S-KEY / relative / opening-chord candidates. Not a song list.
_MAJ_DEG = {0: 2.2, 2: 0.6, 4: 0.7, 5: 1.4, 7: 1.6, 9: 0.8, 11: 0.3}
_MIN_DEG = {0: 2.2, 2: 0.5, 3: 1.1, 5: 1.5, 7: 1.3, 8: 1.2, 10: 0.9}


def collapse_missing_thirds(labels: list[str], intervals: list[tuple[float, float]],
                            notes: list[dict], min_notes: int = 2) -> list[str]:
    """If sounding pitches have root+fifth and no third, the beat is a power chord.

    Complements flicker detection: a model can label a fifth-only riff as stable
    major (or stable minor) for the whole song. Uses transcribed notes, not a song list.
    """
    if not notes:
        return labels
    out = []
    for lab, (t0, t1) in zip(labels, intervals):
        c = parse(lab)
        if c.is_none or c.root is None or c.quality not in _TRIAD:
            out.append(lab)
            continue
        pcs: set[int] = set()
        for n in notes:
            if float(n["end"]) <= t0 or float(n["start"]) >= t1:
                continue
            pcs.add(int(n["midi"]) % 12)
        if len(pcs) < min_notes:
            out.append(lab)
            continue
        r = pc(c.root)
        if r in pcs and (r + 7) % 12 in pcs and (r + 4) % 12 not in pcs and (r + 3) % 12 not in pcs:
            out.append(f"{c.root}:5")
        else:
            out.append(lab)
    return out


def rebuild_after_labels(beats: dict, beat_labels: list[str], intervals: list[tuple[float, float]],
                         segments: list[dict], duration: float) -> tuple[list[dict], list[dict], str, list[dict]]:
    sections = snap_sections(segments, beats["downbeats"], duration)
    grid, bars, ts = build_grid(beats["beats"], beats["downbeats"], beat_labels, intervals, sections)
    return grid, bars, ts, merge_chords(grid)


def _relative_pair(tonic: str, mode: str) -> tuple[str, str]:
    tpc = pc(tonic)
    rel_pc = (tpc + 9) % 12 if mode == "major" else (tpc + 3) % 12
    return NOTES[rel_pc], ("minor" if mode == "major" else "major")


def _score_key(tonic_name: str, mode: str, chords: list[dict]) -> float:
    t = pc(tonic_name)
    deg_w = _MAJ_DEG if mode == "major" else _MIN_DEG
    s = 0.0
    first = True
    for ch in chords:
        c = parse(ch.get("label") or "N")
        dur = float(ch.get("end", 0) - ch.get("start", 0)) or float(ch.get("beats") or 1)
        if c.is_none or c.root is None:
            if not c.is_none:
                first = False
            continue
        deg = (pc(c.root) - t) % 12
        s += dur * deg_w.get(deg, -0.2)
        qm = _quality_mode(c.quality)
        if deg == 0:
            if qm == mode:
                s += 1.1 * dur
            elif qm and qm != mode:
                s -= 0.5 * dur
            if first:
                s += 1.6 * dur
        first = False
    return s


def _key_candidates(key: dict, chords: list[dict]) -> list[tuple[str, str, str]]:
    seen: set[tuple[int, str]] = set()
    out: list[tuple[str, str, str]] = []

    def add(tonic: str | None, mode: str | None, source: str) -> None:
        if not tonic or tonic not in NOTES or mode not in ("major", "minor"):
            return
        k = (pc(tonic), mode)
        if k in seen:
            return
        seen.add(k)
        out.append((NOTES[k[0]], mode, source))

    add(key.get("tonic"), key.get("mode"), "skey")
    if key.get("tonic") in NOTES and key.get("mode") in ("major", "minor"):
        rt, rm = _relative_pair(key["tonic"], key["mode"])
        add(rt, rm, "relative")
    add(key.get("alt_tonic"), key.get("alt_mode"), "skey-alt")

    for ch in chords:
        c = parse(ch.get("label") or "N")
        if c.is_none or c.root is None:
            continue
        qm = _quality_mode(c.quality)
        if qm:
            add(c.root, qm, "opening")
        elif c.quality == "5":
            add(c.root, "minor", "opening-5")
            add(c.root, "major", "opening-5")
        break

    dur_by: dict[tuple[str, str], float] = {}
    for ch in chords:
        c = parse(ch.get("label") or "N")
        if c.is_none or c.root is None:
            continue
        dur = float(ch.get("end", 0) - ch.get("start", 0)) or float(ch.get("beats") or 1)
        qm = _quality_mode(c.quality)
        if qm:
            dur_by[(c.root, qm)] = dur_by.get((c.root, qm), 0.0) + dur
        elif c.quality == "5":
            dur_by[(c.root, "minor")] = dur_by.get((c.root, "minor"), 0.0) + 0.5 * dur
            dur_by[(c.root, "major")] = dur_by.get((c.root, "major"), 0.0) + 0.5 * dur
    if dur_by:
        (root, md), _ = max(dur_by.items(), key=lambda kv: kv[1])
        add(root, md, "duration")
    return out


def reconcile_relative_key(key: dict, chords: list[dict]) -> dict:
    """Disambiguate key using the chord track (relative pair, opening tonic, hierarchy).

    Global key models (including S-KEY) swap a key with its relative, and also
    pick the relative major of a minor-home loop (E major vs F# minor). Score
    every cheap candidate with a Temperley-style root hierarchy plus a first-
    chord tonic prior. Switch only when another candidate is clearly better.
    Not a song-specific override.
    """
    tonic, mode = key.get("tonic"), key.get("mode")
    out = {**key, "skey_tonic": tonic, "skey_mode": mode, "relative_adjusted": False}
    if tonic not in NOTES or mode not in ("major", "minor") or not chords:
        return out

    cands = _key_candidates(key, chords)
    scores = {}
    for name, md, src in cands:
        s = _score_key(name, md, chords)
        if src == "skey":
            s += 0.45 * float(key.get("confidence") or 0.5)
        scores[(name, md)] = (s, src)

    s_det = scores.get((tonic, mode), (0.0, "skey"))[0]
    out["relative_scores"] = {f"{n} {m}": round(v[0], 2) for (n, m), v in scores.items()}
    best_key, (best_s, best_src) = max(scores.items(), key=lambda kv: kv[1][0])
    if best_key != (tonic, mode) and best_s > s_det * 1.05 and best_s > 0:
        out["tonic"], out["mode"] = best_key
        out["relative_adjusted"] = True
        out["key_source"] = best_src
    return out
