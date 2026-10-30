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
    assert "{b (0 2)}" in tex
    assert "{b (2)}" not in tex  # single-point bend does not draw an arrow in alphaTab 1.8


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
    assert "{h}" in tex  # pull-off is `{h}` + lower dest fret; `{p}` is slap/pop
    assert "{p}" not in tex
    assert "{ss}" not in tex
    assert "{~" not in tex
    assert "{/}" not in tex


def test_alphatex_bend_paren_is_not_treated_as_a_chord():
    notes = [{
        "start": 0.0, "end": 0.7, "midi": 64, "string": 1, "fret": 8,
        "techniques": [{"type": "bend", "source": "contour", "quarter_tones": 4}],
    }]
    tex = to_alphatex(notes, BARS, BEATS, 2.0, title="x", bpm=120)
    assert tex.count("{b (0 4)}") == 1
    assert "8.1{t}" in tex


def test_alphatex_effects_stay_on_the_attack_not_the_tie():
    notes = [{
        "start": 0.0, "end": 0.7, "midi": 64, "string": 1, "fret": 5,
        "techniques": [{"type": "hammer", "source": "legato", "to_fret": 8}],
    }]
    tex = to_alphatex(notes, BARS, BEATS, 2.0, title="x", bpm=120)
    # 0.7s at 120 BPM is more than one 16th, so the note is split: first chunk has {h}.
    assert "5.1{h}" in tex
    assert "{t}" in tex
    # the tied leftover must not steal the hammer mark
    assert "{t}" in tex.split("5.1{h}")[-1] or "5.1{t}" in tex
    first_h = tex.find("5.1{h}")
    first_t = tex.find("5.1{t}")
    assert first_h != -1
    if first_t != -1:
        assert first_h < first_t


def test_alphatex_hammer_and_pull_share_h_token():
    notes = [
        {"start": 0.0, "end": 0.4, "midi": 64, "string": 1, "fret": 5,
         "techniques": [{"type": "hammer", "source": "legato", "to_fret": 8}]},
        {"start": 0.5, "end": 0.9, "midi": 67, "string": 1, "fret": 8, "techniques": []},
        {"start": 1.0, "end": 1.4, "midi": 67, "string": 1, "fret": 8,
         "techniques": [{"type": "pull", "source": "legato", "to_fret": 5}]},
        {"start": 1.5, "end": 1.9, "midi": 64, "string": 1, "fret": 5, "techniques": []},
    ]
    tex = to_alphatex(notes, BARS, BEATS, 2.0, title="x", bpm=120)
    assert "5.1{h}" in tex
    assert "8.1{h}" in tex
    assert "{p}" not in tex


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


def test_long_note_does_not_swallow_later_onsets():
    # A ringing bass note (whole bar) with melody on top: every onset must reach the tab.
    notes = [
        {"start": 0.0, "end": 1.95, "midi": 40, "string": 6, "fret": 0, "techniques": []},
        {"start": 0.5, "end": 0.7, "midi": 64, "string": 1, "fret": 0, "techniques": []},
        {"start": 1.0, "end": 1.2, "midi": 67, "string": 1, "fret": 3, "techniques": []},
    ]
    tex = to_alphatex(notes, BARS, BEATS, 2.0)
    body = tex.split("\n.\n", 1)[1]
    assert "0.6" in body and "0.1" in body and "3.1" in body
    xml = to_musicxml(notes, BARS, BEATS, 2.0)
    assert xml.count("<fret>") == 3


def test_chord_continuation_is_tied_not_repicked():
    notes = [
        {"start": 0.0, "end": 1.9, "midi": 40, "string": 6, "fret": 0, "techniques": []},
        {"start": 0.0, "end": 1.9, "midi": 47, "string": 5, "fret": 2, "techniques": []},
    ]
    tex = to_alphatex(notes, BARS, BEATS, 2.0)
    # 15 sixteenths = half + quarter + eighth + sixteenth: first chunk picked, rest tied.
    assert "(2.5{t} 0.6{t})" in tex or "(0.6{t} 2.5{t})" in tex


def test_bend_release_points():
    notes = [{"start": 0.0, "end": 0.9, "midi": 57, "string": 3, "fret": 2,
              "techniques": [{"type": "bend", "quarter_tones": 4, "release": True}]}]
    assert "{b (0 4 4 0)}" in to_alphatex(notes, BARS, BEATS, 2.0)


def test_pull_off_is_h_in_alphatex_never_p():
    # alphaTab: {p} is slap/pop. A pull-off is {h} toward a lower fret on the same string.
    notes = [
        {"start": 0.0, "end": 0.24, "midi": 72, "string": 1, "fret": 8,
         "techniques": [{"type": "pull", "to_fret": 5}]},
        {"start": 0.25, "end": 0.45, "midi": 69, "string": 1, "fret": 5, "techniques": []},
    ]
    tex = to_alphatex(notes, BARS, BEATS, 2.0)
    assert "8.1{h}" in tex and "{p" not in tex


def test_irregular_bars_get_their_own_time_signature():
    # 4 + 6 + 4 beats at 120 BPM: the 6-beat bar must not be squeezed into 4/4
    beats = [i * 0.5 for i in range(14)]
    bars = [{"index": 0, "start": 0.0, "end": 2.0, "beats": [0, 1, 2, 3]},
            {"index": 1, "start": 2.0, "end": 5.0, "beats": list(range(4, 10))},
            {"index": 2, "start": 5.0, "end": 7.0, "beats": [10, 11, 12, 13]}]
    notes = [{"start": 2.0, "end": 2.4, "midi": 52, "string": 5, "fret": 2, "techniques": []}]
    tex = to_alphatex(notes, bars, beats, 7.0, bpm=120)
    body = tex.split("\n.\n", 1)[1].splitlines()
    assert body[1].startswith("\\ts 6 4 ")
    assert body[2].startswith("\\ts 4 4 ")
    assert "\\ts" not in body[0]
    xml = to_musicxml(notes, bars, beats, 7.0, bpm=120)
    assert xml.count("<beats>6</beats>") == 1 and xml.count("<beats>4</beats>") == 2
