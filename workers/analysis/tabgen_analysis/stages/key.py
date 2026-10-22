"""Global key with S-KEY (Deezer, MIT) and tuning offset with librosa (ISC)."""

from pathlib import Path

import librosa
import numpy as np
import torch

from ..device import run_with_fallback

MODEL_KEY = "skey-0.1-top2"

# Order of S-KEY's 24 outputs (skey.key_detection.key_map), as (tonic, mode).
_KEYS = [(t, "major") for t in ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]] + \
        [(t, "minor") for t in ["B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#"]]


def detect_key(audio_path: Path) -> dict:
    from skey.key_detection import load_checkpoint, load_model_components

    ckpt = load_checkpoint(None)
    sr = ckpt["audio"]["sr"]
    # Same preprocessing as skey.load_audio (mono, peak-normalized), without torchaudio's torchcodec dependency.
    y, _ = librosa.load(str(audio_path), sr=sr, mono=True)
    y = y / (np.abs(y).max() or 1.0)

    def run(device: str):
        d = torch.device(device)
        hcqt, chromanet, crop_fn = load_model_components(ckpt, d)
        audio = torch.from_numpy(y).float().unsqueeze(0).to(d)
        with torch.no_grad():
            cropped = crop_fn(hcqt(audio.unsqueeze(0)), torch.zeros(1).to(d))
            probs = chromanet(cropped).mean(dim=0)
        return probs.cpu().numpy()

    probs = run_with_fallback("s-key", run)
    order = np.argsort(-probs)
    i = int(order[0])
    j = int(order[1]) if len(order) > 1 else i
    tonic, mode = _KEYS[i]
    alt_tonic, alt_mode = _KEYS[j]
    return {
        "tonic": tonic, "mode": mode, "confidence": round(float(probs[i]), 3),
        "alt_tonic": alt_tonic, "alt_mode": alt_mode,
        "alt_confidence": round(float(probs[j]), 3),
    }


def estimate_tuning(audio_path: Path) -> dict:
    y, sr = librosa.load(str(audio_path), sr=22050, mono=True, duration=120)
    frac = float(librosa.estimate_tuning(y=y, sr=sr))  # fraction of a semitone
    cents = round(frac * 100)
    return {"a4_hz": round(440.0 * 2 ** (frac / 12), 1), "cents": cents,
            "guess": "standard" if abs(cents) <= 25 else "detuned"}
