from tabgen_analysis.chord_label import parse
from tabgen_analysis.stages import post


def test_parse_and_levels():
    c = parse("A:min7/b3")
    assert (c.root, c.quality, c.bass) == ("A", "min7", "C")
    assert c.level("normal") == "A:min7"
    assert c.level("basic") == "A:min"
    assert parse("N").is_none
    assert parse("G:sus4(b7)").level("basic") == "G:maj"


def test_chord_per_beat_majority_overlap():
    chords = [{"start": 0.0, "end": 1.2, "label": "C:maj"}, {"start": 1.2, "end": 4.0, "label": "G:maj"}]
    intervals = [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0)]
    assert post.chord_per_beat(chords, intervals) == ["C:maj", "G:maj", "G:maj"]


def test_grid_bars_with_pickup():
    beats = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]
    downbeats = [1.5, 3.5]
    intervals = post._beat_intervals(beats, 5.5)
    labels = ["N"] * 2 + ["C:maj"] * 4 + ["G:maj"] * 4
    sections = [{"label": "verse", "start": 1.5, "end": 5.5}]
    grid, bars, ts = post.build_grid(beats, downbeats, labels, intervals, sections)
    assert ts == "4/4"
    assert bars[0]["pickup"] and len(bars[0]["beats"]) == 2
    assert [g["pos"] for g in grid[:3]] == [2, 3, 0]
    assert bars[1]["section"] == 0
    merged = post.merge_chords(grid)
    assert [m["label"] for m in merged] == ["N", "C:maj", "G:maj"]
    assert merged[1]["beats"] == 4


def test_snap_sections_drops_silence_and_snaps():
    segs = [{"label": "start", "start": 0, "end": 0.5}, {"label": "intro", "start": 0.5, "end": 10.2},
            {"label": "verse", "start": 10.2, "end": 30.0}]
    out = post.snap_sections(segs, [0.6, 10.0, 20.0, 30.0], 31.0)
    assert [s["label"] for s in out] == ["intro", "verse"]
    assert out[0]["start"] == 0.6 and out[1]["start"] == 10.0
