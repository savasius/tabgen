"""Viterbi string/fret assignment (standard guitar, optional capo, chord-tone hints).

Internal string index 0 = low E … 5 = high E. Display string number is 6 - index
(1 = high e), matching tab convention and MusicXML.
"""

from __future__ import annotations

from itertools import product
from typing import Iterable

from .chord_label import parse, pc

STANDARD_TUNING = [40, 45, 50, 55, 59, 64]  # MIDI: E2 A2 D3 G3 B3 E4
TUNING_NAMES = ["E2", "A2", "D3", "G3", "B3", "E4"]
MAX_FRET = 19
# Guitarists rarely stretch more than this in one grip.
MAX_SPAN = 4

_MIN_Q = {"min", "min7", "min6", "min9", "minmaj7", "dim", "dim7", "hdim7"}
_MAJ_Q = {"maj", "maj7", "maj6", "7", "9", "maj9", "13", "11"}


def midi_name(m: int) -> str:
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return f"{names[int(m) % 12]}{int(m) // 12 - 1}"


def tuning_names(tuning: list[int]) -> list[str]:
    return [midi_name(p) for p in tuning]


def display_string(internal: int) -> int:
    return 6 - internal


def detect_tuning(notes: list[dict], base: list[int] | None = None) -> tuple[list[int], str]:
    """Drop-D if several notes sit below standard low E. Not a per-song special case."""
    base = list(base or STANDARD_TUNING)
    if not notes:
        return base, "standard"
    below = sum(1 for n in notes if int(n["midi"]) < base[0])
    d2 = sum(1 for n in notes if int(n["midi"]) == 38)
    if d2 >= 3 or below >= 4:
        t = list(base)
        t[0] = 38
        return t, "drop_d"
    return base, "standard"


def candidates(midi: int, tuning: list[int], capo: int = 0) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for s, open_p in enumerate(tuning):
        fret = int(midi) - (int(open_p) + capo)
        if 0 <= fret <= MAX_FRET:
            out.append((s, fret))
    return out


def chord_pitch_classes(label: str) -> set[int] | None:
    c = parse(label)
    if c.is_none or c.root is None:
        return None
    r = pc(c.root)
    q = c.quality
    if q in ("5", "1"):
        tones = {0, 7}
    elif q in _MIN_Q:
        tones = {0, 3, 7}
        if "7" in q and q != "minmaj7":
            tones.add(9 if q == "dim7" else 10)
        if q == "min6":
            tones.add(9)
        if q == "minmaj7":
            tones.add(11)
    elif q in ("dim", "dim7"):
        tones = {0, 3, 6}
    elif q == "aug":
        tones = {0, 4, 8}
    elif q in ("sus2",):
        tones = {0, 2, 7}
    elif q in ("sus4", "7sus4", "sus4(b7)"):
        tones = {0, 5, 7}
        if "7" in q or q == "sus4(b7)":
            tones.add(10)
    else:
        tones = {0, 4, 7}
        if q in ("7", "9", "11", "13"):
            tones.add(10)
        if q in ("maj7", "maj9"):
            tones.add(11)
        if q in ("maj6",):
            tones.add(9)
    return {(r + t) % 12 for t in tones}


def _span_cost(frets: Iterable[int]) -> float:
    pressed = [f for f in frets if f > 0]
    if len(pressed) < 2:
        return 0.0
    span = max(pressed) - min(pressed)
    return 0.0 if span <= MAX_SPAN else 12.0 * (span - MAX_SPAN)


def _assign_cost(
    mapping: list[tuple[int, int]],
    midis: list[int],
    chord_pcs: set[int] | None,
    hint_weight: float,
) -> float:
    strings = [s for s, _ in mapping]
    if len(set(strings)) != len(strings):
        return 1e9
    frets = [f for _, f in mapping]
    cost = 0.35 * sum(f for f in frets)  # prefer low positions
    cost += 0.15 * sum(0.0 if f == 0 else 0.4 for f in frets)
    cost += _span_cost(frets)
    if chord_pcs and hint_weight:
        for m in midis:
            if (m % 12) not in chord_pcs:
                cost += 0.55 * hint_weight
            else:
                cost -= 0.12 * hint_weight
    # crossing: higher midi on a lower string
    for (s1, _), m1, (s2, _), m2 in zip(mapping, midis, mapping[1:], midis[1:]):
        if m1 < m2 and s1 > s2:
            cost += 1.8
    return cost


