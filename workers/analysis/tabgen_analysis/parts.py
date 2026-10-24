"""Split the guitar stem into separate guitar parts.

No permissively licensed model separates one guitar from another, so this uses two cues that
need no training data and are measured in eval/multi_bench.py:

  1. Stereo position. Rock/pop mixes usually pan double-tracked rhythm guitars left/right and
     keep the lead near the centre. Each time-frequency bin of the stereo guitar stem gets a pan
     value; peaks in the energy-weighted pan histogram are guitars, soft masks around each peak
     resynthesize them (a simplified ADRess, Barry et al. 2004).
  2. Playing role (on notes, works on mono too): a single-note line that moves above the chords
     is lead; stacked notes are rhythm. See split_roles().
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

N_FFT = 4096
HOP = 1024
PAN_BINS = 41
MIN_SHARE = 0.12       # a pan cluster under this share of stem energy is bleed, not a guitar
MIN_SEPARATION = 0.35  # pan distance between two guitars (pan runs -1 left .. +1 right)
MASK_SIGMA = 0.25
VALLEY = 0.7           # two peaks are two guitars only if the histogram dips below this between them


@dataclass
class StereoPart:
    pan: float
    share: float
    audio: np.ndarray = field(repr=False)


def _stft(x: np.ndarray) -> np.ndarray:
    import librosa
    return librosa.stft(x, n_fft=N_FFT, hop_length=HOP)


def _istft(X: np.ndarray, n: int) -> np.ndarray:
    import librosa
    return librosa.istft(X, hop_length=HOP, length=n).astype(np.float32)


def pan_map(L: np.ndarray, R: np.ndarray) -> np.ndarray:
    pl, pr = np.abs(L) ** 2, np.abs(R) ** 2
    return (pr - pl) / (pr + pl + 1e-12)


def pan_histogram(pan: np.ndarray, energy: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Energy-weighted pan histogram over the loud bins, lightly smoothed."""
    loud = energy > np.percentile(energy, 80)
    h, edges = np.histogram(pan[loud], bins=PAN_BINS, range=(-1, 1), weights=energy[loud])
    h = np.convolve(h, np.array([1, 2, 3, 2, 1], float) / 9, mode="same")
    return h / (h.sum() + 1e-12), (edges[:-1] + edges[1:]) / 2


def pan_peaks(h: np.ndarray, centres: np.ndarray) -> list[tuple[float, float]]:
    """(pan, share) of each guitar-sized cluster, sorted left to right."""
    idx = [i for i in range(len(h))
           if h[i] >= h[max(0, i - 1)] and h[i] >= h[min(len(h) - 1, i + 1)] and h[i] > 0]
    idx.sort(key=lambda i: -h[i])
    kept: list[int] = []
    for i in idx:
        if all(abs(centres[i] - centres[j]) >= MIN_SEPARATION
               and h[min(i, j):max(i, j) + 1].min() < VALLEY * min(h[i], h[j]) for j in kept):
            kept.append(i)
    if not kept:
        return [(0.0, 1.0)]
    # Each bin belongs to its nearest peak; a cluster's share is the energy it owns.
    owner = np.argmin(np.abs(centres[:, None] - centres[kept][None, :]), axis=1)
    shares = np.array([h[owner == k].sum() for k in range(len(kept))])
    out = [(float(centres[kept[k]]), float(shares[k])) for k in range(len(kept)) if shares[k] >= MIN_SHARE]
    if not out:
        return [(0.0, 1.0)]
    total = sum(s for _, s in out)
    return sorted(((p, s / total) for p, s in out), key=lambda t: t[0])


