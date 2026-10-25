"""Tempo octave check: does the bar grid count the beat a guitarist counts?

GuitarSet pieces carry their tempo in the name (e.g. SS1-68-E = 68 BPM) and annotated beats, so
the 30 pieces (68-200 BPM) are a tempo test set. Each clip runs through the real pipeline
(Demucs, Beat This!, All-In-One) once; the cached analysis is reused afterwards, so the folding
rule can be re-scored without re-running the models:

  PYTHONPATH=workers/analysis:apps/api .venv/bin/python eval/tempo_bench.py [--kind comp] [--band]

Reports, per clip, the tracker BPMs, the BPM the app shows, and tempo_ratio = shown / true
(1.0 right, 2.0 double-time, 0.5 half-time). `features()` collects what a folding rule may use.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "workers" / "analysis"))
sys.path.insert(0, str(HERE))

from tab_bench import DATA, GS, _band, _jams_notes  # noqa: E402

OUT = DATA / "tempo"


def clips(player: str, kind: str) -> list[dict]:
    ann = next((GS / "annotation").rglob("*.jams")).parent
    audio = next((GS / "audio").rglob("*_mic.wav")).parent
    out = []
    for jp in sorted(ann.glob(f"{player}_*_{kind}.jams")):
        piece = jp.stem[3:].rsplit("_", 1)[0]
        bpm = float(piece.split("-")[1])
        _notes, beats = _jams_notes(jp)
        out.append({"id": jp.stem, "piece": piece, "bpm": bpm, "beats": beats,
                    "wav": audio / f"{jp.stem}_mic.wav", "notes": _notes})
    return out


def song_wav(c: dict, band: bool) -> Path:
    dest = OUT / ("band" if band else "clean") / f"{c['id']}.wav"
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    y, sr = sf.read(str(c["wav"]), dtype="float32")
    y = y.mean(axis=1) if y.ndim == 2 else y
    y = y / (np.sqrt(np.mean(y ** 2)) + 1e-9)
    if band:
        b = _band(sr, len(y), c["notes"], seed=len(c["id"]), beats=c["beats"])
        y = y + 1.2 * b / (np.sqrt(np.mean(b ** 2)) + 1e-9)
    y = 0.9 * y / np.abs(y).max()
    sf.write(str(dest), np.stack([y, y], axis=1).astype(np.float32), sr)
    return dest


def analyze(path: Path) -> dict:
    from tabgen_analysis import pipeline
    from tabgen_analysis.stages.decode import decode
    h, _t = decode(path)
    return pipeline.run(path, meta={"title": path.stem, "source": "eval"}, audio_hash=h)


def features(a: dict) -> dict:
    """What the analysis knows that bears on the tempo octave (all post-fold)."""
    beats = np.array(a["beats"])
    ib = np.diff(beats) if len(beats) > 1 else np.array([0.5])
    chords = [c for c in a["chords"] if c["label"] not in ("N", None)]
    beats_per_chord = float(np.median([c.get("beats", 1) for c in chords])) if chords else 0.0
    notes = (a.get("tab") or {}).get("notes") or []
    dur = max(1e-3, a["duration"])
    return {"bpm": a["tempo"]["bpm"], "bpm_allin1": a["tempo"].get("bpm_allin1"),
            "folded": a["tempo"].get("tempo_folded"), "source": a["tempo"].get("beat_source"),
            "beat_s": float(np.median(ib)), "beats_per_chord": beats_per_chord,
            "notes_per_beat": len(notes) / max(1, len(beats)), "notes_per_s": len(notes) / dur}


def cached_inputs(path: Path) -> dict | None:
    """Tracker outputs + transcribed onsets the pipeline cached for one clip (no model runs)."""
    from tabgen_analysis.config import track_dir
    from tabgen_analysis.stages.decode import decode, probe_duration
    h, _t = decode(path)
    st = track_dir(h) / "stages"
    bt = st / "beat_this-1.1-final0.json"
    aio = st / "allin1-infer-3.1-harmonix-all.json"
    notes = next(iter(sorted(st.glob("bp-0.4-onnx-tabcnn-gpfx-v6-guitar-src-guitar*.json"))), None)
    if not bt.exists() or notes is None:
        return None
    return {"bt": json.loads(bt.read_text()), "aio": json.loads(aio.read_text()) if aio.exists() else None,
            "onsets": [n["start"] for n in json.loads(notes.read_text())["notes"]],
            "duration": probe_duration(track_dir(h) / "mix.wav")}


def rule(x: dict, lo: float = 70.0, dense: float = float("inf")) -> float:
    """The pipeline's tempo choice with its knobs exposed (defaults = the rule before p2.6)."""
    from tabgen_analysis import pipeline
    from tabgen_analysis.stages import post
    aio = x["aio"] or {"bpm": 0, "downbeats": []}
    old_lo, old_dense = post._GUITAR_BPM_LO, pipeline.HALF_TIME_MAX_NOTES_PER_BEAT
    post._GUITAR_BPM_LO, pipeline.HALF_TIME_MAX_NOTES_PER_BEAT = lo, dense
    try:
        g, _src = pipeline.choose_beat_grid(x["bt"], aio, len(x["onsets"]), x["duration"])
        g = post.fold_tempo_octave(g, x["duration"])
    finally:
        post._GUITAR_BPM_LO, pipeline.HALF_TIME_MAX_NOTES_PER_BEAT = old_lo, old_dense
    return float(g["bpm"])


