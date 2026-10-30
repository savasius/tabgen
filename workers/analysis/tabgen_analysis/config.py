import os
from pathlib import Path

import torch

# p2.3: chords + key + tabs always on the isolated guitar stem (never mix / harmonic).
# p2.4: global Viterbi fingering, split-bend merge, stricter legato, export keeps every onset,
#       per-bar tempo in alphaTex (tab synth follows the recording).
PIPELINE_VERSION = "p2.8-bp7-fing3-basslk1-tempo2-parts1-tabv3-guitarstem-bt1.1-aio3.1-lvc1.1-skey-bp-tabcnn"

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

# Chord/key/tab audio is always the isolated guitar stem (see pick_guitar_source).
# TABGEN_CHORD_INPUT is ignored for routing; kept so old env files do not crash.
CHORD_INPUT = os.environ.get("TABGEN_CHORD_INPUT", "guitar")
CHORD_VOCAB = os.environ.get("TABGEN_CHORD_VOCAB", "submission")

MAX_DURATION_S = float(os.environ.get("TABGEN_MAX_DURATION_S", 600))

# Personal/local mode: link input via yt-dlp. Turn off for any public deployment (see README).
URL_INGEST_ENABLED = os.environ.get("TABGEN_URL_INGEST", "1") == "1"

# Eval/tests only: the clip already IS guitar. Real user uploads must never set this.
SKIP_SEPARATE = os.environ.get("TABGEN_SKIP_SEPARATE", "0") == "1"


def demucs_device() -> str:
    """Demucs on Apple MPS hits 'Output channels > 65536 not supported'. Always CPU there."""
    if DEVICE == "mps":
        return "cpu"
    return DEVICE


def _timeout(name: str, default: int) -> int:
    return int(os.environ.get(f"TABGEN_TIMEOUT_{name.upper()}", default))


# Generous per-stage caps so a hung model fails the stage instead of the whole Mac sitting forever.
STAGE_TIMEOUTS = {
    "separate": _timeout("separate", 600),
    "beats": _timeout("beats", 180),
    "sections": _timeout("sections", 300),
    "chords": _timeout("chords", 300),
    "key": _timeout("key", 120),
    "transcribe": _timeout("transcribe", 300),
    "tab": _timeout("tab", 180),
}


def track_dir(audio_hash: str) -> Path:
    d = DATA_DIR / "tracks" / audio_hash
    d.mkdir(parents=True, exist_ok=True)
    return d


def models_dir() -> Path:
    d = DATA_DIR / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d
