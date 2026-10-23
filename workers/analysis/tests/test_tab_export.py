from tabgen_analysis.tab_export import quantize_notes, to_alphatex, to_musicxml

BEATS = [0.0, 0.5, 1.0, 1.5]
BARS = [{"index": 0, "start": 0.0, "end": 2.0, "beats": [0, 1, 2, 3]}]
NOTES = [
    {"start": 0.00, "end": 0.45, "midi": 64, "string": 1, "fret": 0, "techniques": []},
    {"start": 0.50, "end": 0.95, "midi": 67, "string": 2, "fret": 0, "techniques": []},
    {"start": 1.00, "end": 1.90, "midi": 72, "string": 1, "fret": 8,
     "techniques": [{"type": "bend", "source": "contour", "cents": 100, "quarter_tones": 2}]},
]


def test_quantize_snaps_to_sixteenths():
    q = quantize_notes(NOTES, BEATS, 2.0)
    assert q[0]["slot0"] == 0
    assert q[1]["slot0"] == 4  # start of beat 1, 4 sixteenths per beat


def test_alphatex_has_barline_and_bend():
    tex = to_alphatex(NOTES, BARS, BEATS, 2.0, title="Solo", bpm=120)
    assert r'\title "Solo"' in tex
    assert "|" in tex
    assert "8.1" in tex
    assert "b (" in tex


def test_alphatex_dedupes_repeated_hammer_tokens():
    notes = [{
        "start": 0.0, "end": 0.4, "midi": 64, "string": 1, "fret": 5,
        "techniques": [
            {"type": "hammer", "source": "timing"},
            {"type": "hammer", "source": "timing"},
            {"type": "slide", "source": "timing"},
        ],
    }]
    tex = to_alphatex(notes, BARS, BEATS, 2.0, title="x", bpm=120)
    assert "{h h}" not in tex
    assert "{ss" not in tex  # slide dropped when hammer present
    assert "{h}" in tex


def test_alphatex_slide_and_vibrato_tokens():
    notes = [
        {"start": 0.0, "end": 0.4, "midi": 64, "string": 1, "fret": 5,
         "techniques": [{"type": "slide", "source": "contour", "confidence": 0.7}]},
        {"start": 0.5, "end": 1.0, "midi": 67, "string": 1, "fret": 8,
         "techniques": [{"type": "vibrato", "source": "contour", "confidence": 0.6}]},
        {"start": 1.0, "end": 1.4, "midi": 65, "string": 1, "fret": 6,
         "techniques": [{"type": "pull", "source": "legato", "confidence": 0.6}]},
    ]
    tex = to_alphatex(notes, BARS, BEATS, 2.0, title="x", bpm=120)
    assert "{sl}" in tex
    assert "{v}" in tex
    assert "{p}" in tex
    assert "{ss}" not in tex
    assert "{~" not in tex
    assert "{/}" not in tex


def test_musicxml_has_tab_clef_and_fret():
    xml = to_musicxml(NOTES, BARS, BEATS, 2.0, title="Solo", bpm=120)
    assert "<sign>TAB</sign>" in xml
    assert "<fret>8</fret>" in xml
    assert "<string>1</string>" in xml
    assert "<bend>" in xml


def test_musicxml_slide_and_vibrato():
    notes = [
        {"start": 0.0, "end": 0.4, "midi": 64, "string": 1, "fret": 5,
         "techniques": [{"type": "slide", "source": "contour"}]},
        {"start": 0.5, "end": 1.0, "midi": 67, "string": 1, "fret": 8,
         "techniques": [{"type": "vibrato", "source": "contour"}]},
    ]
    xml = to_musicxml(notes, BARS, BEATS, 2.0, title="x", bpm=120)
    assert 'slide type="start"' in xml or "<slide" in xml
    assert "wavy-line" in xml
