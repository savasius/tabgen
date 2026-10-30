"""Chord recognizers on GuitarSet's performed-chord annotations (mir_eval majmin / root).

  PYTHONPATH=workers/analysis .venv/bin/python eval/chord_bench.py [--players 05] [--recognizers lv-chordia,template]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "workers" / "analysis"))
GS = HERE.parent / "data" / "eval" / "guitarset"


def main():
    import mir_eval
    from tabgen_analysis.stages import chords as C
    ap = argparse.ArgumentParser()
    ap.add_argument("--players", default="05")
    ap.add_argument("--recognizers", default="lv-chordia,template")
    args = ap.parse_args()
    ann = next(GS.rglob("*.jams")).parent
    audio = next((GS / "audio").rglob("*_mic.wav")).parent
    scores = {r: {"majmin": [], "root": []} for r in args.recognizers.split(",")}
    for jp in sorted(ann.glob("*_comp.jams")):
        if not any(jp.name.startswith(p + "_") for p in args.players.split(",")):
            continue
        d = json.loads(jp.read_text())
        perf = [a for a in d["annotations"] if a["namespace"] == "chord"][-1]["data"]
        ref_iv = np.array([[x["time"], x["time"] + x["duration"]] for x in perf])
        ref_lab = [x["value"] for x in perf]
        for name in scores:
            segs = C.get_recognizer(name).recognize(audio / f"{jp.stem}_mic.wav")
            est_iv = np.array([[s.start, s.end] for s in segs])
            est_lab = [s.label for s in segs]
            est_iv, est_lab = mir_eval.util.adjust_intervals(est_iv, est_lab, ref_iv.min(), ref_iv.max(),
                                                             mir_eval.chord.NO_CHORD, mir_eval.chord.NO_CHORD)
            iv, r, e = mir_eval.util.merge_labeled_intervals(ref_iv, ref_lab, est_iv, est_lab)
            dur = mir_eval.util.intervals_to_durations(iv)
            for m in ("majmin", "root"):
                scores[name][m].append(mir_eval.chord.weighted_accuracy(getattr(mir_eval.chord, m)(r, e), dur))
    for name, v in scores.items():
        print(f"{name:12s} majmin {np.mean(v['majmin']):.3f}  root {np.mean(v['root']):.3f}  n={len(v['root'])}")


if __name__ == "__main__":
    main()
