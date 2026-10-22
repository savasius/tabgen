"""Harte chord label parsing and simplification (mirrors apps/web/src/music/chords.ts)."""

from dataclasses import dataclass

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_ALIASES = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B", "Fb": "E", "E#": "F", "B#": "C"}
_INTERVALS = {"1": 0, "b2": 1, "2": 2, "b3": 3, "3": 4, "4": 5, "b5": 6, "#4": 6, "5": 7, "#5": 8, "b6": 8,
              "6": 9, "bb7": 9, "b7": 10, "7": 11, "9": 2, "b9": 1, "11": 5, "#11": 6, "13": 9}

# quality -> (normal-level quality, basic-level quality)
_SIMPLIFY = {
    "maj": ("maj", "maj"), "min": ("min", "min"),
    "7": ("7", "maj"), "maj7": ("maj7", "maj"), "min7": ("min7", "min"),
    "dim": ("dim", "min"), "aug": ("aug", "maj"), "dim7": ("dim7", "min"), "hdim7": ("hdim7", "min"),
    "sus2": ("sus2", "maj"), "sus4": ("sus4", "maj"), "sus4(b7)": ("7sus4", "maj"), "7sus4": ("7sus4", "maj"),
    "9": ("7", "maj"), "maj9": ("maj7", "maj"), "min9": ("min7", "min"), "11": ("7", "maj"), "13": ("7", "maj"),
    "maj6": ("maj6", "maj"), "min6": ("min6", "min"), "minmaj7": ("min", "min"), "5": ("5", "5"),
    "1": ("5", "5"),
}


def pc(note: str) -> int:
    note = _ALIASES.get(note, note)
    return NOTES.index(note)


@dataclass(frozen=True)
class Chord:
    root: str | None  # None = no chord
    quality: str = "maj"
    bass_interval: str | None = None

    @property
    def is_none(self) -> bool:
        return self.root is None

    @property
    def bass(self) -> str | None:
        if self.root is None or not self.bass_interval:
            return None
        semis = _INTERVALS.get(self.bass_interval)
        return None if semis is None else NOTES[(pc(self.root) + semis) % 12]

    def harte(self, quality: str | None = None, with_bass: bool = True) -> str:
        if self.root is None:
            return "N"
        s = f"{self.root}:{quality or self.quality}"
        if with_bass and self.bass_interval and quality is None:
            s += f"/{self.bass_interval}"
        return s

    def level(self, level: str) -> str:
        """level: 'full' | 'normal' | 'basic' -> Harte label."""
        if self.root is None:
            return "N"
        if level == "full":
            return self.harte()
        normal, basic = _SIMPLIFY.get(self.quality, ("maj", "maj"))
        return self.harte(normal if level == "normal" else basic, with_bass=False)


def parse(label: str) -> Chord:
    if label in ("N", "X", "") or label is None:
        return Chord(None)
    root, _, rest = label.partition(":")
    quality, _, bass = (rest or "maj").partition("/")
    root = _ALIASES.get(root, root)
    if root not in NOTES:
        return Chord(None)
    return Chord(root, quality or "maj", bass or None)
