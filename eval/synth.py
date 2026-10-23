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


def _guitar_tone(
    midi: float,
    dur: float,
    *,
    midi_end: float | None = None,
    vib_hz: float = 0.0,
    vib_cents: float = 0.0,
    attack: float = 0.004,
    decay: float = 2.6,
    vel: float = 0.75,
) -> np.ndarray:
    """Harmonic-partial guitar-ish tone with optional glide / vibrato (not Karplus-Strong)."""
    n = max(2, int(SR * dur))
    t = np.arange(n) / SR
    f0 = _hz(midi)
    f1 = _hz(midi if midi_end is None else midi_end)
    cents = np.linspace(0.0, 1200.0 * np.log2((f1 + 1e-9) / (f0 + 1e-9)), n)
    if vib_hz and vib_cents:
        cents = cents + vib_cents * np.sin(2 * np.pi * vib_hz * t)
    freq = f0 * (2.0 ** (cents / 1200.0))
    phase = np.cumsum(2.0 * np.pi * freq / SR)
    y = np.zeros(n, dtype=np.float64)
    for k in range(1, 7):
        inharm = 1.0 + 0.00035 * k * k
        y += (vel / k) * np.sin(k * phase * inharm)
    env = np.exp(-t * decay)
    atk = min(max(1, int(attack * SR)), n)
    env[:atk] *= np.linspace(0.0, 1.0, atk)
    fade = min(500, n // 8)
    env[-fade:] *= np.linspace(1.0, 0.0, fade)
    return y.astype(np.float32) * env.astype(np.float32)


def _place(y: np.ndarray, clip: np.ndarray, t: float) -> None:
    a = int(round(t * SR))
    b = min(len(y), a + len(clip))
    if b > a:
        y[a:b] += clip[: b - a]


def _normalize(y: np.ndarray) -> np.ndarray:
    peak = float(np.max(np.abs(y))) or 1.0
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
        {
            "id": "technique-clip",
            "title": "Guitar techniques (picked, H/P, slide, bend, vibrato)",
            "bpm": 100,
            "key": {"tonic": "A", "mode": "minor"},
            "expect_basic": "Am",
            "technique": True,
        },
    ]


def _render_technique_clip(spec: dict) -> tuple[np.ndarray, list[dict], list[dict], list[dict], float]:
    """Picked run (no techniques) then hammer, pull, slide, whole-step bend, vibrato."""
    duration = 5.7
    y = np.zeros(int(SR * duration), dtype=np.float32)
    notes_gt: list[dict] = []
    tech_events: list[dict] = []

    def add_note(start, end, midi, techniques=None, **synth):
        clip = _guitar_tone(midi, max(0.08, end - start), **synth)
        _place(y, clip, start)
        rec = {"start": round(start, 3), "end": round(end, 3), "midi": int(round(midi))}
        if techniques:
            rec["techniques"] = [{"type": t} for t in techniques]
        notes_gt.append(rec)

    # Picked A-minor pentatonic fragment — each note has a sharp attack and a gap.
    picked = [(0.06, 57), (0.36, 60), (0.66, 62), (0.96, 64)]
    for t, m in picked:
        add_note(t, t + 0.18, m, attack=0.003, vel=0.9, decay=4.5)

    # Hammer-on A3 → C4 (same string, overlapping, weak destination attack).
    add_note(1.40, 1.76, 57, techniques=["hammer"], attack=0.003, vel=0.95, decay=3.0)
    add_note(1.56, 1.92, 60, techniques=["hammer"], attack=0.08, vel=0.38, decay=2.4)
    tech_events.append({"type": "hammer", "t": 1.56, "midi": 60})

    # Pull-off E4 → D4.
    add_note(2.10, 2.46, 64, techniques=["pull"], attack=0.003, vel=0.95, decay=3.0)
    add_note(2.26, 2.62, 62, techniques=["pull"], attack=0.08, vel=0.38, decay=2.4)
    tech_events.append({"type": "pull", "t": 2.26, "midi": 62})

    # Slide C4 → E4 (4 semitones): first note glides; destination arrives softly.
    add_note(2.80, 3.22, 60, techniques=["slide"], attack=0.004, vel=0.85, decay=2.2, midi_end=64)
    add_note(3.10, 3.48, 64, techniques=["slide"], attack=0.09, vel=0.4, decay=2.6)
    tech_events.append({"type": "slide", "t": 2.80, "midi": 60})

    # Whole-step bend D4 → E (held). Fingered pitch is D4.
    add_note(3.70, 4.40, 62, techniques=["bend"], attack=0.004, vel=0.85, decay=1.6, midi_end=64)
    tech_events.append({"type": "bend", "t": 3.70, "midi": 62})

    # Vibrato on A3 (~5.5 Hz, ±48 cents) — long enough for PYIN.
    add_note(4.55, 5.50, 57, techniques=["vibrato"], attack=0.004, vel=0.85, decay=1.05,
             vib_hz=5.5, vib_cents=48)
    tech_events.append({"type": "vibrato", "t": 4.55, "midi": 57})

    chords = [{"start": 0, "end": duration, "label": "A:min"}]
    return _normalize(y), notes_gt, tech_events, chords, duration


def render_one(spec: dict, out_dir: Path) -> dict:
    bpm = spec["bpm"]
    beat = 60.0 / bpm
    events = []
    notes_gt = []
    tech_events: list[dict] = []
    clean_until = None
    if spec.get("technique"):
        y, notes_gt, tech_events, chords, duration = _render_technique_clip(spec)
        beats = [round(i * beat, 4) for i in range(int(duration / beat) + 1)]
        clean_until = 1.25
    elif spec.get("solo"):
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
        "techniques": tech_events,
        "clean_until": clean_until if clean_until is not None else (duration if spec.get("solo") else None),
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
