"""Viterbi string/fret assignment (standard guitar, optional capo, chord-tone hints).

Internal string index 0 = low E … 5 = high E. Display string number is 6 - index
(1 = high e), matching tab convention and MusicXML.
"""

from __future__ import annotations

from itertools import product
from typing import Iterable

from .chord_label import parse, pc

LEGATO_ONSET = 1.1  # same threshold as techniques.LEGATO_ONSET (kept here to avoid an import cycle)

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
    # Count confident notes only, and as a share of the take: a Demucs guitar stem always has
    # a few bass-bleed ghosts under E2, which used to flip whole solos to Drop D.
    sure = [n for n in notes if float(n.get("velocity") or n.get("confidence") or 0) >= 0.35]
    total = max(1, len(sure))
    below = sum(1 for n in sure if int(n["midi"]) < base[0])
    d2 = sum(1 for n in sure if int(n["midi"]) == 38)
    if (d2 >= 4 and d2 / total >= 0.02) or (below >= 6 and below / total >= 0.04):
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


def _trans_cost(prev: list[tuple[int, int]] | None, cur: list[tuple[int, int]],
                *, legato: bool = False, interval: int = 0) -> float:
    if not prev:
        return 0.0
    prev_pos = sum(f for _, f in prev) / len(prev)
    cur_pos = sum(f for _, f in cur) / len(cur)
    cost = 1.6 * abs(prev_pos - cur_pos)
    mean_ps = sum(s for s, _ in prev) / len(prev)
    mean_cs = sum(s for s, _ in cur) / len(cur)
    cost += 0.5 * abs(mean_ps - mean_cs)
    if len(prev) == 1 and len(cur) == 1:
        ps, pf = prev[0]
        cs, cf = cur[0]
        # Hammer/pull/slide destinations have a weak attack — keep them on one string.
        if legato and 1 <= interval <= 5:
            if ps == cs and abs(pf - cf) <= 5:
                cost -= 3.2
            else:
                cost += 2.8
        elif ps == cs and abs(pf - cf) <= 3:
            cost -= 0.45
        else:
            cost += 0.4 * abs(ps - cs)
    return cost


def _has_matching(midis: list[int], tuning: list[int], capo: int) -> bool:
    """Can every pitch get its own string? (bipartite matching, ≤ 6 strings)"""
    match: dict[int, int] = {}

    def try_place(i: int, seen: set[int]) -> bool:
        for s, _f in candidates(midis[i], tuning, capo):
            if s in seen:
                continue
            seen.add(s)
            if s not in match or try_place(match[s], seen):
                match[s] = i
                return True
        return False

    return all(try_place(i, set()) for i in range(len(midis)))


def playable_subset(notes: list[dict], tuning: list[int], capo: int = 0) -> tuple[list[dict], list[dict]]:
    """Largest-velocity set of notes that fit on separate strings, plus the shed ones.

    Notes-to-strings is a transversal matroid, so adding notes strongest-first and keeping
    each one that still leaves a valid matching is optimal.
    """
    order = sorted(notes, key=lambda n: -float(n.get("velocity") or n.get("confidence") or 0))
    keep: list[dict] = []
    shed: list[dict] = []
    for n in order:
        trial = keep + [n]
        if len(trial) <= len(tuning) and _has_matching([int(x["midi"]) for x in trial], tuning, capo):
            keep = trial
        else:
            shed.append(n)
    keep.sort(key=lambda n: notes.index(n))
    return keep, shed


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
    prev_midi: int | None = None

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
        # A strum can produce more pitches than strings, or pitches that compete for one
        # string. Shed the weakest note until the rest fit, instead of dropping the whole grip.
        playable, shed = playable_subset(playable, tuning, capo)
        for n in shed:
            placed.append({**n, "string": None, "fret": None, "low_confidence": True,
                           "skip_reason": "no_assignment"})
        midis = [int(n["midi"]) for n in playable]
        options = _enumerate_assignments(midis, tuning, capo)
        if not options:
            for n in playable:
                placed.append({**n, "string": None, "fret": None, "low_confidence": True,
                               "skip_reason": "no_assignment"})
            continue

        scored = []
        legato = False
        interval = 0
        if len(playable) == 1 and prev is not None and prev_midi is not None:
            interval = abs(int(playable[0]["midi"]) - prev_midi)
            onset = playable[0].get("onset_ratio")
            legato = onset is not None and float(onset) < LEGATO_ONSET
        for opt in options:
            c = _assign_cost(opt, midis, pcs, hw) + _trans_cost(prev, opt, legato=legato, interval=interval)
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
        prev_midi = int(playable[0]["midi"]) if len(playable) == 1 else None
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