def stereo_parts(stereo: np.ndarray) -> list[StereoPart]:
    """Guitars found by stereo position in a (n, 2) guitar stem. One entry = nothing to split."""
    stereo = np.asarray(stereo, np.float32)
    if stereo.ndim == 1 or stereo.shape[1] == 1:
        mono = stereo.reshape(-1)
        return [StereoPart(0.0, 1.0, mono)]
    n = stereo.shape[0]
    L, R = _stft(stereo[:, 0]), _stft(stereo[:, 1])
    pan = pan_map(L, R)
    energy = np.abs(L) ** 2 + np.abs(R) ** 2
    peaks = pan_peaks(*pan_histogram(pan, energy))
    if len(peaks) == 1:
        return [StereoPart(peaks[0][0], 1.0, stereo.mean(axis=1))]
    centres = np.array([p for p, _ in peaks])
    w = np.exp(-((pan[..., None] - centres) ** 2) / (2 * MASK_SIGMA ** 2))
    w /= w.sum(axis=-1, keepdims=True) + 1e-12
    parts = []
    for k, (p, share) in enumerate(peaks):
        # Take the source from the side it is panned to: the far channel only adds the others.
        gl, gr = np.cos((p + 1) * np.pi / 4), np.sin((p + 1) * np.pi / 4)
        X = w[..., k] * (gl * L + gr * R) / (gl ** 2 + gr ** 2)
        parts.append(StereoPart(p, share, _istft(X, n)))
    return parts


# ---------------------------------------------------------------- notes


def dedupe_bleed(parts: list[list[dict]], onset_tol: float = 0.05, ratio: float = 2.2) -> list[list[dict]]:
    """Drop a note that is a quieter copy of a note in another part (mask leakage).

    Real doubling (two guitars playing the same chord) has similar loudness on both sides,
    so only notes at least `ratio` times quieter than their twin are removed.
    """
    out = []
    for i, notes in enumerate(parts):
        keep = []
        for n in notes:
            twin = max((m.get("velocity", 0.0) for j, other in enumerate(parts) if j != i for m in other
                        if m["midi"] == n["midi"] and abs(m["start"] - n["start"]) <= onset_tol),
                       default=0.0)
            if twin < ratio * n.get("velocity", 0.0):
                keep.append(n)
        out.append(keep)
    return out


CHORD_TOL = 0.04     # onsets this close are one strum
LEAD_MIN_SHARE = 0.18  # below this share of notes, a "lead" is just chord tops; keep one part
LEAD_MIN_NOTES = 12


def _onset_groups(notes: list[dict]) -> list[list[int]]:
    order = sorted(range(len(notes)), key=lambda i: notes[i]["start"])
    groups: list[list[int]] = []
    for i in order:
        if groups and notes[i]["start"] - notes[groups[-1][0]]["start"] <= CHORD_TOL:
            groups[-1].append(i)
        else:
            groups.append([i])
    return groups


LEAD_SINGLE, LEAD_STRUM, MIXED_SINGLE = 0.65, 0.08, 0.47  # fitted on eval/multi_bench.py dev


def classify_part(notes: list[dict]) -> str:
    """"lead" (single-note line), "rhythm" (chords/arpeggios) or "mixed" (both in one part).

    Share of onsets that are a lone note vs a strum of 3+: solos are ~90% lone notes with no
    strums, comping 40% / 16%, a lead over comping in between. ~80% right on the dev scenes.
    """
    if not notes:
        return "rhythm"
    sizes = np.array([len(g) for g in _onset_groups(notes)])
    single, strum = float(np.mean(sizes == 1)), float(np.mean(sizes >= 3))
    if single >= LEAD_SINGLE and strum <= LEAD_STRUM:
        return "lead"
    return "mixed" if single >= MIXED_SINGLE else "rhythm"


# Fitted on the dev scenes incl. two comping guitars with no lead (eval/multi_bench.py rr2).
LEAD_GATE = 0.75    # share of the lead's onsets that are single notes
LEAD_MARGIN = 0.05  # the lead must stand out from the next most lead-like guitar by this much


def _leadness(notes: list[dict]) -> float:
    sizes = np.array([len(g) for g in _onset_groups(notes)])
    return float(np.mean(sizes == 1) - np.mean(sizes >= 3) + 0.02 * np.median([n["midi"] for n in notes]))


