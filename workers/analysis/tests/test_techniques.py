from tabgen_analysis.techniques import annotate, classify_contour


def test_rising_contour_is_a_bend():
    # 1/3-semitone bins: +3 bins = 100 cents.
    bends = [0, 0, 1, 2, 3, 3, 3, 3]
    tags = classify_contour(bends, 0.4)
    kinds = {t["type"] for t in tags}
    assert "bend" in kinds
    assert any(t.get("cents", 0) >= 70 for t in tags if t["type"] == "bend")


def test_flat_contour_is_not_a_bend():
    assert classify_contour([0, 0, 0, 1, 0, 0, 0, 0], 0.3) == []


def test_oscillation_is_vibrato():
    # ~6 Hz wobble of ±40 cents over 0.5s. bins of 1/3 semitone (~33 cents).
    seq = []
    for _ in range(6):
        seq.extend([1, 1, 0, -1, -1, 0])
    tags = classify_contour(seq, 1.0)
    assert any(t["type"] == "vibrato" for t in tags)


def test_hammer_from_timing_same_string():
    notes = [
        {"start": 0.00, "end": 0.20, "midi": 64, "string": 1, "fret": 5,
         "velocity": 0.8, "confidence": 0.8, "bends": None},
        {"start": 0.22, "end": 0.40, "midi": 65, "string": 1, "fret": 6,
         "velocity": 0.5, "confidence": 0.7, "bends": None},
    ]
    annotate(notes)
    kinds = {t["type"] for t in notes[0]["techniques"]}
    assert "hammer" in kinds


def test_slide_when_not_quieter():
    notes = [
        {"start": 0.00, "end": 0.20, "midi": 64, "string": 1, "fret": 5,
         "velocity": 0.6, "confidence": 0.6, "bends": None},
        {"start": 0.24, "end": 0.50, "midi": 67, "string": 1, "fret": 8,
         "velocity": 0.7, "confidence": 0.7, "bends": None},
    ]
    annotate(notes)
    kinds = {t["type"] for t in notes[0]["techniques"]}
    assert "slide" in kinds
