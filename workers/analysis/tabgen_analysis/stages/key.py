"""Global key from key profiles (published numbers, no trained model) and tuning offset with librosa (ISC).

S-KEY (Deezer) was used until p2.8; its code is MIT but its weights are "non-commercial research
only", so it can't ship in a product. The profile finder below, fed with the transcribed notes and
checked against the chord track (post.reconcile_relative_key), scores better on GuitarSet anyway
(eval/key_bench.py: 0.58 exact vs 0.55). detect_key (S-KEY) stays for comparison in eval only.
"""

from pathlib import Path

import librosa
import numpy as np
import torch

from ..device import run_with_fallback

MODEL_KEY = "keyprofile-notes-1"

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


# Key profiles (Temperley 1999 "Kostka-Payne"; Krumhansl-Kessler 1982 as a cross-check). Published
# numbers, not a trained model: the license-clean key finder for the product build (S-KEY's weights
# are "non-commercial research only").
_PROFILES = {
    "temperley": ([5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0],
                  [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0]),
    "krumhansl": ([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
                  [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]),
}
_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
PROFILE_MODEL_KEY = "keyprofile-1"


def _best_key(prof: np.ndarray, profile: str = "temperley", source: str = "profile") -> dict:
    maj, mnr = (np.array(p, float) for p in _PROFILES[profile])
    scores = []
    for mode, base in (("major", maj), ("minor", mnr)):
        for t in range(12):
            scores.append((float(np.corrcoef(prof, np.roll(base, t))[0, 1]), _NAMES[t], mode))
    scores.sort(reverse=True)
    (c1, t1, m1), (c2, t2, m2) = scores[0], scores[1]
    return {"tonic": t1, "mode": m1, "confidence": round(max(0.0, c1), 3),
            "alt_tonic": t2, "alt_mode": m2, "alt_confidence": round(max(0.0, c2), 3), "source": source}


def detect_key_profile(audio_path: Path, profile: str = "temperley") -> dict:
    """Global key from the guitar stem's average chroma against major/minor key profiles."""
    y, sr = librosa.load(str(audio_path), sr=22050, mono=True)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=2048)
    rms = librosa.feature.rms(y=y, hop_length=2048)[0][: chroma.shape[1]]
    w = rms / (rms.sum() or 1.0)
    return _best_key((chroma[:, : len(w)] * w).sum(axis=1), profile, "chroma")


MIN_NOTES = 20


def detect_key_notes(notes: list[dict], audio_path: Path | None = None) -> dict:
    """Key from the transcribed notes (pitch classes weighted by length x loudness); the audio
    chroma when there are too few notes to trust."""
    if len(notes) < MIN_NOTES and audio_path is not None:
        return detect_key_profile(audio_path)
    prof = np.zeros(12)
    for n in notes:
        prof[int(n["midi"]) % 12] += max(0.05, float(n["end"]) - float(n["start"])) * float(n.get("velocity") or 0.5)
    return _best_key(prof, source="notes")


def estimate_tuning(audio_path: Path) -> dict:
    y, sr = librosa.load(str(audio_path), sr=22050, mono=True, duration=120)
    frac = float(librosa.estimate_tuning(y=y, sr=sr))  # fraction of a semitone
    cents = round(frac * 100)
    return {"a4_hz": round(440.0 * 2 ** (frac / 12), 1), "cents": cents,
            "guess": "standard" if abs(cents) <= 25 else "detuned"}
