from tabgen_analysis.stages.transcribe import clean_notes


def test_clean_notes_merges_split_same_midi():
    notes = [
        {"start": 0.00, "end": 0.20, "midi": 64, "velocity": 0.5, "confidence": 0.5},
        {"start": 0.18, "end": 0.40, "midi": 64, "velocity": 0.7, "confidence": 0.7},
    ]
    out = clean_notes(notes)
    assert len(out) == 1
    assert out[0]["midi"] == 64
    assert out[0]["end"] == 0.40
    assert out[0]["velocity"] == 0.7


def test_clean_notes_drops_quieter_octave():
    notes = [
        {"start": 0.00, "end": 0.40, "midi": 52, "velocity": 0.8, "confidence": 0.8},  # E3
        {"start": 0.01, "end": 0.40, "midi": 64, "velocity": 0.4, "confidence": 0.4},  # E4
        {"start": 0.01, "end": 0.40, "midi": 59, "velocity": 0.7, "confidence": 0.7},  # B3
    ]
    out = clean_notes(notes)
    midis = {n["midi"] for n in out}
    assert 52 in midis and 59 in midis
    assert 64 not in midis