def assign_roles(groups: list[list[dict]]) -> list[str]:
    """Roles for guitars that were split by stereo position: at most one lead.

    Ranking the guitars against each other is sturdier than an absolute threshold once Demucs
    and distortion have smeared the notes. Right on 84% of dev scenes (lead picked 87%,
    no lead invented over two comping guitars 80%).
    """
    if not groups:
        return []
    score = [_leadness(n) if n else -9.0 for n in groups]
    order = np.argsort(score)[::-1]
    roles = ["rhythm"] * len(groups)
    best = int(order[0])
    margin = score[best] - (score[int(order[1])] if len(groups) > 1 else -9.0)
    sizes = np.array([len(g) for g in _onset_groups(groups[best])]) if groups[best] else np.array([0])
    if float(np.mean(sizes == 1)) >= LEAD_GATE and margin >= LEAD_MARGIN:
        roles[best] = "lead"
    return roles


def split_roles(notes: list[dict], params: dict | None = None) -> tuple[list[dict], list[dict]] | None:
    """Split one part's notes into (lead, rhythm), or None when it is a single guitar.

    Viterbi over onset groups. At every group the lead either plays one of its notes (the line
    moves with small steps and sits above the rhythm) or rests; everything else is rhythm.
    Strums (3+ notes) rarely contain the lead; the lead is monophonic. It always finds some
    "lead" (the chord tops of plain comping), so only call it on parts classify_part() calls mixed.
    """
    # Weights from a coordinate search on the dev scenes (eval/multi_bench.py, mono2 layout).
    p = {"step": 0.09, "leap": 7, "leap_cost": 0.8, "high": 0.2, "strum_lead": 0.6,
         "single_rhythm": 2.5, "rest": 0.35, "overlap": 1.2, **(params or {})}
    if len(notes) < LEAD_MIN_NOTES:
        return None
    groups = _onset_groups(notes)
    # States per group: index into the group = that note is lead, -1 = lead rests.
    states = [[-1] + list(range(len(g))) for g in groups]
    med = float(np.median([n["midi"] for n in notes]))

    def emit(gi: int, s: int) -> float:
        g = groups[gi]
        size = len(g)
        if s == -1:
            # Lone notes with no lead are rhythm single notes (bass runs, arpeggios): mild cost.
            return p["single_rhythm"] if size == 1 else 0.0
        n = notes[g[s]]
        top = max(notes[i]["midi"] for i in g)
        c = -p["high"] * (n["midi"] - med)
        if n["midi"] < top:
            c += 1.0                       # the lead is the top voice of its onset group
        if size >= 3:
            c += p["strum_lead"]
        return c

    def trans(gp: int, sp: int, gi: int, si: int) -> float:
        if sp == -1 or si == -1:
            return p["rest"] if (sp == -1) != (si == -1) else 0.0
        a, b = notes[groups[gp][sp]], notes[groups[gi][si]]
        jump = abs(b["midi"] - a["midi"])
        c = p["step"] * jump + (p["leap_cost"] if jump > p["leap"] else 0.0)
        if b["start"] < a["end"] - 0.06 and jump > 0:
            c += p["overlap"]              # a monophonic line rarely overlaps itself
        return c

    cost = [np.array([emit(0, s) for s in states[0]])]
    back = []
    for gi in range(1, len(groups)):
        prev = cost[-1]
        cur, bp = [], []
        for si in states[gi]:
            tc = [prev[k] + trans(gi - 1, states[gi - 1][k], gi, si) for k in range(len(states[gi - 1]))]
            k = int(np.argmin(tc))
            cur.append(tc[k] + emit(gi, si))
            bp.append(k)
        cost.append(np.array(cur))
        back.append(bp)
    k = int(np.argmin(cost[-1]))
    path = [k]
    for bp in reversed(back):
        k = bp[k]
        path.append(k)
    path.reverse()
    lead_idx = {groups[gi][states[gi][k]] for gi, k in enumerate(path) if states[gi][k] != -1}
    lead = [notes[i] for i in sorted(lead_idx, key=lambda i: notes[i]["start"])]
    rhythm = [n for i, n in enumerate(notes) if i not in lead_idx]
    if len(lead) < LEAD_MIN_NOTES or len(lead) / len(notes) < LEAD_MIN_SHARE or len(rhythm) < LEAD_MIN_NOTES:
        return None
    return lead, rhythm