# ---------------------------------------------------------------- v2: global Viterbi
#
# The greedy pass above scored each grip against only the previous one and pulled every
# note toward fret 0. On GuitarSet that put most notes 5 frets low / one string high
# (oracle string+fret accuracy 0.53). v2 runs a real Viterbi over the whole take, with the
# hand position (mean pressed fret) as the continuity term, and weights fitted on GuitarSet
# players 00-04 then checked on held-out player 05 (eval/fingering_fit.py).

from dataclasses import dataclass, field  # noqa: E402

import numpy as np  # noqa: E402


@dataclass
class FingeringParams:
    # Defaults fitted by eval/fingering_fit.py on GuitarSet 00-04 + IDMT Aria/Strat licks;
    # checked on held-out GuitarSet 05 and IDMT Les Paul licks.
    fret: float = 0.02          # barely any pull toward the nut: mid-neck is normal
    high: float = 0.1           # per fret above 12 (was 0.6: electric soloists do play up there --
                                #   Guitar-TECHS solos 0.51 -> 0.53 oracle, GuitarSet/IDMT unchanged)
    open_bonus: float = -0.6    # players fret a note more often than they use the open string
    span: float = 0.5           # per fret of grip span (beyond MAX_SPAN: +12 per fret)
    pos: float = 0.3            # hand shift per fret between consecutive grips
    string: float = 0.1         # mean-string jump between consecutive grips
    rest_decay: float = 0.2     # seconds: a rest this long halves the shift cost
    hint: float = 0.0           # chord-tone hint weight (scaled by hint_weight_at)
    tabcnn: float = 1.4         # bonus for matching TabCNN's string+fret prior
    strnet: float = 2.0         # bonus x the string model's probability for the chosen string (string_model.py);
                                #   picked on IDMT licks: oracle 0.55 -> 0.68, P3 solos 0.53 -> 0.59, GuitarSet 05 0.64 -> 0.92
    legato: float = 3.0         # same-string bonus for a weak-attack (hammer/slide) destination
    top_k: int = 48             # grips kept per onset group
    extra: dict = field(default_factory=dict)


DEFAULT_PARAMS = FingeringParams()


def _env_params() -> FingeringParams:
    # Experiments only (eval/): TABGEN_FINGERING_PARAMS='{"pos": 0.3}' overrides defaults.
    import json
    import os
    raw = os.environ.get("TABGEN_FINGERING_PARAMS")
    return FingeringParams(**json.loads(raw)) if raw else DEFAULT_PARAMS


def _grip_features(opt: list[tuple[int, int]]) -> tuple[float, float, float, float, float]:
    frets = [f for _, f in opt]
    pressed = [f for f in frets if f > 0]
    pos = float(np.mean(pressed)) if pressed else 0.0
    span = (max(pressed) - min(pressed)) if len(pressed) > 1 else 0
    return pos, float(np.mean([s for s, _ in opt])), float(span), float(sum(1 for f in frets if f == 0)), \
        float(sum(max(0, f - 12) for f in frets))


def _emission(opt, midis, notes, pcs, hw, p: FingeringParams) -> float:
    pos, _ms, span, n_open, high = _grip_features(opt)
    c = p.fret * pos * len(opt) + p.high * high - p.open_bonus * n_open
    c += p.span * span + (12.0 * (span - MAX_SPAN) if span > MAX_SPAN else 0.0)
    if pcs and hw and p.hint:
        for m in midis:
            c += (0.55 if (m % 12) not in pcs else -0.12) * hw * p.hint
    for n, (s, f) in zip(notes, opt):
        h = n.get("tabcnn")
        if h and h.get("string") == s and h.get("fret") == f:
            c -= p.tabcnn * float(h.get("confidence") or 0.5)
        sp = n.get("string_probs")
        if sp and p.strnet:
            c -= p.strnet * float(sp[s])
    return c


