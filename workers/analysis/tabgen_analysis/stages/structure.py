"""Section segmentation with All-In-One (all-in-one-infer fork, MIT; uses madmom-infer which ships no NC models).

Reuses our htdemucs_6s stems: other = guitar + piano + other.
"""

import tempfile
from pathlib import Path

from ..device import run_with_fallback

MODEL_KEY = "allin1-infer-3.1-harmonix-all"


_models: dict = {}


def _keep_models_loaded() -> None:
    """The 8-model ensemble took ~3 s to load (and a Hugging Face check) for every song; the
    server keeps it after the first one."""
    import importlib
    aio = importlib.import_module("allin1_infer.analyze")  # the module (the package exports a function of that name)
    if getattr(aio.load_pretrained_model, "_tabgen_cached", False):
        return
    load = aio.load_pretrained_model

    def cached(*args, **kwargs):
        key = (args, tuple(sorted((k, str(v)) for k, v in kwargs.items())))
        if key not in _models:
            _models[key] = load(*args, **kwargs)
        return _models[key]
    cached._tabgen_cached = True
    aio.load_pretrained_model = cached


def analyze_structure(stems: Path) -> dict:
    import allin1_infer
    from allin1_infer import StemsInput

    from .. import fast_hmm
    fast_hmm.install()  # same beat/downbeat decoding, compiled (~14 s -> <1 s on a 2:22 song)
    _keep_models_loaded()

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
