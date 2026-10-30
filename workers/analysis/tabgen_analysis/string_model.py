"""Which string is a note on? A small CNN that listens to the note's overtones.

The same pitch sounds different on a thick string high up the neck than on a thin string low down
(stiffer, darker, faster-decaying partials). The model sees the note's first ~200 ms as a constant-Q
patch aligned to its own pitch, plus the pitch, and outputs a probability per string; impossible
strings (the pitch isn't on them) are masked. Trained only on CC BY data (Guitar-TECHS players 1-2,
GuitarSet players 00-04) by eval/strings/train.py; the fingering Viterbi uses it like TabCNN's prior.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

SR = 44100
HOP = 512                      # 11.6 ms
BPO = 24                       # quarter tones
MIDI_LO = 28                   # an octave under low E
N_BINS = (132 - MIDI_LO) * 2   # up to ~13 kHz
PATCH_BINS = 108               # an octave below f0 .. three and a half above (E6 + 3.5 oct < 13 kHz)
PRE, POST = 2, 16              # frames around the onset (~23 ms before, ~185 ms after)
OPEN = (40, 45, 50, 55, 59, 64)
MAX_FRET = 22


def feasible(midi: int) -> np.ndarray:
    return np.array([0 <= midi - o <= MAX_FRET for o in OPEN])


def _cqt_db(audio_path: Path) -> np.ndarray:
    import librosa
    y, _ = librosa.load(str(audio_path), sr=SR, mono=True)
    c = np.abs(librosa.cqt(y, sr=SR, hop_length=HOP, fmin=librosa.midi_to_hz(MIDI_LO),
                           n_bins=N_BINS, bins_per_octave=BPO))
    return 20 * np.log10(c + 1e-6)


def note_patches(audio_path: Path, notes: list[dict], cqt: np.ndarray | None = None) -> tuple[np.ndarray, list[int]]:
    """(N, PATCH_BINS, PRE+POST) patches for the notes that fit, and their indices in `notes`."""
    c = _cqt_db(audio_path) if cqt is None else cqt
    out, keep = [], []
    for i, n in enumerate(notes):
        b0 = (int(n["midi"]) - 12 - MIDI_LO) * 2
        f0 = int(round(float(n["start"]) * SR / HOP)) - PRE
        if b0 < 0 or b0 + PATCH_BINS > c.shape[0] or f0 < 0 or f0 + PRE + POST > c.shape[1]:
            continue
        p = c[b0:b0 + PATCH_BINS, f0:f0 + PRE + POST]
        p = np.clip(p - p.max(), -80, 0) / 80 + 1  # 0 (silence) .. 1 (loudest), level-independent
        out.append(p.astype(np.float32))
        keep.append(i)
    return (np.stack(out) if out else np.zeros((0, PATCH_BINS, PRE + POST), np.float32)), keep


def build_model():
    import torch
    from torch import nn

    class StringNet(nn.Module):
        def __init__(self):
            super().__init__()
            def block(i, o):
                return nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU(),
                                     nn.Conv2d(o, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU())
            self.conv = nn.Sequential(block(1, 24), nn.MaxPool2d((2, 2)), block(24, 48), nn.MaxPool2d((2, 2)),
                                      block(48, 96), nn.AdaptiveAvgPool2d((9, 1)))  # 108 bins / 4 = 27 = 9 bands of 3
            self.pitch = nn.Embedding(128, 16)
            self.head = nn.Sequential(nn.Dropout(0.3), nn.Linear(96 * 9 + 16, 128), nn.ReLU(), nn.Linear(128, 6))

        def forward(self, x, midi, mask):
            h = self.conv(x.unsqueeze(1)).flatten(1)
            logits = self.head(torch.cat([h, self.pitch(midi)], 1))
            return logits.masked_fill(~mask, -1e4)

    return StringNet()


_model = None


def model_path() -> Path:
    # shipped with the code (~1 MB): trained only on CC BY 4.0 data, see docs/LISANS_DENETIMI.md
    return Path(__file__).resolve().parent / "weights" / "string-net-v1.pt"


def available() -> bool:
    return model_path().exists()


def string_probs(audio_path: Path, notes: list[dict]) -> dict[int, list[float]]:
    """note index -> 6 string probabilities (low E first), for the notes the model could hear."""
    global _model
    import torch
    if not available():
        return {}
    if _model is None:
        m = build_model()
        m.load_state_dict(torch.load(model_path(), map_location="cpu"))
        _model = m.eval()
    x, keep = note_patches(audio_path, notes)
    if not keep:
        return {}
    midi = torch.tensor([int(notes[i]["midi"]) for i in keep])
    mask = torch.tensor(np.stack([feasible(int(notes[i]["midi"])) for i in keep]))
    with torch.no_grad():
        p = torch.softmax(_model(torch.from_numpy(x), midi, mask), 1).numpy()
    return {i: [round(float(v), 4) for v in row] for i, row in zip(keep, p)}