def assign_notes_v2(
    notes: list[dict],
    tuning: list[int] | None = None,
    capo: int = 0,
    chord_at: callable | None = None,
    hint_weight_at: callable | None = None,
    params: FingeringParams | None = None,
) -> list[dict]:
    """Same contract as `assign_notes` (adds string/string_i/fret/confidence), global Viterbi."""
    p = params or _env_params()
    tuning = list(tuning or STANDARD_TUNING)
    groups = group_onsets(notes)
    placed: list[dict] = []
    # Per group: (notes, options[K], emission[K], features[K,2], t0, t_end, legato_info)
    lattice = []
    for group in groups:
        playable = [n for n in group if candidates(int(n["midi"]), tuning, capo)]
        for n in group:
            if n not in playable:
                placed.append({**n, "string": None, "fret": None, "low_confidence": True,
                               "skip_reason": "out_of_range"})
        if not playable:
            continue
        playable.sort(key=lambda n: int(n["midi"]))
        playable, shed = playable_subset(playable, tuning, capo)
        for n in shed:
            placed.append({**n, "string": None, "fret": None, "low_confidence": True,
                           "skip_reason": "no_assignment"})
        options = _enumerate_assignments([int(n["midi"]) for n in playable], tuning, capo)
        if not options:
            continue
        midis = [int(n["midi"]) for n in playable]
        t0 = float(playable[0]["start"])
        label = chord_at(t0) if chord_at else None
        pcs = chord_pitch_classes(label) if label else None
        hw = float(hint_weight_at(t0)) if hint_weight_at else (0.35 if pcs else 0.0)
        em = np.array([_emission(o, midis, playable, pcs, hw, p) for o in options])
        if len(options) > p.top_k:
            keep = np.argsort(em)[: p.top_k]
            options = [options[i] for i in keep]
            em = em[keep]
        feats = np.array([_grip_features(o)[:2] for o in options])  # pos, mean string
        has_pressed = np.array([any(f > 0 for _, f in o) for o in options])
        lattice.append({
            "notes": playable, "options": options, "em": em, "pos": feats[:, 0], "ms": feats[:, 1],
            "pressed": has_pressed, "t0": t0,
            "t_end": max(float(n["end"]) for n in playable),
        })

    if not lattice:
        placed.sort(key=lambda n: (float(n["start"]), int(n.get("string") or 99)))
        return placed

    # Forward pass.
    cost = lattice[0]["em"].copy()
    back: list[np.ndarray] = []
    for prev, cur in zip(lattice, lattice[1:]):
        gap = max(0.0, cur["t0"] - prev["t_end"])
        decay = 1.0 / (1.0 + gap / max(p.rest_decay, 1e-3))
        dpos = np.abs(cur["pos"][None, :] - prev["pos"][:, None])
        # An all-open grip leaves the hand where it was: no shift cost into or out of it.
        both = prev["pressed"][:, None] & cur["pressed"][None, :]
        trans = decay * (p.pos * dpos * both + p.string * np.abs(cur["ms"][None, :] - prev["ms"][:, None]))
        if len(cur["notes"]) == 1 and len(prev["notes"]) == 1 and p.legato:
            onset = cur["notes"][0].get("onset_ratio")
            interval = abs(int(cur["notes"][0]["midi"]) - int(prev["notes"][0]["midi"]))
            if onset is not None and float(onset) < LEGATO_ONSET and 1 <= interval <= 5 and gap < 0.06:
                same = np.array([[po[0][0] == co[0][0] for co in cur["options"]] for po in prev["options"]])
                trans = trans - p.legato * same + p.legato * 0.8 * (~same)
        tot = cost[:, None] + trans
        bi = np.argmin(tot, axis=0)
        cost = tot[bi, np.arange(tot.shape[1])] + cur["em"]
        back.append(bi)

    # Backtrack.
    choice = [int(np.argmin(cost))]
    for bi in reversed(back):
        choice.append(int(bi[choice[-1]]))
    choice.reverse()
    final = cost[choice[-1]]
    del final

    for g, k in zip(lattice, choice):
        em = g["em"]
        margin = float(np.partition(em - em[k], 1)[1]) if len(em) > 1 else 9.0
        unsure = margin < 0.3
        best = g["options"][k]
        span = _span_cost([f for _, f in best])
        for n, (s, f) in zip(g["notes"], best):
            conf = float(n.get("confidence") or n.get("velocity") or 0.5)
            if unsure:
                conf *= 0.8
            if span:
                conf *= 0.75
            placed.append({
                **n,
                "string": display_string(s),
                "string_i": s,
                "fret": f,
                "viterbi_margin": round(margin, 3),
                "low_confidence": bool(n.get("low_confidence") or conf < 0.35),
                "confidence": round(max(0.05, min(1.0, conf)), 3),
            })
    placed.sort(key=lambda n: (float(n["start"]), int(n.get("string") or 99)))
    return placed
