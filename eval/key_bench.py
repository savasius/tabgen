"""Global key: S-KEY vs the license-free key-profile finder, on GuitarSet's annotated keys.

  PYTHONPATH=workers/analysis .venv/bin/python eval/key_bench.py [--players 05]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "workers" / "analysis"))
GS = HERE.parent / "data" / "eval" / "guitarset"

FLAT = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}


def norm(t: str) -> str:
    return FLAT.get(t, t)


def main():
    import mir_eval
    from tabgen_analysis.stages import key as K
    ap = argparse.ArgumentParser()
    ap.add_argument("--players", default="05")
    args = ap.parse_args()
    ann = next(GS.rglob("*.jams")).parent
    audio = next((GS / "audio").rglob("*_mic.wav")).parent
    rows = {"skey": [], "temperley": [], "krumhansl": []}
    for jp in sorted(ann.glob("*.jams")):
        if not any(jp.name.startswith(p + "_") for p in args.players.split(",")):
            continue
        d = json.loads(jp.read_text())
        ref = next(a for a in d["annotations"] if a["namespace"] == "key_mode")["data"][0]["value"]
        rt, rm = ref.split(":")
        ref_s = f"{norm(rt)} {rm}"
        wav = audio / f"{jp.stem}_mic.wav"
        for name in rows:
            k = K.detect_key(wav) if name == "skey" else K.detect_key_profile(wav, name)
            est = f"{k['tonic']} {k['mode']}"
            rows[name].append(mir_eval.key.weighted_score(ref_s, est))
    for name, v in rows.items():
        exact = sum(1 for x in v if x == 1.0) / len(v)
        print(f"{name:10s} exact {exact:.3f}  mirex-weighted {sum(v) / len(v):.3f}  n={len(v)}")


if __name__ == "__main__":
    main()
