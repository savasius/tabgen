from tabgen_analysis.fingering import STANDARD_TUNING, assign_notes, candidates, detect_tuning


def test_open_e_candidates_include_open_low_e():
    assert (0, 0) in candidates(40, STANDARD_TUNING)


def test_c4_has_multiple_string_options():
    cands = candidates(60, STANDARD_TUNING)  # C4
    strings = {s for s, _f in cands}
    assert len(strings) >= 2


def test_scale_run_stays_in_one_position():
    # A minor pentatonic box around fret 5, ascending 8th-ish notes.
    midis = [45, 48, 50, 52, 55, 57, 60, 62]  # A2 C3 D3 E3 G3 A3 C4 D4
    notes = [{"start": i * 0.25, "end": i * 0.25 + 0.2, "midi": m, "velocity": 0.7, "confidence": 0.7}
             for i, m in enumerate(midis)]
    out = assign_notes(notes)
    assert all(n["string"] is not None for n in out)
    frets = [n["fret"] for n in out]
    assert max(frets) - min(f for f in frets if f > 0) <= 5
    assert all(n["fret"] <= 12 for n in out)


def test_open_em_shape_uses_open_strings():
    # Low-to-high: E2 B2 E3 G3 B3 E4 — E minor
    midis = [40, 47, 52, 55, 59, 64]
    notes = [{"start": 0.0, "end": 1.0, "midi": m, "velocity": 0.8, "confidence": 0.8} for m in midis]
    out = assign_notes(notes)
    assert len(out) == 6
    strings = sorted(n["string"] for n in out)
    assert strings == [1, 2, 3, 4, 5, 6]
    # At least four open strings in the open Em shape
    assert sum(n["fret"] == 0 for n in out) >= 4


def test_impossible_span_is_avoided():
    # Two notes a 10th apart should not be forced onto adjacent strings at extreme frets.
    notes = [
        {"start": 0, "end": 0.5, "midi": 40, "velocity": 0.7, "confidence": 0.7},  # E2
        {"start": 0, "end": 0.5, "midi": 64, "velocity": 0.7, "confidence": 0.7},  # E4
    ]
    out = assign_notes(notes)
    pressed = [n["fret"] for n in out if n["fret"] and n["fret"] > 0]
    if len(pressed) >= 2:
        assert max(pressed) - min(pressed) <= 5


def test_drop_d_when_notes_below_e2():
    notes = [{"start": i, "end": i + 0.2, "midi": 38, "velocity": 0.6} for i in range(5)]
    t, guess = detect_tuning(notes)
    assert guess == "drop_d" and t[0] == 38


def test_legato_dest_stays_on_same_string():
    notes = [
        {"start": 0.00, "end": 0.36, "midi": 57, "velocity": 0.8, "confidence": 0.8, "onset_ratio": 4.0},
        {"start": 0.16, "end": 0.50, "midi": 60, "velocity": 0.4, "confidence": 0.7, "onset_ratio": 1.1},
    ]
    out = assign_notes(notes)
    assert out[0]["string"] == out[1]["string"]
    assert abs(out[1]["fret"] - out[0]["fret"]) == 3


def test_stepwise_melody_prefers_same_string():
    # Open-E then F and G — should stay on high E (string 1) rather than hopping.
    notes = [
        {"start": 0.00, "end": 0.20, "midi": 64, "velocity": 0.8, "confidence": 0.8},
        {"start": 0.25, "end": 0.45, "midi": 65, "velocity": 0.8, "confidence": 0.8},
        {"start": 0.50, "end": 0.70, "midi": 67, "velocity": 0.8, "confidence": 0.8},
    ]
    out = assign_notes(notes)
    assert len({n["string"] for n in out}) == 1


def test_chord_hint_prefers_chord_tones_in_rhythm():
    # C3 sounded during C major should land on a C-major-friendly fret, not a random inversion far up.
    notes = [{"start": 0.0, "end": 0.5, "midi": 48, "velocity": 0.7, "confidence": 0.7}]  # C3
    out = assign_notes(notes, chord_at=lambda _t: "C:maj", hint_weight_at=lambda _t: 0.5)
    assert out[0]["fret"] <= 8
