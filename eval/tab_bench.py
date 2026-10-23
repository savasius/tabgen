"""Tab transcription bake-off on real guitar recordings with string/fret ground truth.

Datasets (audio stays out of git, under data/eval/):
  * GuitarSet (CC BY 4.0) — real acoustic guitar, hexaphonic-pickup string/fret labels.
    `--set guitarset` uses player 05 (30 clips: comp + solo, 5 styles) by default.
  * Hard variants of the same clips: `--hard dist` (amp-style distortion + cab filter),
    `--hard mix` (guitar buried under bass/drums/pad, then Demucs htdemucs_6s guitar stem).

Metrics per backend (mir_eval, onset-only, 50 ms):
  note_f1      pitch + onset (the transcription itself)
  tab_f1       pitch + onset + same string + same fret (what the user reads)
  sf_acc       string/fret accuracy over correctly-transcribed notes (fingering quality)
  export_keep  share of fingered notes that survive into the alphaTex we render

Caveat printed with the report: Basic Pitch and TabCNN-GPFX both saw GuitarSet in training,
so GuitarSet numbers are optimistic for them. The hard variants and IDMT are the honest check.

  PYTHONPATH=workers/analysis .venv/bin/python eval/tab_bench.py --backends bp-legacy,bp
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(REPO / "workers" / "analysis"))

from tabgen_analysis import fingering, tab_export  # noqa: E402
from tabgen_analysis.fingering import STANDARD_TUNING  # noqa: E402

DATA = REPO / "data" / "eval"
GS = DATA / "guitarset"
CACHE = DATA / "bench-cache"


# ---------------------------------------------------------------- datasets


def _jams_notes(path: Path) -> tuple[list[dict], list[float]]:
    j = json.loads(path.read_text())
    notes: list[dict] = []
    beats: list[float] = []
    for ann in j["annotations"]:
        ns = ann["namespace"]
        if ns == "note_midi":
            s = int(ann["annotation_metadata"]["data_source"])  # 0 = low E
            for d in ann["data"]:
                midi = int(round(float(d["value"])))
                notes.append({
                    "start": float(d["time"]), "end": float(d["time"]) + float(d["duration"]),
                    "midi": midi, "string_i": s, "fret": midi - STANDARD_TUNING[s],
                })
        elif ns == "beat_position" and not beats:
            beats = [float(d["time"]) for d in ann["data"]]
    notes.sort(key=lambda n: (n["start"], n["midi"]))
    return notes, beats


def guitarset_clips(players: str = "05", limit: int | None = None) -> list[dict]:
    ann_dir = next((p for p in (GS / "annotation").rglob("*.jams")), None)
    if ann_dir is None:
        raise SystemExit("GuitarSet not found under data/eval/guitarset (see eval/README.md)")
    ann_root = ann_dir.parent
    audio_root = next((GS / "audio").rglob("*_mic.wav")).parent
    clips = []
    for jp in sorted(ann_root.glob("*.jams")):
        if not any(jp.name.startswith(p + "_") for p in players.split(",")):
            continue
        wav = audio_root / (jp.stem + "_mic.wav")
        if not wav.exists():
            continue
        notes, beats = _jams_notes(jp)
        clips.append({"id": jp.stem, "wav": wav, "notes": notes, "beats": beats})
    return clips[:limit] if limit else clips


# ---------------------------------------------------------------- hard variants


def _distort(y: np.ndarray, sr: int) -> np.ndarray:
    from scipy.signal import butter, sosfilt
    pre = sosfilt(butter(2, 700, "highpass", fs=sr, output="sos"), y) * 0.6 + y * 0.4
    drive = np.tanh(18.0 * pre / (np.abs(pre).max() + 1e-9))
    cab = sosfilt(butter(4, [90, 4800], "bandpass", fs=sr, output="sos"), drive)
    return (0.8 * cab / (np.abs(cab).max() + 1e-9)).astype(np.float32)


def _band(sr: int, n: int, notes: list[dict], seed: int) -> np.ndarray:
    """Rights-free backing: kick/snare/hat on the clip's beats + sine bass on chord roots + a pad."""
    rng = np.random.default_rng(seed)
    out = np.zeros(n, np.float64)
    t = np.arange(n) / sr
    dur = n / sr
    # drums at ~ the guitar's note density tempo (beats from notes are fine for distraction)
    bpm = 100.0
    for k, bt in enumerate(np.arange(0, dur, 60 / bpm / 2)):
        a = int(bt * sr)
        L = min(n - a, int(0.25 * sr))
        if L <= 0:
            break
        env = np.exp(-np.arange(L) / (0.04 * sr))
        if k % 4 == 0:
            out[a:a + L] += 0.9 * np.sin(2 * np.pi * 55 * np.arange(L) / sr * (1 + env)) * env
        elif k % 4 == 2:
            out[a:a + L] += 0.5 * rng.standard_normal(L) * env
        out[a:a + min(L, int(0.03 * sr))] += 0.15 * rng.standard_normal(min(L, int(0.03 * sr)))
    # bass follows the lowest guitar note an octave down (correlated distractor — the hard part)
    for nt in notes:
        a, b = int(nt["start"] * sr), min(n, int(nt["end"] * sr))
        if b <= a or nt["string_i"] > 1:
            continue
        f = 440 * 2 ** ((nt["midi"] - 12 - 69) / 12)
        out[a:b] += 0.35 * np.sin(2 * np.pi * f * t[a:b]) * np.exp(-(t[a:b] - t[a]) / 0.8)
    # pad: detuned saws on A minor-ish cluster, constant
    for f in (220.0, 261.6, 329.6):
        out += 0.04 * (2 * ((t * f * 1.003) % 1) - 1)
    return out


