from pathlib import Path

import numpy as np
import soundfile as sf

from tabgen_analysis.techniques import annotate, classify_contour

SR = 22050


def _tone(midi, dur, *, attack=0.004, vel=0.8, midi_end=None, vib_hz=0.0, vib_cents=0.0):
    n = max(2, int(SR * dur))
    t = np.arange(n) / SR
    f0 = 440.0 * 2 ** ((midi - 69) / 12)
    f1 = 440.0 * 2 ** (((midi_end if midi_end is not None else midi) - 69) / 12)
    cents = np.linspace(0.0, 1200.0 * np.log2((f1 + 1e-9) / (f0 + 1e-9)), n)
    if vib_hz and vib_cents:
        cents = cents + vib_cents * np.sin(2 * np.pi * vib_hz * t)
    freq = f0 * (2.0 ** (cents / 1200.0))
    phase = np.cumsum(2 * np.pi * freq / SR)
    y = vel * (np.sin(phase) + 0.4 * np.sin(2 * phase) + 0.2 * np.sin(3 * phase))
    env = np.exp(-t * 2.4)
    atk = min(max(1, int(attack * SR)), n)
    env[:atk] *= np.linspace(0.0, 1.0, atk)
    return (y * env).astype(np.float32)


def _write(path: Path, clips: list[tuple[float, np.ndarray]], duration: float) -> Path:
    y = np.zeros(int(SR * duration), dtype=np.float32)
    for t, clip in clips:
        a = int(t * SR)
        b = min(len(y), a + len(clip))
        y[a:b] += clip[: b - a]
    peak = float(np.max(np.abs(y))) or 1.0
    sf.write(path, (0.85 * y / peak).astype(np.float32), SR)
    return path


def test_rising_contour_is_a_bend():
    # 1/3-semitone bins: +3 bins = 100 cents.
    bends = [0, 0, 1, 2, 3, 3, 3, 3]
    tags = classify_contour(bends, 0.4)
    kinds = {t["type"] for t in tags}
    assert "bend" in kinds
    bend = next(t for t in tags if t["type"] == "bend")
    assert bend.get("cents", 0) >= 70
    assert 0.25 <= bend["confidence"] <= 0.98
    assert bend["source"] == "contour"


def test_flat_contour_is_not_a_bend():
    assert classify_contour([0, 0, 0, 1, 0, 0, 0, 0], 0.3) == []


def test_oscillation_is_vibrato():
    # ~6 Hz wobble of ±40 cents over 1s. bins of 1/3 semitone (~33 cents).
    seq = []
    for _ in range(6):
        seq.extend([1, 1, 0, -1, -1, 0])
    tags = classify_contour(seq, 1.0)
    vib = next(t for t in tags if t["type"] == "vibrato")
    assert vib["source"] == "contour"
    assert vib["confidence"] >= 0.35


def test_weak_onset_is_hammer():
    notes = [
        {"start": 0.00, "end": 0.20, "midi": 64, "string": 1, "fret": 5,
         "velocity": 0.8, "onset_ratio": 3.2, "bends": None},
        {"start": 0.18, "end": 0.40, "midi": 65, "string": 1, "fret": 6,
         "velocity": 0.5, "onset_ratio": 1.1, "bends": None},
    ]
    annotate(notes)
    hammer = next(t for t in notes[0]["techniques"] if t["type"] == "hammer")
    assert hammer["source"] == "legato"
    assert hammer["confidence"] >= 0.5


def test_picked_scale_is_not_legato():
    notes = []
    for i, (midi, fret) in enumerate([(64, 5), (65, 6), (67, 8), (69, 10)]):
        notes.append({
            "start": i * 0.25, "end": i * 0.25 + 0.18, "midi": midi, "string": 1, "fret": fret,
            "velocity": 0.8, "onset_ratio": 3.5, "bends": None,
        })
    annotate(notes)
    kinds = {t["type"] for n in notes for t in n["techniques"]}
    assert "hammer" not in kinds
    assert "pull" not in kinds
    assert "slide" not in kinds


