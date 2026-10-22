import os
from pathlib import Path

import torch

PIPELINE_VERSION = "p1.1-demucs6s-bt1.1-aio3.1-lvc1.1-skey"

DATA_DIR = Path(os.environ.get("TABGEN_DATA_DIR", Path(__file__).resolve().parents[3] / "data"))


def _default_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


# "auto" picks cuda > mps (Apple Silicon) > cpu. Stages that fail on a GPU backend retry on CPU.
DEVICE = os.environ.get("TABGEN_DEVICE", "auto")
if DEVICE == "auto":
    DEVICE = _default_device()

# Which signal the chord model listens to: "harmonic" = mix minus vocals and drums, "mix" = original.
CHORD_INPUT = os.environ.get("TABGEN_CHORD_INPUT", "harmonic")
CHORD_VOCAB = os.environ.get("TABGEN_CHORD_VOCAB", "submission")

MAX_DURATION_S = float(os.environ.get("TABGEN_MAX_DURATION_S", 600))

# Personal/local mode: link input via yt-dlp. Turn off for any public deployment (see README).
URL_INGEST_ENABLED = os.environ.get("TABGEN_URL_INGEST", "1") == "1"


def track_dir(audio_hash: str) -> Path:
    d = DATA_DIR / "tracks" / audio_hash
    d.mkdir(parents=True, exist_ok=True)
    return d
