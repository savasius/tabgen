"""Source separation with Demucs htdemucs_6s (MIT code; weight licensing unclear, see README).

Real user uploads always run Demucs. Mix copies are never treated as guitar stems.
"""

from __future__ import annotations

import gc
import hashlib
import json
import logging
import shutil
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from .. import coreml_demucs
from ..config import SKIP_SEPARATE, demucs_device
from ..device import run_on_device

log = logging.getLogger(__name__)

MODEL_NAME = "htdemucs_6s"
SIX_STEMS = ("drums", "bass", "other", "vocals", "guitar", "piano")
DERIVED = ("other4", "harmonic")
MANIFEST = "manifest.json"
# Only a real Demucs run (or a recovered one) is reusable for user analyses.
READY_METHODS = {"demucs"}


class SeparationError(RuntimeError):
    """Demucs failed or did not produce stems. The mix must not be used as guitar."""


def stems_dir(track: Path) -> Path:
    return track / "stems" / MODEL_NAME


def read_manifest(d: Path) -> dict | None:
    p = d / MANIFEST
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text())
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def write_manifest(d: Path, method: str, **extra) -> None:
    d.mkdir(parents=True, exist_ok=True)
    payload = {"method": method, "model": MODEL_NAME, "created_at": time.time(), **extra}
    tmp = d / f"{MANIFEST}.tmp"
    tmp.write_text(json.dumps(payload))
    tmp.replace(d / MANIFEST)


def _wavs_ready(d: Path) -> bool:
    return all((d / f"{n}.wav").exists() for n in (*SIX_STEMS, *DERIVED))


def _file_digest(path: Path, limit: int = 1 << 20) -> str:
    h = hashlib.sha256()
    h.update(str(path.stat().st_size).encode())
    with open(path, "rb") as f:
        h.update(f.read(limit))
        if path.stat().st_size > limit:
            f.seek(max(0, path.stat().st_size - limit))
            h.update(f.read(limit))
    return h.hexdigest()


def is_mix_copy(stem: Path, mix: Path) -> bool:
    """True when a stem slot is a byte-for-byte (or copy-sized) clone of mix.wav."""
    if not stem.exists() or not mix.exists():
        return False
    if stem.stat().st_size != mix.stat().st_size:
        return False
    return _file_digest(stem) == _file_digest(mix)


def stems_ready(d: Path, mix: Path | None = None) -> bool:
    """Reusable isolated stems: Demucs manifest, or legacy real Demucs output (not mix copies)."""
    if not _wavs_ready(d):
        return False
    method = (read_manifest(d) or {}).get("method")
    if method in READY_METHODS:
        return True
    if method == "eval":
        # Eval/synth explicitly copied the clip into every slot because the clip IS guitar.
        return False
    # Legacy stems from before manifest.json: reuse only if guitar is not a mix clone.
    if mix is not None and (d / "guitar.wav").exists() and not is_mix_copy(d / "guitar.wav", mix):
        write_manifest(d, "demucs", recovered=True)
        log.info("recovered legacy Demucs stems at %s", d)
        return True
    return False


def fallback_from_mix(track: Path, method: str = "eval") -> Path:
    """Eval/tests only: the input clip IS the guitar, so every stem slot is the mix.

    Never used as a silent fallback for real user uploads.
    """
    d = stems_dir(track)
    d.mkdir(parents=True, exist_ok=True)
    mix = track / "mix.wav"
    for n in (*SIX_STEMS, *DERIVED):
        dest = d / f"{n}.wav"
        shutil.copyfile(mix, dest)
    write_manifest(d, method, note="input treated as guitar (TABGEN_SKIP_SEPARATE)")
    return d


def separate(track: Path) -> Path:
    """Writes the 6 stems plus two derived mixes:
    - other4.wav   = guitar + piano + other (what All-In-One expects as its 'other' stem)
    - harmonic.wav = everything except vocals and drums (NOT used for chords/tabs)

    Raises SeparationError if Demucs cannot produce a guitar stem. Does not copy the mix.
    """
    d = stems_dir(track)
    mix = track / "mix.wav"
    if SKIP_SEPARATE:
        log.info("TABGEN_SKIP_SEPARATE=1 — eval/test only; treating the input clip as guitar")
        return fallback_from_mix(track, method="eval")
    if stems_ready(d, mix):
        return d
    d.mkdir(parents=True, exist_ok=True)

    from allin1_infer.stems import _run_demucs_separation
    from demucs_infer.pretrained import get_model

    def run(device: str):
        model = get_model(MODEL_NAME).to(device).eval()
        if device == "cpu" and coreml_demucs.enabled():
            try:  # Apple GPU via Core ML, ~8x faster; same stems
                if coreml_demucs.accelerate(model, MODEL_NAME):
                    log.info("Demucs on Core ML")
            except Exception as e:  # noqa: BLE001 -- any trouble: plain PyTorch on the CPU
                log.warning("Core ML Demucs unavailable (%s); using PyTorch on the CPU", e)
                model = get_model(MODEL_NAME).to(device).eval()
        try:
            sources, sr = _run_demucs_separation(model, mix, device, overlap=0.25, fp16=False)
            return list(model.sources), sources.numpy(), sr
        finally:
            del model
            gc.collect()

    try:
        # Never attempt Demucs on MPS (PyTorch: Output channels > 65536 not supported).
        names, sources, sr = run_on_device("demucs", run, demucs_device())
    except Exception as e:
        raise SeparationError(
            "Instrument separation failed; cannot isolate a guitar stem. "
            "The mix is not used as a fallback. " + (str(e) or e.__class__.__name__)
        ) from e

    by_name = dict(zip(names, sources))
    if "guitar" not in by_name:
        raise SeparationError(
            f"Demucs model {MODEL_NAME} did not emit a guitar stem (got {list(by_name)}). "
            "The mix is not used as a fallback."
        )
    for n, wav in by_name.items():
        sf.write(d / f"{n}.wav", wav.T, sr, subtype="PCM_16")
    other4 = by_name["guitar"] + by_name["piano"] + by_name["other"]
    harmonic = other4 + by_name["bass"]
    for n, wav in (("other4", other4), ("harmonic", harmonic)):
        peak = float(np.abs(wav).max()) or 1.0
        sf.write(d / f"{n}.wav", (wav / max(peak, 1.0)).T, sr, subtype="PCM_16")
    write_manifest(d, "demucs")
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
    n = max(1, len(mono) // hop)
    frames = mono[: n * hop].reshape(n, hop)
    return np.sqrt((frames ** 2).mean(axis=1) + 1e-12), hop_s


def resolve_playback(track: Path, stem: str) -> tuple[Path, str]:
    """Locate mix/original/guitar audio for GET /v1/analyses/{id}/audio?stem=.

    Returns (path, media_type). Raises ValueError or FileNotFoundError.
    """
    kind = (stem or "mix").lower().strip()
    if kind in ("mix", "original"):
        mp3 = track / "playback.mp3"
        if mp3.exists():
            return mp3, "audio/mpeg"
        mix = track / "mix.wav"
        if mix.exists():
            return mix, "audio/wav"
        raise FileNotFoundError("Mix audio missing")
    if kind in ("guitar", "gitar"):
        # the guitar stem with its leaked low notes put back, when the analysis did that
        guitar = stems_dir(track) / "guitar_plus_bass.wav"
        if not guitar.exists():
            guitar = stems_dir(track) / "guitar.wav"
        if guitar.exists():
            return guitar, "audio/wav"
        raise FileNotFoundError("Guitar stem not available — reanalyze this song")
    raise ValueError("Unknown stem; use mix, original, or guitar")