def hard_variant(clip: dict, kind: str) -> Path:
    dest = DATA / f"hard-{kind}" / f"{clip['id']}.wav"
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    y, sr = sf.read(str(clip["wav"]), dtype="float32")
    if y.ndim == 2:
        y = y.mean(axis=1)
    if kind == "dist":
        sf.write(str(dest), _distort(y, sr), sr)
        return dest
    if kind == "mix":
        g = _distort(y, sr) * 0.5 + 0.5 * y / (np.abs(y).max() + 1e-9)
        band = _band(sr, len(y), clip["notes"], seed=int(hashlib.md5(clip["id"].encode()).hexdigest()[:6], 16))
        mix = g / (np.sqrt(np.mean(g ** 2)) + 1e-9) + 1.6 * band / (np.sqrt(np.mean(band ** 2)) + 1e-9)
        mix = (0.9 * mix / np.abs(mix).max()).astype(np.float32)
        mix_path = dest.with_suffix(".mix.wav")
        sf.write(str(mix_path), mix, sr)
        sf.write(str(dest), _demucs_guitar(mix_path), 44100)
        return dest
    raise ValueError(kind)


def _demucs_guitar(mix_path: Path) -> np.ndarray:
    import tempfile
    from tabgen_analysis.stages import separate
    with tempfile.TemporaryDirectory() as td:
        track = Path(td)
        y, sr = sf.read(str(mix_path), dtype="float32")
        import librosa
        y44 = librosa.resample(y, orig_sr=sr, target_sr=44100)
        sf.write(str(track / "mix.wav"), np.stack([y44, y44], axis=1), 44100)
        stems = separate.separate(track)
        g, _ = sf.read(str(stems / "guitar.wav"), dtype="float32")
        return g.mean(axis=1) if g.ndim == 2 else g


# ---------------------------------------------------------------- backends


def _cached(backend: str, wav: Path, fn) -> list[dict]:
    key = hashlib.sha1(f"{backend}|{wav.resolve()}|{wav.stat().st_size}".encode()).hexdigest()[:16]
    p = CACHE / backend / f"{wav.stem}-{key}.json"
    if p.exists():
        return json.loads(p.read_text())
    p.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    notes = fn(wav)
    p.write_text(json.dumps({"notes": notes, "sec": round(time.time() - t0, 2)}))
    return json.loads(p.read_text())


def run_backend(name: str, wav: Path) -> dict:
    from tabgen_analysis.stages import transcribe as tr
    if name == "yourmt3":
        # Eval-only (GPL-3.0 code, kept out of the app): notes precomputed by
        # eval/backends/yourmt3_runner.py in its own venv; same TabCNN prior as Basic Pitch.
        src = CACHE / "yourmt3-raw" / f"{wav.stem}.json"
        if not src.exists():
            raise SystemExit(f"missing {src}; run eval/backends/yourmt3_runner.py first")

        def load(w):
            notes = json.loads(src.read_text())["notes"]
            tr.attach_tabcnn(notes, w, list(STANDARD_TUNING))
            return notes
        return _cached("yourmt3-tabcnn", wav, load)
    if not hasattr(tr, "get_transcriber"):  # baseline checkout (pre bake-off code)
        def legacy(w):
            notes = tr.transcribe_basic_pitch(w)
            tr.attach_tabcnn(notes, w, list(STANDARD_TUNING))
            return notes
        return _cached(name, wav, legacy)
    return _cached(name, wav, lambda w: tr.get_transcriber(name).transcribe(w, list(STANDARD_TUNING)))


# ---------------------------------------------------------------- metrics


def _mir(ref: list[dict], est: list[dict]) -> tuple[float, float, float, list[tuple[int, int]]]:
    import mir_eval
    if not ref or not est:
        return 0.0, 0.0, 0.0, []
    ri = np.array([[n["start"], max(n["end"], n["start"] + 0.01)] for n in ref])
    rp = np.array([440 * 2 ** ((n["midi"] - 69) / 12) for n in ref])
    ei = np.array([[n["start"], max(n["end"], n["start"] + 0.01)] for n in est])
    ep = np.array([440 * 2 ** ((n["midi"] - 69) / 12) for n in est])
    match = mir_eval.transcription.match_notes(ri, rp, ei, ep, onset_tolerance=0.05, offset_ratio=None)
    tp = len(match)
    p, r = tp / len(est), tp / len(ref)
    return p, r, (0.0 if tp == 0 else 2 * p * r / (p + r)), match


