from tabgen_analysis.chord_label import parse
from tabgen_analysis.pipeline import choose_beat_grid
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


def test_double_time_falls_back_to_allin1():
    bt = {"bpm": 150.0, "beats": [0, 0.4], "downbeats": [0]}
    aio = {"bpm": 76, "beats": [0.7, 1.5, 2.3], "downbeats": [0.7, 4.0, 7.3, 10.6, 13.9]}
    grid, src = choose_beat_grid(bt, aio)
    assert src == "allin1" and grid["bpm"] == 76.0
    grid, src = choose_beat_grid({"bpm": 115.4, "beats": [], "downbeats": []},
                                 {"bpm": 118, "beats": [], "downbeats": [1, 2, 3, 4, 5]})
    assert src == "beat_this"


def test_fold_tempo_doubles_slow_pulse():
    beats = {"bpm": 57.7, "beats": [i * 1.04 for i in range(8)], "downbeats": [0.0, 2.08, 4.16, 6.24]}
    out = post.fold_tempo_octave(beats, duration=9.0)
    assert out["tempo_folded"] == "double"
    assert abs(out["bpm"] - 115.4) < 0.2
    assert len(out["beats"]) > len(beats["beats"])


def test_fold_tempo_halves_fast_pulse():
    beats = {"bpm": 200.0, "beats": [i * 0.3 for i in range(16)], "downbeats": [i * 1.2 for i in range(4)]}
    out = post.fold_tempo_octave(beats, duration=5.0)
    assert out["tempo_folded"] == "half"
    assert abs(out["bpm"] - 100.0) < 0.2
    assert 6 <= len(out["beats"]) <= 10


def test_fold_tempo_leaves_typical_bpm():
    beats = {"bpm": 100.0, "beats": [i * 0.6 for i in range(8)], "downbeats": [0.0, 2.4, 4.8]}
    out = post.fold_tempo_octave(beats, duration=5.0)
    assert "tempo_folded" not in out
    assert out["bpm"] == 100.0


def test_snap_sections_drops_silence_and_snaps():
    segs = [{"label": "start", "start": 0, "end": 0.5}, {"label": "intro", "start": 0.5, "end": 10.2},
            {"label": "verse", "start": 10.2, "end": 30.0}]
    out = post.snap_sections(segs, [0.6, 10.0, 20.0, 30.0], 31.0)
    assert [s["label"] for s in out] == ["intro", "verse"]
    assert out[0]["start"] == 0.6 and out[1]["start"] == 10.0


def test_68_bpm_ballad_is_not_doubled():
    from tabgen_analysis.stages.post import fold_tempo_octave
    beats = [i * 60 / 68 for i in range(40)]
    out = fold_tempo_octave({"bpm": 68.0, "beats": beats, "downbeats": beats[::4]}, 40.0)
    assert out["bpm"] == 68.0 and "tempo_folded" not in out


def test_dense_guitar_keeps_the_fast_grid():
    from tabgen_analysis.pipeline import choose_beat_grid
    bt = {"bpm": 166.0, "beats": [i * 60 / 166 for i in range(200)], "downbeats": []}
    aio = {"bpm": 83.0, "beats": [i * 60 / 83 for i in range(100)], "downbeats": [i * 4 * 60 / 83 for i in range(25)]}
    # 7 notes per half-time beat: the fast grid was the real beat (fast bossa comping)
    assert choose_beat_grid(bt, aio, n_notes=500, duration=72.0)[1] == "beat_this"
    # 2 notes per half-time beat: felt half time, as in I'm Yours (76 not 152)
    assert choose_beat_grid(bt, aio, n_notes=200, duration=72.0)[1] == "allin1"


def test_scale_tempo_double_and_half():
    from tabgen_analysis.stages.post import scale_tempo
    beats = [i * 1.0 for i in range(16)]  # 60 BPM, 4/4, downbeats every 4 beats
    g = {"beats": beats, "downbeats": beats[0::4], "bpm": 60.0}
    d = scale_tempo(g, 2, duration=16.5)
    assert d["bpm"] == 120.0 and len(d["beats"]) == 32
    assert d["downbeats"][:3] == [0.0, 2.0, 4.0]  # every old bar split in two
    h = scale_tempo(g, 0.5, duration=16.5)
    assert h["bpm"] == 30.0 and h["beats"][:3] == [0.0, 2.0, 4.0]
    assert h["downbeats"] == [0.0, 8.0]  # two old bars become one
    assert scale_tempo(g, 3) is g
