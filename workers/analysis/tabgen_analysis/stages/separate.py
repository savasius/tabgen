"""Source separation with Demucs htdemucs_6s (MIT code; weight licensing unclear, see README)."""

import gc
import logging
import shutil
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from ..config import SKIP_SEPARATE, demucs_device
from ..device import run_on_device

log = logging.getLogger(__name__)

MODEL_NAME = "htdemucs_6s"
SIX_STEMS = ("drums", "bass", "other", "vocals", "guitar", "piano")


def stems_dir(track: Path) -> Path:
    return track / "stems" / MODEL_NAME


def _derived_ready(d: Path) -> bool:
    return all((d / f"{n}.wav").exists() for n in (*SIX_STEMS, "other4", "harmonic"))


def fallback_from_mix(track: Path) -> Path:
    """Copy mix.wav into every stem slot so later stages can still run (chords + tab on the mix)."""
    d = stems_dir(track)
    d.mkdir(parents=True, exist_ok=True)
    mix = track / "mix.wav"
    for n in (*SIX_STEMS, "other4", "harmonic"):
        dest = d / f"{n}.wav"
        if not dest.exists():
            shutil.copyfile(mix, dest)
    return d


def separate(track: Path) -> Path:
    """Writes the 6 stems plus two derived mixes:
    - other4.wav   = guitar + piano + other (what All-In-One expects as its 'other' stem)
    - harmonic.wav = everything except vocals and drums (chord model input)
    """
    d = stems_dir(track)
    if _derived_ready(d):
        return d
    if SKIP_SEPARATE:
        log.info("TABGEN_SKIP_SEPARATE=1 — using mix as all stems")
        return fallback_from_mix(track)
    d.mkdir(parents=True, exist_ok=True)

    from allin1_infer.stems import _run_demucs_separation
    from demucs_infer.pretrained import get_model

    def run(device: str):
        model = get_model(MODEL_NAME).to(device).eval()
        try:
            sources, sr = _run_demucs_separation(model, track / "mix.wav", device, overlap=0.25, fp16=False)
            return list(model.sources), sources.numpy(), sr
        finally:
            del model
            gc.collect()

    # Never attempt Demucs on MPS (PyTorch: Output channels > 65536 not supported).
    names, sources, sr = run_on_device("demucs", run, demucs_device())
    by_name = dict(zip(names, sources))
    for n, wav in by_name.items():
        sf.write(d / f"{n}.wav", wav.T, sr, subtype="PCM_16")
    other4 = by_name["guitar"] + by_name["piano"] + by_name["other"]
    harmonic = other4 + by_name["bass"]
    for n, wav in (("other4", other4), ("harmonic", harmonic)):
        peak = float(np.abs(wav).max()) or 1.0
        sf.write(d / f"{n}.wav", (wav / max(peak, 1.0)).T, sr, subtype="PCM_16")
    del sources, by_name
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return d


def stem_energy(d: Path, name: str, hop_s: float = 0.5) -> tuple[np.ndarray, float]:
    """RMS envelope of a stem (mono), used for vocal-presence / solo heuristics."""
    wav, sr = sf.read(d / f"{name}.wav", dtype="float32")
    mono = wav.mean(axis=1) if wav.ndim == 2 else wav
    hop = int(sr * hop_s)
    n = len(mono) // hop
    frames = mono[: n * hop].reshape(n, hop)
    return np.sqrt((frames ** 2).mean(axis=1) + 1e-12), hop_s