def score(ref: list[dict], est: list[dict]) -> dict:
    p, r, f, match = _mir(ref, est)
    sf_ok = sum(1 for i, j in match
                if est[j].get("string_i") == ref[i]["string_i"] and est[j].get("fret") == ref[i]["fret"])
    tp_tab = sf_ok
    tp_p = tp_tab / max(1, len(est))
    tp_r = tp_tab / max(1, len(ref))
    tab_f = 0.0 if tp_tab == 0 else 2 * tp_p * tp_r / (tp_p + tp_r)
    return {"note_p": p, "note_r": r, "note_f1": f, "tab_f1": tab_f,
            "sf_acc": sf_ok / max(1, len(match)), "n_ref": len(ref), "n_est": len(est)}


def export_keep(fingered: list[dict], beats: list[float], duration: float) -> float:
    """Fraction of fingered notes that appear as note tokens in the alphaTex."""
    if not fingered:
        return 1.0
    bars = []
    for i in range(0, len(beats), 4):
        ids = list(range(i, min(i + 4, len(beats))))
        bars.append({"index": len(bars), "start": beats[ids[0]], "end": beats[ids[-1]], "beats": ids})
    rows = [dict(n, string=fingering.display_string(n["string_i"])) for n in fingered]
    tex = tab_export.to_alphatex(rows, bars, beats, duration)
    body = tex.split("\n.\n", 1)[-1]
    import re
    toks = re.findall(r"(?<![\w.])(\d+)\.(\d)(\{[^}]*\})?", body)
    emitted = sum(1 for *_x, eff in toks if "t}" not in (eff or "") and "{t" not in (eff or ""))
    return min(1.0, emitted / len(fingered))


# ---------------------------------------------------------------- pipeline under test


def fingered_from(raw: dict, beats: list[float], audio: Path | None, cleaner: str,
                  fing: str = "legacy") -> list[dict]:
    from tabgen_analysis import techniques
    from tabgen_analysis.stages import transcribe as tr
    notes = [dict(n) for n in raw["notes"]]
    notes = tr.clean_notes(notes) if cleaner == "legacy" or not hasattr(tr, "clean_notes_v2") \
        else tr.clean_notes_v2(notes)
    if fing == "v2":
        a = techniques.load_audio(audio)
        techniques.attach_onsets(notes, a)
        notes = techniques.merge_split_bends(notes, a)
        if hasattr(techniques, "resolve_continuations"):
            notes = techniques.resolve_continuations(notes)
        placed = fingering.assign_notes_v2(notes, tuning=list(STANDARD_TUNING))
    else:
        placed = fingering.assign_notes(notes, tuning=list(STANDARD_TUNING))
    return [n for n in placed if n.get("string_i") is not None]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backends", default="bp")
    ap.add_argument("--cleaner", default="v2", help="legacy | v2 (per backend: name:cleaner)")
    ap.add_argument("--players", default="05")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--hard", default="", help="comma list: dist,mix")
    ap.add_argument("--out", type=Path, default=DATA / "bench.json")
    args = ap.parse_args()

    clips = guitarset_clips(args.players, args.limit)
    conds = ["clean"] + [h for h in args.hard.split(",") if h]
    results: dict = {}
    for spec in args.backends.split(","):
        backend, cleaner, fing = (spec.split(":") + ["", ""])[:3]
        cleaner = cleaner or args.cleaner
        fing = fing or "legacy"
        label = f"{backend}:{cleaner}:{fing}"
        for cond in conds:
            rows = []
            secs = 0.0
            for c in clips:
                wav = c["wav"] if cond == "clean" else hard_variant(c, cond)
                raw = run_backend(backend, wav)
                secs += float(raw.get("sec") or 0)
                dur = sf.info(str(wav)).duration
                fing_notes = fingered_from(raw, c["beats"], wav, cleaner, fing)
                s = score(c["notes"], fing_notes)
                s["export_keep"] = export_keep(fing_notes, c["beats"], dur)
                s["id"] = c["id"]
                rows.append(s)
            agg = {k: round(float(np.mean([r[k] for r in rows])), 4)
                   for k in ("note_p", "note_r", "note_f1", "tab_f1", "sf_acc", "export_keep")}
            agg["sec_per_clip"] = round(secs / max(1, len(clips)), 2)
            agg["n_clips"] = len(rows)
            for style in ("comp", "solo"):
                sub = [r for r in rows if r["id"].endswith(style)]
                if sub:
                    agg[f"{style}_note_f1"] = round(float(np.mean([r["note_f1"] for r in sub])), 4)
                    agg[f"{style}_tab_f1"] = round(float(np.mean([r["tab_f1"] for r in sub])), 4)
            results.setdefault(label, {})[cond] = {"mean": agg, "clips": rows}
            print(f"{label:28s} {cond:6s} " + " ".join(f"{k}={v}" for k, v in agg.items()), flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    prev = json.loads(args.out.read_text()) if args.out.exists() else {}
    prev.update(results)
    args.out.write_text(json.dumps(prev, indent=1))


if __name__ == "__main__":
    main()
