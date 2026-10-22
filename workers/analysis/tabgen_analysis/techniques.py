"""Technique tags from pitch contours and successive same-string notes.

Honesty: bends/vibrato come from Basic Pitch contours (measured). Slides and
hammer/pull-off are timing+string heuristics. Palm mute is a weak spectral guess
and is only tagged when the evidence is strong.
"""

from __future__ import annotations

# Basic Pitch contour bins are 1/3 semitone. MIDI bend scale is later.
BINS_PER_SEMITONE = 3.0

LEGEND = {
    "bend": {
        "reliability": "measured",
        "note": "From Basic Pitch pitch-contour rise (≥ ~70 cents), not from a dedicated bend detector.",
    },
    "vibrato": {
        "reliability": "measured",
        "note": "From oscillation on the same contour; misses shallow vibrato and false-triggers on noisy stems.",
    },
    "slide": {
        "reliability": "heuristic",
        "note": "Guessed when two notes share a string with a short gap and a fret change. Not audio of the slide itself.",
    },
    "hammer": {
        "reliability": "heuristic",
        "note": "Guessed: same string, short gap, higher fret, quieter second note.",
    },
    "pull": {
        "reliability": "heuristic",
        "note": "Guessed: same string, short gap, lower fret, quieter second note.",
    },
    "palmMute": {
        "reliability": "guess",
        "note": "Optional: short note + low spectral centroid. Easy to confuse with quiet picking; omitted unless strong.",
    },
}


def _bends_to_cents(bends: list[int] | None) -> list[float]:
    if not bends:
        return []
    return [b * 100.0 / BINS_PER_SEMITONE for b in bends]


def classify_contour(bends: list[int] | None, duration: float) -> list[dict]:
    cents = _bends_to_cents(bends)
    if len(cents) < 4:
        return []
    tags: list[dict] = []
    # Smooth-ish peak deviation from the starting bin.
    start = sum(cents[:3]) / 3
    end = sum(cents[-3:]) / 3
    peak = max(cents) if end >= start else min(cents)
    rise = peak - start
    if rise >= 70:
        tags.append({
            "type": "bend",
            "source": "contour",
            "cents": round(rise, 1),
            "quarter_tones": round(rise / 50.0),  # alphaTex bend units ≈ quarter tones
        })
    # Vibrato: zero-crossing rate of (signal - median) in a plausible rate band.
    mid = sorted(cents)[len(cents) // 2]
    centered = [c - mid for c in cents]
    amp = (max(centered) - min(centered)) / 2
    if amp >= 25 and duration >= 0.18:
        signs = [1 if x >= 0 else -1 for x in centered]
        flips = sum(signs[i] != signs[i - 1] for i in range(1, len(signs)))
        # Contour hop is ~ AUDIO frames; duration/len ≈ frame period.
        hz = (flips / 2) / max(duration, 1e-3)
        if 3.5 <= hz <= 9.0:
            tags.append({
                "type": "vibrato",
                "source": "contour",
                "cents": round(amp, 1),
            })
    return tags


def link_legato(notes: list[dict]) -> None:
    """Mutates notes in start order: add slide / hammer / pull between consecutive same-string notes."""
    by_string: dict[int, list[dict]] = {}
    for n in notes:
        s = n.get("string")
        if s is None or n.get("fret") is None:
            continue
        by_string.setdefault(int(s), []).append(n)
    for seq in by_string.values():
        seq.sort(key=lambda n: float(n["start"]))
        for a, b in zip(seq, seq[1:]):
            gap = float(b["start"]) - float(a["end"])
            overlap = float(a["end"]) - float(b["start"])
            if gap > 0.09 and overlap < 0:
                continue
            if gap < -0.05:
                continue
            fa, fb = int(a["fret"]), int(b["fret"])
            if fa == fb:
                continue
            va = float(a.get("velocity") or a.get("confidence") or 0.5)
            vb = float(b.get("velocity") or b.get("confidence") or 0.5)
            quieter = vb <= 0.9 * va + 0.02
            tech_a = a.setdefault("techniques", [])
            tech_b = b.setdefault("techniques", [])
            kinds = {t["type"] for t in tech_a}
            if quieter and gap <= 0.045 and abs(fb - fa) <= 3 and "bend" not in kinds:
                kind = "hammer" if fb > fa else "pull"
                tech_a.append({"type": kind, "source": "timing", "to_fret": fb})
                tech_b.append({"type": kind, "source": "timing"})
            elif abs(fb - fa) >= 1 and gap <= 0.08:
                tech_a.append({"type": "slide", "source": "timing", "to_fret": fb})
                tech_b.append({"type": "slide", "source": "timing"})


def maybe_palm_mute(note: dict, centroid_hz: float | None, soloish: bool) -> None:
    if soloish or centroid_hz is None:
        return
    dur = float(note["end"]) - float(note["start"])
    if dur > 0.22 or dur < 0.04:
        return
    if centroid_hz > 900:
        return
    note.setdefault("techniques", []).append({
        "type": "palmMute",
        "source": "guess",
        "centroid_hz": round(centroid_hz, 1),
    })
    note["low_confidence"] = True


def annotate(notes: list[dict], centroids: dict[int, float] | None = None, solo_at=None) -> list[dict]:
    """Attach techniques. centroids maps note index → spectral centroid Hz."""
    for i, n in enumerate(notes):
        n.setdefault("techniques", [])
        n["techniques"].extend(classify_contour(n.get("bends"), float(n["end"]) - float(n["start"])))
        if centroids and i in centroids:
            maybe_palm_mute(n, centroids[i], bool(solo_at and solo_at(float(n["start"]))))
    link_legato(notes)
    return notes
