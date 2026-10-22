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


RECOGNIZERS = {"lv-chordia": LvChordiaRecognizer}


def get_recognizer(name: str = "lv-chordia") -> ChordRecognizer:
    return RECOGNIZERS[name]()


def recognize(audio_path: Path, recognizer: ChordRecognizer) -> list[dict]:
    return [asdict(s) for s in recognizer.recognize(audio_path)]