def test_timing_fallback_hammer_when_no_audio():
    notes = [
        {"start": 0.00, "end": 0.20, "midi": 64, "string": 1, "fret": 5,
         "velocity": 0.8, "confidence": 0.8, "bends": None},
        {"start": 0.22, "end": 0.40, "midi": 65, "string": 1, "fret": 6,
         "velocity": 0.5, "confidence": 0.7, "bends": None},
    ]
    annotate(notes)
    kinds = {t["type"] for t in notes[0]["techniques"]}
    assert "hammer" in kinds
    assert all(t.get("source") == "timing" for t in notes[0]["techniques"] if t["type"] == "hammer")


def test_no_slide_on_picked_jump_without_contour():
    notes = [
        {"start": 0.00, "end": 0.20, "midi": 64, "string": 1, "fret": 5,
         "velocity": 0.6, "onset_ratio": 3.0, "bends": None},
        {"start": 0.24, "end": 0.50, "midi": 67, "string": 1, "fret": 8,
         "velocity": 0.7, "onset_ratio": 3.2, "bends": None},
    ]
    annotate(notes)
    kinds = {t["type"] for t in notes[0]["techniques"]}
    assert "slide" not in kinds


def test_slide_from_contour_glide():
    # +4 semitones of glide in 1/3-semitone bins.
    glide = list(range(0, 13))
    notes = [
        {"start": 0.00, "end": 0.22, "midi": 64, "string": 1, "fret": 5,
         "velocity": 0.7, "onset_ratio": 1.2, "bends": glide},
        {"start": 0.20, "end": 0.45, "midi": 69, "string": 1, "fret": 10,
         "velocity": 0.5, "onset_ratio": 1.1, "bends": None},
    ]
    annotate(notes)
    kinds = {t["type"] for t in notes[0]["techniques"]}
    assert "slide" in kinds


def test_audio_legato_hammer(tmp_path):
    path = _write(tmp_path / "hp.wav", [
        (0.00, _tone(64, 0.30, attack=0.003, vel=0.95)),
        (0.18, _tone(65, 0.28, attack=0.09, vel=0.35)),
    ], 0.55)
    notes = [
        {"start": 0.00, "end": 0.30, "midi": 64, "string": 1, "fret": 5, "velocity": 0.9, "bends": None},
        {"start": 0.18, "end": 0.46, "midi": 65, "string": 1, "fret": 6, "velocity": 0.4, "bends": None},
    ]
    annotate(notes, audio_path=path)
    assert notes[1]["onset_ratio"] < 1.55
    assert "hammer" in {t["type"] for t in notes[0]["techniques"]}


def test_audio_picked_pair_is_not_hammer(tmp_path):
    path = _write(tmp_path / "pick.wav", [
        (0.00, _tone(64, 0.16, attack=0.003, vel=0.9)),
        (0.28, _tone(65, 0.16, attack=0.003, vel=0.9)),
    ], 0.55)
    notes = [
        {"start": 0.00, "end": 0.16, "midi": 64, "string": 1, "fret": 5, "velocity": 0.9, "bends": None},
        {"start": 0.28, "end": 0.44, "midi": 65, "string": 1, "fret": 6, "velocity": 0.9, "bends": None},
    ]
    annotate(notes, audio_path=path)
    kinds = {t["type"] for n in notes for t in n["techniques"]}
    assert "hammer" not in kinds
    assert "pull" not in kinds


def test_audio_bend_via_pyin(tmp_path):
    path = _write(tmp_path / "bend.wav", [
        (0.00, _tone(62, 0.55, attack=0.004, vel=0.85, midi_end=64)),
    ], 0.60)
    notes = [{"start": 0.02, "end": 0.52, "midi": 62, "string": 2, "fret": 3, "velocity": 0.8, "bends": None}]
    annotate(notes, audio_path=path)
    bend = next(t for t in notes[0]["techniques"] if t["type"] == "bend")
    assert bend["cents"] >= 70
    assert bend["source"] == "contour"


def test_audio_vibrato_via_pyin(tmp_path):
    path = _write(tmp_path / "vib.wav", [
        (0.00, _tone(57, 0.80, attack=0.004, vel=0.8, vib_hz=5.5, vib_cents=40)),
    ], 0.85)
    notes = [{"start": 0.02, "end": 0.78, "midi": 57, "string": 3, "fret": 2, "velocity": 0.8, "bends": None}]
    annotate(notes, audio_path=path)
    assert any(t["type"] == "vibrato" for t in notes[0]["techniques"])
