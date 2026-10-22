"""Synthesize short, rights-free guitar-like clips with known chords/notes for eval.

Audio is written under data/eval/ (gitignored). Ground truth JSON is eval/refs/.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 22050
ROOT = Path(__file__).resolve().parent
REFS = ROOT / "refs"


def _pluck(freq: float, dur: float, decay: float = 0.988) -> np.ndarray:
    n = max(2, int(SR / freq))
    buf = np.random.uniform(-1, 1, n).astype(np.float64)
    out = np.zeros(int(SR * dur), dtype=np.float64)
    for i in range(len(out)):
        out[i] = buf[i % n]
        buf[i % n] = decay * 0.5 * (buf[i % n] + buf[(i + 1) % n])
    # light fade
    fade = min(1000, len(out) // 8)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out


def _mix(partials: list[tuple[float, float]], dur: float) -> np.ndarray:
    y = np.zeros(int(SR * dur), dtype=np.float64)
    for freq, amp in partials:
        p = _pluck(freq, dur)
        y[: len(p)] += amp * p[: len(y)]
    peak = np.max(np.abs(y)) or 1.0
    return (0.7 * y / peak).astype(np.float32)


def _hz(midi: int) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def _chord_tones(root_midi: int, quality: str) -> list[int]:
    if quality == "5":
        return [root_midi, root_midi + 7]
    if quality == "min":
        return [root_midi, root_midi + 3, root_midi + 7]
    return [root_midi, root_midi + 4, root_midi + 7]


def _render_grid(events: list[tuple[float, float, list[int]]], duration: float) -> np.ndarray:
    y = np.zeros(int(SR * duration), dtype=np.float32)
    for start, end, midis in events:
        dur = max(0.08, end - start)
        partials = [(_hz(m), 0.7 / max(1, len(midis)) * (0.85 if i else 1.0)) for i, m in enumerate(midis)]
        clip = _mix(partials, dur)
        a = int(start * SR)
        b = min(len(y), a + len(clip))
        y[a:b] += clip[: b - a]
    peak = np.max(np.abs(y)) or 1.0
    return (0.9 * y / peak).astype(np.float32)


def songs() -> list[dict]:
    """Musical patterns, not named commercial tracks."""
    return [
        {
            "id": "major-loop",
            "title": "Major I–V–vi–IV loop",
            "bpm": 100,
            "key": {"tonic": "B", "mode": "major"},
            "expect_basic": "B F# G#m E",
            "bars": 8,
            "pattern": [("B", "maj", 47), ("F#", "maj", 42), ("G#", "min", 44), ("E", "maj", 40)],
        },
        {
            "id": "power-riff",
            "title": "Power-chord riff (no third)",
            "bpm": 115,
            "key": {"tonic": "F", "mode": "minor"},
            "expect_basic": "F5 Bb5 Ab5 Db5",
            "bars": 8,
            "pattern": [("F", "5", 41), ("A#", "5", 46), ("G#", "5", 44), ("C#", "5", 49)],
        },
        {
            "id": "relative-home",
            "title": "Relative-minor home chord first",
            "bpm": 88,
            "key": {"tonic": "F#", "mode": "minor"},
            "expect_basic": "F#m A E B",
            "bars": 8,
            "pattern": [("F#", "min", 42), ("A", "maj", 45), ("E", "maj", 40), ("B", "maj", 47)],
        },
        {
            "id": "pentatonic-solo",
            "title": "Clear A-minor pentatonic solo",
            "bpm": 100,
            "key": {"tonic": "A", "mode": "minor"},
            "expect_basic": "Am",
            "solo": True,
            "midis": [57, 60, 62, 64, 67, 69, 67, 64, 62, 60, 57, 55, 57, 60, 64, 69],
        },
    ]


def render_one(spec: dict, out_dir: Path) -> dict:
    bpm = spec["bpm"]
    beat = 60.0 / bpm
    events = []
    notes_gt = []
    if spec.get("solo"):
        duration = len(spec["midis"]) * beat * 0.5 + 0.3
        t = 0.05
        for m in spec["midis"]:
            events.append((t, t + beat * 0.45, [m]))
            notes_gt.append({"start": round(t, 3), "end": round(t + beat * 0.45, 3), "midi": m})
            t += beat * 0.5
        y = _render_grid(events, duration)
        chords = [{"start": 0, "end": duration, "label": "A:min"}]
        beats = [round(i * beat, 4) for i in range(int(duration / beat) + 1)]
    else:
        pattern = spec["pattern"]
        bars = spec["bars"]
        beats_per_chord = 2
        duration = bars * 4 * beat + 0.2
        t = 0.0
        chords = []
        for bar in range(bars):
            root, qual, midi = pattern[bar % len(pattern)]
            start = t
            end = t + beats_per_chord * beat * 2  # 4 beats
            tones = _chord_tones(midi, qual)
            # two strums per bar
            events.append((start, start + beat * 1.6, tones))
            events.append((start + 2 * beat, end - 0.05, tones))
            lab = f"{root}:{'5' if qual == '5' else qual}"
            chords.append({"start": round(start, 3), "end": round(end, 3), "label": lab})
            t = end
        y = _render_grid(events, duration)
        beats = [round(i * beat, 4) for i in range(int(duration / beat) + 1)]
        for e_start, e_end, midis in events:
            for m in midis:
                notes_gt.append({"start": round(e_start, 3), "end": round(e_end, 3), "midi": m})

    out_dir.mkdir(parents=True, exist_ok=True)
    wav = out_dir / f"{spec['id']}.wav"
    sf.write(wav, y, SR)
    ref = {
        "id": spec["id"],
        "title": spec["title"],
        "wav": str(wav),
        "bpm": bpm,
        "key": spec["key"],
        "expect_basic": spec["expect_basic"],
        "chords": chords,
        "beats": beats,
        "notes": notes_gt,
        "duration": round(len(y) / SR, 3),
    }
    REFS.mkdir(parents=True, exist_ok=True)
    (REFS / f"{spec['id']}.json").write_text(json.dumps(ref, indent=2))
    return ref


def main() -> None:
    np.random.seed(0)
    out = Path(ROOT).parents[0] / "data" / "eval"
    refs = [render_one(s, out) for s in songs()]
    print("wrote", len(refs), "clips →", out)
    for r in refs:
        print(f"  {r['id']}: {r['duration']}s  {r['expect_basic']}")


if __name__ == "__main__":
    main()
