"""Basic Pitch thresholds for electric solos without losing acoustic accuracy.

The shipped thresholds (onset 0.65 / frame 0.35 / 100 ms) were swept on GuitarSet (acoustic).
This sweeps the same decoder on Guitar-TECHS P3 solos (real electric, amp mic; halves kept apart),
GuitarSet player 05 and IDMT licks, from one model pass per clip.

  PYTHONPATH=workers/analysis:apps/api .venv/bin/python eval/bp_sweep_electric.py
"""

from __future__ import annotations

import itertools
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "workers" / "analysis"))
sys.path.insert(0, str(HERE))

from tabgen_analysis.stages import transcribe as tr  # noqa: E402

ONSETS, FRAMES, MINS = (0.45, 0.55, 0.65, 0.75, 0.85), (0.25, 0.3, 0.35, 0.4), (50.0, 70.0, 100.0)
SETTINGS = list(itertools.product(ONSETS, FRAMES, MINS))


def f1(ref, est, tol=0.05):
    import mir_eval
    if not ref or not est:
        return 0.0
    hz = lambda m: 440 * 2 ** ((m - 69) / 12)  # noqa: E731
    m = mir_eval.transcription.match_notes(
        np.array([[n["start"], n["end"]] for n in ref]), np.array([hz(n["midi"]) for n in ref]),
        np.array([[n["start"], max(n["end"], n["start"] + 0.02)] for n in est]), np.array([hz(n["midi"]) for n in est]),
        onset_tolerance=tol, offset_ratio=None)
    p, r = len(m) / len(est), len(m) / len(ref)
    return 0.0 if not m else 2 * p * r / (p + r)


def clips():
    from tab_bench import guitarset_clips
    from technique_bench import licks
    from tabgen_analysis.config import track_dir
    from tabgen_analysis.stages.decode import decode
    from tabgen_analysis.stages.separate import stems_dir
    sets = {"p3_odd": [], "p3_even": []}
    for i in range(1, 13):
        d = HERE.parent / "data" / "eval" / "real" / f"gt-{i:02d}"
        h, _ = decode(d / "audio.wav")
        sd = stems_dir(track_dir(h))
        wav = sd / "guitar_plus_bass.wav" if (sd / "guitar_plus_bass.wav").exists() else sd / "guitar.wav"
        ref = json.loads((d / "ref.json").read_text())["tracks"][0]["notes"]
        sets["p3_odd" if i % 2 else "p3_even"].append((wav, ref))
    sets["gs05"] = [(c["wav"], c["notes"]) for c in guitarset_clips("05")]
    sets["idmt"] = [(c["wav"], c["notes"]) for c in licks()]
    return sets


def main():
    sets = clips()
    scores = {s: {k: [] for k in sets} for s in SETTINGS}
    for name, items in sets.items():
        for wav, ref in items:
            for s, ev in zip(SETTINGS, tr._bp_events(Path(wav), SETTINGS)):
                scores[s][name].append(f1(ref, tr.clean_notes(tr._event_notes(ev))))
        print("done", name, flush=True)
    rows = []
    for s in SETTINGS:
        m = {k: float(np.mean(v)) for k, v in scores[s].items()}
        rows.append((s, m))
        print(s, " ".join(f"{k}={v:.3f}" for k, v in m.items()), flush=True)
    out = HERE.parent / "data" / "eval" / "bp_sweep_electric.json"
    out.write_text(json.dumps([{"setting": s, **m} for s, m in rows], indent=1))


if __name__ == "__main__":
    main()
