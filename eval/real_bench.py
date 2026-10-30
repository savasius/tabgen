"""Score TabGen on real songs against a reference tab you trust.

One folder per song under data/eval/real/<name>/ (personal copies, never committed):

  audio.mp3 | .m4a | .wav | .flac   the recording
  ref.gp | .gp5 | .gpx | .musicxml | .alphatex   a tab you trust for that recording
  (or ref.json in score2json's format, e.g. from eval/real/gtechs_to_real.py)
  meta.json (optional)   {"tracks": [0, 2]}  which reference tracks are guitars that you hear
                         (default: every pitched track with 6+ strings), "title": "...",
                         "synced": true  the reference is already on the recording's timeline

The reference is converted by eval/real/score2json.mjs (alphaTab, repeats unrolled), then aligned
to the recording with DTW on chroma: tab files are not in sync with recordings (count-ins, tempo
drift, live takes). Every reference onset is moved onto the recording's timeline.

Reported per song:
  note_f1 / tab_f1   all reference guitars vs TabGen's "all guitars" tab (onset +-100 ms after
                     alignment, since alignment itself is only good to a frame or two)
  sf_acc             right string+fret among correctly heard notes
  part_tab_f1        each reference guitar vs the TabGen guitar part matched to it
  tempo_ratio        TabGen BPM / reference BPM (2.0 = double-time grid, 0.5 = half-time)
  downbeat_f         TabGen bar lines vs the reference's (+-70 ms, mir_eval)
  align_cost         DTW cost per step; high = the reference probably doesn't match this take

  PYTHONPATH=workers/analysis:apps/api .venv/bin/python eval/real_bench.py [--only name] [--reanalyze]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(REPO / "workers" / "analysis"))
sys.path.insert(0, str(REPO / "apps" / "api"))
sys.path.insert(0, str(HERE))

REAL = REPO / "data" / "eval" / "real"
AUDIO_EXT = (".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac")
REF_EXT = (".gp", ".gp3", ".gp4", ".gp5", ".gpx", ".musicxml", ".xml", ".mxl", ".alphatex", ".tex")
FPS = 10.0          # alignment frame rate (100 ms)
ONSET_TOL = 0.10


def _first(d: Path, stem: str, exts: tuple[str, ...]) -> Path | None:
    for ext in exts:
        p = d / f"{stem}{ext}"
        if p.exists():
            return p
    return None


def load_reference(path: Path) -> dict:
    if path.suffix == ".json":
        return json.loads(path.read_text())
    out = subprocess.run(["node", str(HERE / "real" / "score2json.mjs"), str(path)],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def guitar_tracks(ref: dict, wanted: list | None) -> list[dict]:
    if wanted:
        return [t for t in ref["tracks"] if t["index"] in wanted or t["name"] in wanted]
    return [t for t in ref["tracks"] if not t["percussion"] and t["strings"] >= 6 and t["notes"]]


# ---------------------------------------------------------------- alignment


def _roll_chroma(notes: list[dict], n: int) -> np.ndarray:
    C = np.zeros((12, n))
    for nt in notes:
        a = int(nt["start"] * FPS)
        b = max(a + 1, min(n, int(min(nt["end"], nt["start"] + 1.5) * FPS)))
        if a >= n:
            continue
        C[nt["midi"] % 12, a:b] += np.exp(-np.arange(b - a) / (0.4 * FPS))
    return C


def _audio_chroma(path: Path) -> np.ndarray:
    import librosa
    y, sr = librosa.load(str(path), sr=22050, mono=True)
    hop = int(sr / FPS)
    return librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)


def _robust_line(x: np.ndarray, y: np.ndarray, tol: float = 0.3, iters: int = 400) -> tuple[float, float]:
    """y = o + k x fitted to the DTW path, ignoring stretches where the path wandered (RANSAC)."""
    rng = np.random.default_rng(0)
    best, best_in = (0.0, 1.0), -1
    for _ in range(iters):
        i, j = rng.choice(len(x), 2, replace=False)
        if abs(x[j] - x[i]) < 2.0:
            continue
        k = (y[j] - y[i]) / (x[j] - x[i])
        if not 0.5 < k < 2.0:
            continue
        o = y[i] - k * x[i]
        n_in = int(np.sum(np.abs(y - (o + k * x)) < tol))
        if n_in > best_in:
            best, best_in = (o, k), n_in
    o, k = best
    m = np.abs(y - (o + k * x)) < tol
    if m.sum() > 10:
        k, o = np.polyfit(x[m], y[m], 1)
    return float(o), float(k)


def _onset_env(path: Path) -> tuple[np.ndarray, float]:
    import librosa
    y, sr = librosa.load(str(path), sr=22050, mono=True)
    hop = 256
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    return env / (env.max() + 1e-9), hop / sr


def align(ref_notes: list[dict], audio_chroma: np.ndarray, ref_duration: float,
          onset_env: tuple[np.ndarray, float] | None = None):
    """Map reference time -> recording time. Returns (fn, cost per step).

    1. chroma DTW (100 ms frames) for a rough path: robust to intros and repeats,
    2. a straight line (offset + speed) fitted robustly to that path,
    3. per 6 s window, the offset that puts the reference onsets on peaks of the recording's
       onset envelope (tracked window to window, so slow drift in live takes is followed).
    """
    import librosa
    n_ref = int(ref_duration * FPS) + 2
    R = _roll_chroma(ref_notes, n_ref)
    # a small floor so silent frames compare as "flat" instead of undefined
    R = R + 1e-2
    R = R / np.linalg.norm(R, axis=0, keepdims=True)
    A = audio_chroma + 1e-2
    A = A / np.linalg.norm(A, axis=0, keepdims=True)
    # Pinned ends suit a tab that covers the whole take; an open start/end suits a tab without
    # the intro or count-in. Try both, keep the one whose onsets land on the recording's onsets.
    best = None
    for subseq in (False, True):
        if subseq and A.shape[1] < R.shape[1]:
            continue  # open ends need the recording to be the longer one
        _D, wp = librosa.sequence.dtw(X=R, Y=A, metric="cosine", subseq=subseq)
        wp = wp[::-1]
        cost = float(np.mean(1 - np.sum(R[:, wp[:, 0]] * A[:, wp[:, 1]], axis=0)))
        o, k = _robust_line(wp[:, 0] / FPS, wp[:, 1] / FPS)
        if onset_env is None:
            return (lambda t, o=o, k=k: o + k * t), cost
        fn, fit = _refine(ref_notes, ref_duration, o, k, onset_env)
        if best is None or fit > best[2]:
            best = (fn, cost, fit)
    return best[0], best[1]


def _refine(ref_notes, ref_duration, o, k, onset_env):
    """Per-window offset on top of the line; returns (fn, mean onset-envelope hit)."""
    env, hop_s = onset_env
    onsets = np.array(sorted({round(n["start"], 3) for n in ref_notes}))

    def hit(times):
        idx = np.round(np.asarray(times) / hop_s).astype(int)
        ok = (idx >= 2) & (idx < len(env) - 2)
        vals = np.max(np.stack([env[np.clip(idx + s, 0, len(env) - 1)] for s in (-2, -1, 0, 1, 2)]), axis=0)
        return vals, ok
    win, step, reach = 6.0, 3.0, 0.4
    centres, offs = [], []
    lag = np.arange(-reach, reach + 1e-9, 0.01)
    for c in np.arange(0, max(ref_duration, win) + step, step):
        sel = onsets[(onsets >= c - win / 2) & (onsets < c + win / 2)]
        if len(sel) < 4:
            continue
        base = o + k * sel
        scores = []
        for d in lag:
            vals, ok = hit(base + d)  # best envelope value within +-23 ms of each onset
            scores.append(float(np.mean(vals[ok])) if ok.any() else 0.0)
        # Search around the fitted line, not from the previous window: on a strict grid (drums
        # bleeding into the stem) a wrong eighth-note lock would otherwise carry forward.
        scores = np.array(scores) - 0.25 * np.abs(lag) * (np.max(scores) + 1e-9)
        centres.append(c)
        offs.append(float(lag[int(np.argmax(scores))]))
    if centres:
        offs = np.array(offs)
        if len(offs) >= 5:
            offs = np.array([np.median(offs[max(0, i - 2):i + 3]) for i in range(len(offs))])
        centres = np.array(centres)
        fn = lambda t: float(o + k * t + np.interp(t, centres, offs))  # noqa: E731
    else:
        fn = lambda t: o + k * t  # noqa: E731
    vals, ok = hit([fn(t) for t in onsets])
    return fn, (float(np.mean(vals[ok])) if ok.any() else 0.0) * ok.mean()


def warp(notes: list[dict], fn) -> list[dict]:
    out = []
    for n in notes:
        a, b = fn(n["start"]), fn(n["end"])
        out.append({**n, "start": a, "end": max(b, a + 0.02)})
    return out


# ---------------------------------------------------------------- scoring


def _tab_rows(tab: dict) -> list[dict]:
    rows = []
    for n in tab.get("notes") or []:
        t0 = n.get("t0", n["start"])
        rows.append({"start": t0, "end": max(n["end"], t0 + 0.02), "midi": n["midi"],
                     "string_i": 6 - int(n["string"]), "fret": n["fret"]})
    return rows


def score(ref: list[dict], est: list[dict]) -> dict:
    import mir_eval
    if not ref or not est:
        return {"note_f1": 0.0, "tab_f1": 0.0, "sf_acc": 0.0, "note_p": 0.0, "note_r": 0.0}
    hz = lambda m: 440 * 2 ** ((m - 69) / 12)  # noqa: E731
    ri = np.array([[n["start"], n["end"]] for n in ref])
    ei = np.array([[n["start"], n["end"]] for n in est])
    match = mir_eval.transcription.match_notes(
        ri, np.array([hz(n["midi"]) for n in ref]), ei, np.array([hz(n["midi"]) for n in est]),
        onset_tolerance=ONSET_TOL, offset_ratio=None)
    tp = len(match)
    p, r = tp / len(est), tp / len(ref)
    f = 0.0 if tp == 0 else 2 * p * r / (p + r)
    ok = sum(1 for i, j in match if est[j]["string_i"] == ref[i]["string_i"] and est[j]["fret"] == ref[i]["fret"])
    tp_, tr_ = ok / len(est), ok / len(ref)
    return {"note_p": p, "note_r": r, "note_f1": f,
            "tab_f1": 0.0 if ok == 0 else 2 * tp_ * tr_ / (tp_ + tr_), "sf_acc": ok / max(1, tp)}


def ref_downbeats(ref: dict, fn) -> np.ndarray:
    bars = ref.get("bars") or []
    return np.array([fn(b) for b in bars]) if bars else np.array([])


def evaluate_song(d: Path, reanalyze: bool, input_override: str | None = None) -> dict:
    from tabgen_analysis import pipeline
    from tabgen_analysis.stages.decode import decode
    import mir_eval
    audio = next((p for p in sorted(d.iterdir()) if p.stem == "audio" and p.suffix.lower() in AUDIO_EXT), None)
    refp = _first(d, "ref", REF_EXT + (".json",))
    if not audio or not refp:
        raise SystemExit(f"{d.name}: needs audio.* and ref.* (see eval/real_bench.py)")
    meta = json.loads((d / "meta.json").read_text()) if (d / "meta.json").exists() else {}
    if input_override:
        meta["input"] = input_override
    ref = load_reference(refp)
    tracks = guitar_tracks(ref, meta.get("tracks"))
    if not tracks:
        raise SystemExit(f"{d.name}: no guitar tracks in {refp.name}; set meta.json tracks")

    audio_hash, _track = decode(audio)
    a = pipeline.run(audio, meta={"title": meta.get("title") or d.name, "source": "eval",
                                  "input": meta.get("input") or "band"},
                     audio_hash=audio_hash, force=reanalyze)
    from tabgen_analysis.config import track_dir
    from tabgen_analysis.stages import separate
    guitar = separate.stems_dir(track_dir(audio_hash)) / "guitar.wav"
    if meta.get("input") == "guitar":
        guitar = separate.guitar_only_dir(track_dir(audio_hash)) / "guitar.wav"

    all_ref = sorted((n for t in tracks for n in t["notes"]), key=lambda n: n["start"])
    if meta.get("synced"):  # reference recorded with the audio (e.g. a MIDI pickup): no alignment
        fn, cost = (lambda t: t), 0.0
    else:
        fn, cost = align(all_ref, _audio_chroma(guitar), ref["duration"], _onset_env(guitar))
    warped = {t["index"]: warp(t["notes"], fn) for t in tracks}
    union_ref = sorted((n for ns in warped.values() for n in ns), key=lambda n: n["start"])

    out = {"song": d.name, "align_cost": round(cost, 3), "ref_tracks": [t["name"] for t in tracks],
           "n_ref": len(union_ref), "version": a["version"]}
    s = score(union_ref, _tab_rows(a["tab"] or {}))
    out.update({k: round(v, 4) for k, v in s.items()})

    # per guitar: match TabGen parts to reference tracks
    parts = a.get("parts") or []
    est_parts = [("all", _tab_rows(a["tab"] or {}))] if not parts else [(p["id"], _tab_rows(p["tab"])) for p in parts]
    from scipy.optimize import linear_sum_assignment
    M = np.array([[score(warped[t["index"]], e)["tab_f1"] for _, e in est_parts] for t in tracks])
    ri, ei = linear_sum_assignment(-M)
    matched = dict(zip(ri, ei))
    out["parts_found"] = len(parts) or 1
    out["part_tab_f1"] = round(float(np.mean([M[i, matched[i]] if i in matched else 0.0
                                              for i in range(len(tracks))])), 4)
    out["per_track"] = {t["name"]: (est_parts[matched[i]][0] if i in matched else None,
                                    round(float(M[i, matched[i]]), 4) if i in matched else 0.0)
                        for i, t in enumerate(tracks)}

    # rhythm: tempo octave and bar lines (aligned reference bar starts)
    tempos = ref.get("tempos") or [{"sec": 0.0, "bpm": ref.get("tempo") or 120}]
    spans = [(tempos[i + 1]["sec"] if i + 1 < len(tempos) else ref["duration"]) - t["sec"] for i, t in enumerate(tempos)]
    # tempo that holds for most of the song (time-weighted median): a few odd bars don't move it
    order = np.argsort([t["bpm"] for t in tempos])
    cum = np.cumsum(np.maximum(np.array(spans)[order], 0))
    ref_bpm = float(tempos[int(order[np.searchsorted(cum, cum[-1] / 2)])]["bpm"])
    # tempo as heard: reference BPM scaled by the alignment's average speed
    if ref["duration"] > 0:
        speed = (fn(ref["duration"]) - fn(0)) / ref["duration"]
        ref_bpm_heard = ref_bpm / max(speed, 1e-6)
    else:
        ref_bpm_heard = ref_bpm
    out["ref_bpm"] = round(ref_bpm_heard, 1)
    out["bpm"] = a["tempo"]["bpm"]
    out["tempo_ratio"] = round(a["tempo"]["bpm"] / max(ref_bpm_heard, 1e-6), 3)
    rdb = ref_downbeats(ref, fn)
    if len(rdb) > 2:
        lo, hi = rdb[0] - 1, rdb[-1] + 1
        edb = np.array([t for t in a["downbeats"] if lo <= t <= hi])
        out["downbeat_f"] = round(float(mir_eval.beat.f_measure(rdb, edb, f_measure_threshold=0.07)), 4)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=REAL)
    ap.add_argument("--only", default="")
    ap.add_argument("--reanalyze", action="store_true")
    ap.add_argument("--input", choices=("guitar", "band"), help="override meta.json input for every song")
    ap.add_argument("--out", type=Path, default=REAL / "results.json")
    args = ap.parse_args()
    songs = sorted(p for p in args.root.iterdir() if p.is_dir() and (not args.only or p.name in args.only.split(",")))
    if not songs:
        raise SystemExit(f"no songs under {args.root} (see eval/real_bench.py docstring)")
    rows = []
    for d in songs:
        r = evaluate_song(d, args.reanalyze, args.input)
        rows.append(r)
        print(json.dumps(r, ensure_ascii=False), flush=True)
    keys = ("note_f1", "tab_f1", "sf_acc", "part_tab_f1", "downbeat_f")
    mean = {k: round(float(np.mean([r[k] for r in rows if k in r])), 4) for k in keys if any(k in r for r in rows)}
    print("MEAN", json.dumps(mean))
    args.out.write_text(json.dumps({"songs": rows, "mean": mean}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
