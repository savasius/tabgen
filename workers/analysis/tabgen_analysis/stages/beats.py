"""Beat / downbeat tracking with Beat This! (MIT code and weights). No madmom DBN."""

import hashlib
import logging
import urllib.request
from pathlib import Path

import numpy as np
import torch

from ..device import run_with_fallback

log = logging.getLogger(__name__)

MODEL_KEY = "beat_this-1.1-final0"

_CKPT_SHA256 = "8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331"
_CKPT_URLS = [
    "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt",
    # Byte-identical mirror (same sha256) for when the JKU server is down.
    "https://huggingface.co/oulianov/beat_this/resolve/main/final0.ckpt",
]


def ensure_checkpoint() -> Path:
    path = Path(torch.hub.get_dir()) / "checkpoints" / "beat_this-final0.ckpt"
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    for url in _CKPT_URLS:
        tmp = path.with_suffix(".part")
        try:
            log.info("Downloading Beat This! checkpoint from %s", url)
            urllib.request.urlretrieve(url, tmp)
            digest = hashlib.sha256(tmp.read_bytes()).hexdigest()
            if digest != _CKPT_SHA256:
                raise ValueError(f"checksum mismatch ({digest[:12]})")
            tmp.replace(path)
            return path
        except Exception as e:
            log.warning("Checkpoint download failed from %s: %s", url, e)
            tmp.unlink(missing_ok=True)
    raise RuntimeError("Could not download the Beat This! checkpoint")


def track_beats(audio_path: Path) -> dict:
    from beat_this.inference import File2Beats

    ckpt = str(ensure_checkpoint())

    def run(device: str):
        f2b = File2Beats(checkpoint_path=ckpt, device=device, dbn=False)
        return f2b(str(audio_path))

    beats, downbeats = run_with_fallback("beat_this", run)
    beats = np.asarray(beats, dtype=float)
    downbeats = np.asarray(downbeats, dtype=float)
    bpm = float(60.0 / np.median(np.diff(beats))) if len(beats) > 1 else 0.0
    return {"beats": beats.round(4).tolist(), "downbeats": downbeats.round(4).tolist(), "bpm": round(bpm, 1)}
