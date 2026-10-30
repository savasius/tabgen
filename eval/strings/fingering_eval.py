"""Does the string model help the fingering? True pitches and onsets (string withheld), string+fret
accuracy of the fingering Viterbi at several weights of the string model.

  validation (picks the weight): IDMT licks -- not in the string model's training data
  test: Guitar-TECHS P3 solos, GuitarSet player 05

  PYTHONPATH=workers/analysis .venv/bin/python eval/strings/fingering_eval.py
"""

from __future__ import annotations

import dataclasses
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "workers" / "analysis"))
sys.path.insert(0, str(REPO / "eval"))

from tabgen_analysis import fingering, string_model  # noqa: E402
from tabgen_analysis.fingering import FingeringParams  # noqa: E402

WEIGHTS = (0.0, 1.0, 2.0, 4.0, 8.0)


def with_probs(clips):
    sets = []
    for wav, notes in clips:
        inp = [{"start": n["start"], "end": n["end"], "midi": n["midi"], "velocity": 0.7, "confidence": 0.7,
                "_gt": (n["string_i"], n["fret"])} for n in notes]
        for i, p in string_model.string_probs(Path(wav), inp).items():
            inp[i]["string_probs"] = p
        sets.append(inp)
    return sets


def acc(sets, w):
    p = dataclasses.replace(FingeringParams(), strnet=w)
    ok = tot = 0
    for inp in sets:
        out = fingering.assign_notes_v2([dict(n) for n in inp], params=p)
        ok += sum(1 for n in out if n.get("string_i") is not None and (n["string_i"], n["fret"]) == n["_gt"])
        tot += len(inp)
    return ok / max(1, tot)


def main():
    from tab_bench import guitarset_clips
    from technique_bench import licks
    real = REPO / "data" / "eval" / "real"
    gt = REPO / "data" / "eval" / "gtechs_dl" / "P3_music" / "audio" / "micamp"
    sets = {
        "idmt (val)": with_probs([(c["wav"], c["notes"]) for c in licks()]),
        "p3 (test)": with_probs([(gt / f"micamp_{i:02d}.wav",
                                  json.loads((real / f"gt-{i:02d}" / "ref.json").read_text())["tracks"][0]["notes"])
                                 for i in range(1, 13)]),
        "gs05 (test)": with_probs([(c["wav"], c["notes"]) for c in guitarset_clips("05")]),
    }
    for w in WEIGHTS:
        print(f"strnet={w:<4} " + "  ".join(f"{k} {acc(v, w):.3f}" for k, v in sets.items()), flush=True)


if __name__ == "__main__":
    main()
