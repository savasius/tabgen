"""Chord recognition behind a swappable interface.

Default: lv-chordia (ISMIR 2019 large-vocabulary model, MIT code+weights; trained on
annotation sets with non-commercial terms — see README licenses). To add another
backend, implement ChordRecognizer and register it in RECOGNIZERS.
"""

import contextlib
import io
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from ..config import CHORD_VOCAB


@dataclass
class ChordSegment:
    start: float
    end: float
    label: str  # Harte-style, e.g. "A:min7", "C:maj/3", "N" for no chord
    confidence: float | None = None


class ChordRecognizer(Protocol):
    key: str  # cache key; change it when the model or its settings change

    def recognize(self, audio_path: Path) -> list[ChordSegment]: ...


class LvChordiaRecognizer:
    def __init__(self, vocab: str = CHORD_VOCAB):
        self.vocab = vocab
        self.key = f"lv-chordia-1.1-{vocab}"

    def recognize(self, audio_path: Path) -> list[ChordSegment]:
        from lv_chordia import chord_recognition

        with contextlib.redirect_stdout(io.StringIO()):
            segs = chord_recognition(str(audio_path), self.vocab)
        return [ChordSegment(float(s["start_time"]), float(s["end_time"]), s["chord"]) for s in segs]


class TemplateRecognizer:
    """No trained model: major/minor triad templates against the guitar's chroma, smoothed by a
    Viterbi over chords that prefers staying put. The license-free fallback (eval/chord_bench.py)."""

    STAY = 0.92  # probability of keeping the chord from one ~93 ms frame to the next

    def __init__(self):
        self.key = "template-majmin-1"

    def recognize(self, audio_path: Path) -> list[ChordSegment]:
        import librosa
        import numpy as np

        y, sr = librosa.load(str(audio_path), sr=22050, mono=True)
        hop = 2048
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
        rms = librosa.feature.rms(y=y, hop_length=hop)[0][: chroma.shape[1]]
        names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        labels, temps = [], []
        for q, iv in (("maj", (0, 4, 7)), ("min", (0, 3, 7))):
            for r in range(12):
                t = np.zeros(12)
                t[[(r + i) % 12 for i in iv]] = 1.0
                t[r] = 1.3  # the root sounds most on a guitar (bass string)
                temps.append(t / np.linalg.norm(t))
                labels.append(f"{names[r]}:{q}")
        T = np.array(temps)
        c = chroma / (np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-9)
        sim = T @ c                                   # (24, frames) cosine
        quiet = rms < 0.1 * (np.median(rms[rms > 0]) if np.any(rms > 0) else 1)
        emis = np.vstack([np.exp(8 * sim), np.where(quiet, 1.0, 1e-3)[None, :]])  # last row: N
        labels.append("N")
        n, frames = emis.shape
        logA = np.full((n, n), np.log((1 - self.STAY) / (n - 1)))
        np.fill_diagonal(logA, np.log(self.STAY))
        loge = np.log(emis / emis.sum(axis=0, keepdims=True) + 1e-12)
        delta = loge[:, 0].copy()
        back = np.zeros((frames, n), dtype=np.int32)
        for f in range(1, frames):
            m = delta[:, None] + logA
            back[f] = np.argmax(m, axis=0)
            delta = m[back[f], np.arange(n)] + loge[:, f]
        path = np.empty(frames, dtype=np.int32)
        path[-1] = int(np.argmax(delta))
        for f in range(frames - 1, 0, -1):
            path[f - 1] = back[f, path[f]]
        times = librosa.frames_to_time(np.arange(frames + 1), sr=sr, hop_length=hop)
        segs: list[ChordSegment] = []
        for f, k in enumerate(path):
            if segs and segs[-1].label == labels[k]:
                segs[-1].end = float(times[f + 1])
            else:
                segs.append(ChordSegment(float(times[f]), float(times[f + 1]), labels[k]))
        return segs


RECOGNIZERS = {"lv-chordia": LvChordiaRecognizer, "template": TemplateRecognizer}


def get_recognizer(name: str = "lv-chordia") -> ChordRecognizer:
    return RECOGNIZERS[name]()


def recognize(audio_path: Path, recognizer: ChordRecognizer) -> list[dict]:
    return [asdict(s) for s in recognizer.recognize(audio_path)]
