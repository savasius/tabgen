"""Guitar techniques from pitch contours and legato onsets.

Bends and vibrato are measured on a pitch track (Basic Pitch bins, PYIN fallback).
Hammer/pull and slides need a weak destination attack (no new pick) plus same-string
fingering; a picked scale is not legato. Palm mute stays a weak spectral guess.
Every tag carries `confidence` in [0, 1] and `source`.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

# Basic Pitch contour bins are 1/3 semitone.
BINS_PER_SEMITONE = 3.0
TECH_KINDS = ("bend", "vibrato", "hammer", "pull", "slide", "palmMute")

LEGEND = {
    "bend": {
        "reliability": "measured",
        "note": "Pitch-contour rise/hold (≥ ~70 cents, mostly monotonic). Not a dedicated bend model.",
    },
    "vibrato": {
        "reliability": "measured",
        "note": "Detrended contour oscillation ~3.5–8 Hz, ≥2 cycles. Misses shallow vibrato.",
    },
    "slide": {
        "reliability": "measured",
        "note": "Same string, fret jump, weak second attack, and/or contour gliding toward the next pitch.",
    },
    "hammer": {
        "reliability": "measured",
        "note": "Same string, small upward fret change, overlapping sustain, weak destination onset.",
    },
    "pull": {
        "reliability": "measured",
        "note": "Same string, small downward fret change, overlapping sustain, weak destination onset.",
    },
    "palmMute": {
        "reliability": "guess",
        "note": "Short note + low spectral centroid. Easy to confuse with quiet picking; omitted unless strong.",
    },
}


class _Audio:
    def __init__(self, path: Path):
        import soundfile as sf
        y, sr = sf.read(str(path), dtype="float32", always_2d=False)
        self.y = y.mean(axis=1).astype(np.float32) if getattr(y, "ndim", 1) == 2 else np.asarray(y, np.float32)
        self.sr = int(sr)

    def rms(self, t0: float, t1: float) -> float:
        a = int(max(0, t0 * self.sr))
        b = int(min(len(self.y), t1 * self.sr))
        if b - a < 8:
            return 0.0
        sl = self.y[a:b].astype(np.float64)
        return float(np.sqrt(np.mean(sl * sl) + 1e-12))

    def onset_ratio(self, t: float, pre: float = 0.030, post: float = 0.014) -> float:
        """Peak energy jump near `t`. Basic Pitch onsets often sit a few ms early
        in the previous note's tail; searching a short window finds a real pick
        and leaves true hammers near 1.0."""
        best = 0.0
        for d in (-0.012, -0.004, 0.0, 0.008, 0.016, 0.028, 0.040):
            r = self.rms(t + d, t + d + post) / (self.rms(t + d - pre, t + d) + 1e-6)
            if r > best:
                best = r
        return best

    def slice(self, t0: float, t1: float) -> np.ndarray:
        a = int(max(0, t0 * self.sr))
        b = int(min(len(self.y), t1 * self.sr))
        return self.y[a:b]


def _bends_to_cents(bends: list[int] | None) -> list[float]:
    if not bends:
        return []
    return [b * 100.0 / BINS_PER_SEMITONE for b in bends]


def _smooth(xs: np.ndarray, k: int = 5) -> np.ndarray:
    if len(xs) < k:
        return xs
    k = k if k % 2 else k + 1
    pad = k // 2
    ker = np.ones(k) / k
    return np.convolve(np.pad(xs, (pad, pad), mode="edge"), ker, mode="valid")


def _pyin_cents(audio: _Audio, t0: float, t1: float, midi: int) -> list[float]:
    sl = audio.slice(t0, t1)
    if sl.size < int(0.12 * audio.sr):
        return []
    try:
        import librosa
        fmin = librosa.midi_to_hz(max(32, midi - 5))
        fmax = librosa.midi_to_hz(min(90, midi + 7))
        f0, voiced, _ = librosa.pyin(sl.astype(np.float64), fmin=fmin, fmax=fmax, sr=audio.sr)
    except Exception:
        return []
    hz = np.asarray(f0, float)
    ok = np.asarray(voiced, bool) & np.isfinite(hz) & (hz > 0)
    if ok.sum() < 6:
        return []
    ref = float(np.median(hz[ok][: max(2, ok.sum() // 5)]))
    cents = 1200.0 * np.log2(np.clip(hz, 1e-6, None) / ref)
    cents[~ok] = np.nan
    # interpolate tiny holes so the contour stays usable
    idx = np.arange(len(cents))
    good = np.isfinite(cents)
    cents[~good] = np.interp(idx[~good], idx[good], cents[good])
    return cents.tolist()


def load_audio(path: Path | None) -> _Audio | None:
    if path is None:
        return None
    try:
        p = Path(path)
        if p.exists():
            return _Audio(p)
    except Exception:
        return None
    return None


def attach_onsets(notes: list[dict], audio: _Audio | None) -> None:
    if audio is None:
        return
    for n in notes:
        if n.get("onset_ratio") is None:
            n["onset_ratio"] = round(audio.onset_ratio(float(n["start"])), 3)


def _contour_cents(note: dict, audio: _Audio | None) -> list[float]:
    bp = _bends_to_cents(note.get("bends"))
    if audio is None:
        return bp
    midi = int(note.get("midi") or 60)
    t0, t1 = float(note["start"]), float(note["end"])
    # Skip the attack: overlapping previous pitch makes PYIN look like a 1-semitone "bend".
    py_t0 = t0 + min(0.04, 0.18 * max(0.0, t1 - t0))
    py = _pyin_cents(audio, py_t0, t1, midi)
    dur = max(0.0, t1 - t0)
    # PYIN only overrides Basic Pitch when it actually shows vibrato. A two-note
    # overlap looks like a huge glide to PYIN and must not become a fake bend.
    if py and _vib_stats(np.asarray(py, float), dur):
        return py
    if len(bp) >= 6:
        return bp
    return py or bp


def _vib_stats(cents: np.ndarray, duration: float) -> tuple[float, float, float] | None:
    """Return (hz, amp_cents, acorr) or None."""
    if duration < 0.20 or len(cents) < 10:
        return None
    x = cents.astype(float)
    t = np.linspace(0.0, 1.0, len(x))
    slope, intercept = np.polyfit(t, x, 1)
    det = x - (slope * t + intercept)
    det = det - det.mean()
    amp = float(np.percentile(np.abs(det), 85))
    if amp < 14:
        return None
    ac = np.correlate(det, det, mode="full")[len(det) - 1 :]
    ac = ac / (ac[0] + 1e-9)
    hop = duration / max(len(x), 1)
    lo = max(2, int(round(0.12 / hop)))   # ~8.3 Hz
    hi = min(len(ac) - 1, int(round(0.30 / hop)))  # ~3.3 Hz
    if hi <= lo + 1:
        return None
    j = lo + int(np.argmax(ac[lo:hi + 1]))
    peak = float(ac[j])
    if peak < 0.28:
        return None
    hz = 1.0 / max(j * hop, 1e-4)
    cycles = duration * hz
    if cycles < 1.8 or not (3.3 <= hz <= 8.3):
        return None
    return hz, amp, peak


def classify_contour(bends: list[int] | None, duration: float,
                     cents: list[float] | None = None) -> list[dict]:
    raw = np.asarray(cents if cents is not None else _bends_to_cents(bends), float)
    if len(raw) < 5:
        return []
    sm = _smooth(raw)
    n = len(sm)
    start = float(np.median(sm[: max(2, n // 5)]))
    end = float(np.median(sm[-max(2, n // 4) :]))
    peak = float(np.max(sm) if end >= start else np.min(sm))
    net = end - start
    rise = peak - start
    tags: list[dict] = []

    # Vibrato needs the unsmoothed wiggle; 5-point smoothing flattens 5–7 Hz.
    vib = _vib_stats(raw, duration)
    if vib:
        hz, amp, ac = vib
        tags.append({
            "type": "vibrato",
            "source": "contour",
            "cents": round(amp, 1),
            "hz": round(hz, 2),
            "confidence": round(float(np.clip(0.35 + 0.4 * ac + 0.15 * min(amp / 40.0, 1.0), 0.2, 0.98)), 3),
        })

    # Bend: mostly-monotonic net shift, not explained by vibrato wobble alone.
    t = np.linspace(0.0, 1.0, n)
    if n > 4 and float(np.std(sm)) > 1e-6:
        corr = float(np.corrcoef(t, sm)[0, 1])
        if not np.isfinite(corr):
            corr = 0.0
    else:
        corr = 0.0
    directed = abs(net) >= 70 or (abs(rise) >= 90 and abs(net) >= 45)
    monotonic = abs(corr) >= 0.45
    if directed and monotonic and duration >= 0.09:
        cents_amt = net if abs(net) >= abs(rise) * 0.6 else rise
        # If vibrato is strong and net shift is small-ish, skip bend.
        if vib and abs(net) < 90 and vib[2] > 0.45:
            pass
        else:
            tags.append({
                "type": "bend",
                "source": "contour",
                "cents": round(float(cents_amt), 1),
                "quarter_tones": int(round(abs(cents_amt) / 50.0)) or 1,
                "confidence": round(float(np.clip(0.4 + 0.35 * min(abs(cents_amt) / 200.0, 1.0)
                                                  + 0.2 * min(abs(corr), 1.0), 0.25, 0.98)), 3),
            })
    return tags


def _is_chordal(note: dict, notes: list[dict], window: float = 0.04) -> bool:
    """True when another string is sounding at the same onset (a grip, not legato)."""
    t = float(note["start"])
    s = note.get("string")
    others = [n for n in notes if n is not note and abs(float(n["start"]) - t) <= window]
    if not others:
        return False
    if s is not None and all(n.get("string") == s for n in others):
        return False
    return True


def _glide_coverage(cents: list[float], target_cents: float) -> float:
    if abs(target_cents) < 40 or len(cents) < 5:
        return 0.0
    sm = _smooth(np.asarray(cents, float))
    start = float(np.median(sm[: max(2, len(sm) // 5)]))
    end = float(np.median(sm[-max(2, len(sm) // 4) :]))
    return float((end - start) / target_cents)


def link_legato(notes: list[dict], audio: _Audio | None = None) -> None:
    """Add hammer / pull / slide between successive same-string notes when the
    destination is legato (weak pick) rather than a new attack."""
    if audio is not None:
        for n in notes:
            n["onset_ratio"] = round(audio.onset_ratio(float(n["start"])), 3)

    by_string: dict[int, list[dict]] = {}
    for n in notes:
        s = n.get("string")
        if s is None or n.get("fret") is None:
            continue
        by_string.setdefault(int(s), []).append(n)

    for seq in by_string.values():
        seq.sort(key=lambda n: float(n["start"]))
        for a, b in zip(seq, seq[1:]):
            if _is_chordal(a, notes) or _is_chordal(b, notes):
                continue
            gap = float(b["start"]) - float(a["end"])
            # Hammer/slide destinations start while the first note still rings.
            if gap > 0.06 or gap < -0.34:
                continue
            fa, fb = int(a["fret"]), int(b["fret"])
            df = fb - fa
            if df == 0:
                continue
            kinds_a = {t["type"] for t in a.get("techniques") or []}
            kinds_b = {t["type"] for t in b.get("techniques") or []}
            onset_b = b.get("onset_ratio")
            legato = None if onset_b is None else float(onset_b) < 1.55
            va = float(a.get("velocity") or a.get("confidence") or 0.5)
            vb = float(b.get("velocity") or b.get("confidence") or 0.5)
            quieter = vb <= 0.82 * va + 0.02
            cents_a = a.get("_cents") or _bends_to_cents(a.get("bends"))
            cover = _glide_coverage(cents_a, df * 100.0)
            abs_df = abs(df)

            hammerish = 1 <= abs_df <= 3 and gap <= 0.032
            slideish = abs_df >= 2 and gap <= 0.05

            is_hp = False
            # Abutting notes where the dest is itself a bend: Basic Pitch split one bent note.
            split_bend = "bend" in kinds_b and gap >= -0.02
            if hammerish and "bend" not in kinds_a and not split_bend:
                if legato is True:
                    is_hp = True
                    conf = 0.55 + 0.2 * (1.55 - float(onset_b)) / 1.55
                    if quieter:
                        conf += 0.1
                    if gap <= 0.01:
                        conf += 0.08
                elif legato is None and quieter and gap <= 0.022 and abs_df <= 2:
                    is_hp = True
                    conf = 0.42
            if is_hp:
                kind = "hammer" if df > 0 else "pull"
                conf = float(np.clip(conf, 0.3, 0.92))
                src = "legato" if legato is True else "timing"
                # Contour rise into the dest fret is the hammer, not a held bend.
                a["techniques"] = [t for t in (a.get("techniques") or []) if t["type"] != "bend"]
                a.setdefault("techniques", []).append(
                    {"type": kind, "source": src, "to_fret": fb, "confidence": round(conf, 3)})
                continue

            is_slide = False
            conf_s = 0.0
            if slideish and not is_hp:
                if cover >= 0.35:
                    is_slide = True
                    conf_s = 0.5 + 0.35 * min(cover, 1.0)
                elif legato is True and abs_df >= 3:
                    is_slide = True
                    conf_s = 0.48
                elif legato is None and cover >= 0.25 and abs_df >= 3:
                    is_slide = True
                    conf_s = 0.4
            if is_slide:
                src = "contour" if cover >= 0.35 else ("legato" if legato else "timing")
                conf_s = float(np.clip(conf_s, 0.3, 0.92))
                # A glide into the next fret is a slide, not a held bend.
                a["techniques"] = [t for t in (a.get("techniques") or []) if t["type"] != "bend"]
                a.setdefault("techniques", []).append(
                    {"type": "slide", "source": src, "to_fret": fb, "confidence": round(conf_s, 3)})


def maybe_palm_mute(note: dict, centroid_hz: float | None, soloish: bool) -> None:
    if soloish or centroid_hz is None:
        return
    if any(t["type"] in ("bend", "vibrato", "hammer", "pull", "slide") for t in note.get("techniques") or []):
        return
    dur = float(note["end"]) - float(note["start"])
    if dur > 0.14 or dur < 0.05:
        return
    if centroid_hz > 700:
        return
    onset = note.get("onset_ratio")
    if onset is not None and float(onset) < 2.0:
        return
    note.setdefault("techniques", []).append({
        "type": "palmMute",
        "source": "guess",
        "centroid_hz": round(centroid_hz, 1),
        "confidence": 0.28,
    })
    note["low_confidence"] = True


def annotate(notes: list[dict], centroids: dict[int, float] | None = None, solo_at=None,
             audio_path: Path | None = None, audio: _Audio | None = None) -> list[dict]:
    """Attach techniques. centroids maps note index → spectral centroid Hz."""
    if audio is None:
        audio = load_audio(audio_path)
    attach_onsets(notes, audio)

    for i, n in enumerate(notes):
        n.setdefault("techniques", [])
        dur = float(n["end"]) - float(n["start"])
        cents = _contour_cents(n, audio)
        n["_cents"] = cents
        n["techniques"].extend(classify_contour(n.get("bends"), dur, cents=cents))
        if n["techniques"] and min((t.get("confidence") or 0.5) for t in n["techniques"]) < 0.4:
            n["low_confidence"] = True

    link_legato(notes, audio=audio)

    for i, n in enumerate(notes):
        if centroids and i in centroids:
            maybe_palm_mute(n, centroids[i], bool(solo_at and solo_at(float(n["start"]))))
        n.pop("_cents", None)
        # Drop bulky raw contour from the note after use; keep a short flag.
        if n.get("bends") and len(n["bends"]) > 24:
            n["bends"] = n["bends"][:: max(1, len(n["bends"]) // 16)][:16]
    return notes
