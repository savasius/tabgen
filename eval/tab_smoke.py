"""Transcribe a synth solo with Basic Pitch + Viterbi (no Demucs) and print onset F1."""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(REPO / "workers" / "analysis"))
sys.path.insert(0, str(HERE))

from score import tab_f1  # noqa: E402
from synth import render_one, songs  # noqa: E402
from tabgen_analysis.fingering import STANDARD_TUNING, assign_notes  # noqa: E402
from tabgen_analysis.stages.transcribe import transcribe  # noqa: E402


def main() -> None:
    spec = next(s for s in songs() if s.get("solo"))
    ref = render_one(spec, REPO / "data" / "eval")
    raw = transcribe(Path(ref["wav"]), list(STANDARD_TUNING))
    assigned = assign_notes(raw["notes"])
    playable = [n for n in assigned if n.get("string") is not None]
    scores = tab_f1(playable, ref["notes"])
    print(json.dumps({
        "clip": spec["id"],
        "basic_pitch_notes": raw["n_notes"],
        "assigned": len(playable),
        "tabcnn": raw.get("tabcnn"),
        **scores,
    }, indent=2))
    if scores["f1"] < 0.4:
        sys.exit(2)


if __name__ == "__main__":
    main()