def _enumerate_assignments(
    midis: list[int], tuning: list[int], capo: int
) -> list[list[tuple[int, int]]]:
    cands = [candidates(m, tuning, capo) for m in midis]
    if any(not c for c in cands):
        return []
    out: list[list[tuple[int, int]]] = []
    for combo in product(*cands):
        strings = [s for s, _ in combo]
        if len(set(strings)) == len(strings):
            out.append(list(combo))
    return out


def _trans_cost(prev: list[tuple[int, int]] | None, cur: list[tuple[int, int]]) -> float:
    if not prev:
        return 0.0
    prev_pos = sum(f for _, f in prev) / len(prev)
    cur_pos = sum(f for _, f in cur) / len(cur)
    cost = 1.6 * abs(prev_pos - cur_pos)
    prev_by_midi_string = {i: prev[i][0] for i in range(len(prev))}
    # Same-string continuity when group sizes match isn't always meaningful; use mean string jump.
    mean_ps = sum(s for s, _ in prev) / len(prev)
    mean_cs = sum(s for s, _ in cur) / len(cur)
    cost += 0.5 * abs(mean_ps - mean_cs)
    del prev_by_midi_string
    return cost


def group_onsets(notes: list[dict], window: float = 0.05) -> list[list[dict]]:
    ordered = sorted(notes, key=lambda n: (float(n["start"]), -int(n["midi"])))
    groups: list[list[dict]] = []
    for n in ordered:
        if groups and float(n["start"]) - float(groups[-1][0]["start"]) <= window:
            groups[-1].append(n)
        else:
            groups.append([n])
    return groups


def assign_notes(
    notes: list[dict],
    tuning: list[int] | None = None,
    capo: int = 0,
    chord_at: callable | None = None,
    hint_weight_at: callable | None = None,
) -> list[dict]:
    """Add string/fret/confidence fields. `chord_at(t) -> harte label or None`."""
    tuning = list(tuning or STANDARD_TUNING)
    groups = group_onsets(notes)
    placed: list[dict] = []
    prev: list[tuple[int, int]] | None = None

    for group in groups:
        playable = [n for n in group if candidates(int(n["midi"]), tuning, capo)]
        skipped = [n for n in group if n not in playable]
        for n in skipped:
            placed.append({**n, "string": None, "fret": None, "viterbi_cost": None,
                           "low_confidence": True, "skip_reason": "out_of_range"})

        if not playable:
            continue
        midis = [int(n["midi"]) for n in playable]
        t0 = float(playable[0]["start"])
        label = chord_at(t0) if chord_at else None
        pcs = chord_pitch_classes(label) if label else None
        hw = float(hint_weight_at(t0)) if hint_weight_at else (0.35 if pcs else 0.0)
        options = _enumerate_assignments(midis, tuning, capo)
        if not options:
            for n in playable:
                placed.append({**n, "string": None, "fret": None, "low_confidence": True,
                               "skip_reason": "no_assignment"})
            continue

        scored = []
        for opt in options:
            c = _assign_cost(opt, midis, pcs, hw) + _trans_cost(prev, opt)
            # TabCNN / prior string hint on each note (optional).
            for n, (s, f) in zip(playable, opt):
                hint = n.get("tabcnn")
                if hint and hint.get("string") == s and hint.get("fret") == f:
                    c -= 1.4 * float(hint.get("confidence") or 0.5)
                elif hint and hint.get("string") is not None and hint.get("string") != s:
                    c += 0.35
            scored.append((c, opt))
        scored.sort(key=lambda x: x[0])
        best_c, best = scored[0]
        margin = (scored[1][0] - best_c) if len(scored) > 1 else 9.0
        unsure = margin < 0.45
        span = _span_cost([f for _, f in best])
        prev = best
        for n, (s, f) in zip(playable, best):
            conf = float(n.get("confidence") or n.get("velocity") or 0.5)
            if unsure:
                conf *= 0.7
            if span:
                conf *= 0.75
            placed.append({
                **n,
                "string": display_string(s),
                "string_i": s,
                "fret": f,
                "viterbi_cost": round(best_c, 3),
                "viterbi_margin": round(margin, 3),
                "low_confidence": bool(n.get("low_confidence") or unsure or conf < 0.35),
                "confidence": round(max(0.05, min(1.0, conf)), 3),
            })
    placed.sort(key=lambda n: (float(n["start"]), int(n.get("string") or 99)))
    return placed
