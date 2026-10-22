"""Section segmentation with All-In-One (all-in-one-infer fork, MIT; uses madmom-infer which ships no NC models).

Reuses our htdemucs_6s stems: other = guitar + piano + other.
"""

import tempfile
from pathlib import Path

from ..device import run_with_fallback

MODEL_KEY = "allin1-infer-3.1-harmonix-all"


def analyze_structure(stems: Path) -> dict:
    import allin1_infer
    from allin1_infer import StemsInput

    stems_input = StemsInput(
        bass=stems / "bass.wav",
        drums=stems / "drums.wav",
        other=stems / "other4.wav",
        vocals=stems / "vocals.wav",
        identifier="track",
    )

    def run(device: str):
        with tempfile.TemporaryDirectory() as tmp:
            return allin1_infer.analyze(
                stems_input=stems_input,
                model="harmonix-all",
                device=device,
                demix_dir=Path(tmp) / "demix",
                spec_dir=Path(tmp) / "spec",
                multiprocess=False,
            )

    res = run_with_fallback("allin1", run)
    return {
        "bpm": res.bpm,
        "beats": [round(float(b), 4) for b in res.beats],
        "downbeats": [round(float(b), 4) for b in res.downbeats],
        "segments": [{"start": float(s.start), "end": float(s.end), "label": s.label} for s in res.segments],
    }