def right(bpm: float, truth: float) -> bool:
    return abs(np.log2(bpm / truth)) < 0.1


def fit() -> None:
    """Search the three knobs; report the old rule, the fit and leave-one-set-out."""
    import itertools
    sets = {}
    for name, kind, band in (("comp", "comp", False), ("solo", "solo", False), ("band", "comp", True)):
        rows = []
        for c in clips("05", kind):
            p = OUT / ("band" if band else "clean") / f"{c['id']}.wav"
            x = cached_inputs(p) if p.exists() else None
            if x:
                rows.append({**x, "truth": c["bpm"], "id": c["id"]})
        sets[name] = rows
    # (a "both trackers agree on a slow tempo -> keep it" rule was tried too: it broke solos)
    combos = [{"lo": lo, "dense": d} for lo, d in
              itertools.product([55, 60, 62, 65, 70], [3.0, 3.5, 4.0, 5.0, float("inf")])]

    def acc(rows, kw):
        return float(np.mean([right(rule(x, **kw), x["truth"]) for x in rows])) if rows else 0.0

    allrows = [r for v in sets.values() for r in v]
    old = {"lo": 70.0, "dense": float("inf")}
    print("clips", {k: len(v) for k, v in sets.items()})
    print("old rule", {k: round(acc(v, old), 3) for k, v in sets.items()}, "all", round(acc(allrows, old), 3))
    # prefer the smallest change from the old rule among equally good settings
    scored = sorted(combos, key=lambda c: (-acc(allrows, c), abs(c["lo"] - 70), c["dense"] != float("inf")))
    best = scored[0]
    print("best    ", {k: round(acc(v, best), 3) for k, v in sets.items()}, "all", round(acc(allrows, best), 3), best)
    for held in sets:
        train = [r for k, v in sets.items() if k != held for r in v]
        b = sorted(combos, key=lambda c: (-acc(train, c), abs(c["lo"] - 70), c["dense"] != float("inf")))[0]
        print(f"held-out {held:5s} {acc(sets[held], b):.3f} (old {acc(sets[held], old):.3f}) fitted {b}")
    for r in allrows:
        o, n = rule(r, **old), rule(r, **best)
        if right(o, r["truth"]) != right(n, r["truth"]):
            print(f"  changed {r['id']:24s} true {r['truth']:5.0f} old {o:6.1f} new {n:6.1f}")


def main() -> None:
    if "--fit" in sys.argv:
        fit()
        return
    ap = argparse.ArgumentParser()
    ap.add_argument("--player", default="05")
    ap.add_argument("--kind", default="comp")
    ap.add_argument("--band", action="store_true")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    rows = []
    for c in clips(args.player, args.kind):
        a = analyze(song_wav(c, args.band))
        f = features(a)
        r = {"id": c["id"], "true_bpm": c["bpm"], **f, "ratio": round(f["bpm"] / c["bpm"], 3)}
        rows.append(r)
        print(json.dumps(r), flush=True)
    ok = np.mean([abs(np.log2(r["ratio"])) < 0.1 for r in rows])
    print(f"RIGHT OCTAVE {ok:.3f} over {len(rows)} clips")
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
