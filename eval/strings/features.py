"""Per-note timbre features that tell guitar strings apart.

The main cue is inharmonicity: partial k of a stiff string sits at k*f0*sqrt(1 + B*k^2), and B
grows with string thickness and shrinks with vibrating length, so the same pitch played higher up
a thicker string has a clearly larger B (Barbancho et al. 2012). Plus the harmonic envelope
(thick strings are darker at the same pitch) and how fast the note decays.
"""

from __future__ import annotations

import numpy as np

N_PARTIALS = 14


def _fit_b(kk: np.ndarray, ff: np.ndarray, f0: float) -> float:
    """Median of per-partial stretch: (f_k / (k f_1))^2 = (1 + B k^2) / (1 + B) ~ 1 + B (k^2 - 1)."""
    sel = kk >= 3
    if sel.sum() < 2:
        return 0.0
    r = (ff[sel] / (kk[sel] * f0)) ** 2
    return float(max(np.median((r - 1) / (kk[sel] ** 2 - 1)), 1e-7))


def note_features(y: np.ndarray, sr: int, start: float, end: float, midi: int) -> np.ndarray | None:
    a = int((start + 0.03) * sr)
    b = int(min(end, start + 0.6) * sr)
    if b - a < int(0.06 * sr) or a < 0 or b > len(y):
        return None
    seg = y[a:b].astype(np.float64)
    if np.sqrt(np.mean(seg ** 2)) < 1e-4:
        return None
    n = 1 << 16
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n))
    db = 20 * np.log10(spec + 1e-12)
    binhz = sr / n
    f0 = 440.0 * 2 ** ((midi - 69) / 12)

    def peak(fc: float, tol: float) -> tuple[float, float] | None:
        lo, hi = int((fc - tol) / binhz), int((fc + tol) / binhz) + 1
        if lo < 1 or hi >= len(spec) - 1:
            return None
        k = lo + int(np.argmax(spec[lo:hi]))
        if k <= lo or k >= hi - 1:
            return None
        al, be, ga = db[k - 1], db[k], db[k + 1]
        d = al - 2 * be + ga
        off = 0.5 * (al - ga) / d if d != 0 else 0.0
        return (k + off) * binhz, be - 0.25 * (al - ga) * off

    # refine f0 on the first partial, then follow partials allowing for stretch
    p1 = peak(f0, f0 * 0.04)
    if not p1:
        return None
    f0 = p1[0]
    freqs, mags, ks = [p1[0]], [p1[1]], [1]
    B = 0.0
    for k in range(2, N_PARTIALS + 1):
        guess = k * f0 * np.sqrt((1 + B * k * k) / (1 + B))
        if guess > sr / 2 - 200:
            break
        p = peak(guess, max(4.0, (0.006 + 0.0006 * k * k) * guess))
        if not p or p[1] < mags[0] - 50:
            continue
        freqs.append(p[0]); mags.append(p[1]); ks.append(k)
        if len(ks) >= 4:  # running estimate of B steers the search for higher partials
            B = _fit_b(np.array(ks, float), np.array(freqs), f0)
    if len(ks) < 5:
        return None
    kk = np.array(ks, float); ff = np.array(freqs); mm = np.array(mags)
    B = _fit_b(kk, ff, f0)
    env = np.full(N_PARTIALS, -60.0)
    env[kk.astype(int) - 1] = np.clip(mm - mm[0], -60, 20)
    w = 10 ** (mm / 20)
    centroid = float(np.sum(kk * w) / np.sum(w))
    # decay: energy in first vs second half of the analysed window
    h = len(seg) // 2
    decay = 10 * np.log10((np.mean(seg[h:] ** 2) + 1e-12) / (np.mean(seg[:h] ** 2) + 1e-12))
    return np.concatenate([[midi, np.log10(max(B, 1e-7)), centroid, decay, len(ks)], env])
