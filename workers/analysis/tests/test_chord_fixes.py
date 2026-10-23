from tabgen_analysis.chord_label import parse, pc
from tabgen_analysis.stages import post


def test_power_chord_stays_at_basic_level():
    assert parse("F:5").level("basic") == "F:5"
    assert parse("F:5").level("normal") == "F:5"
    assert parse("C:maj").level("basic") == "C:maj"


def test_flicker_maj_min_becomes_power_chord():
    # Same root, both qualities mixed throughout — typical missing-third power riff.
    labels = (["F:maj", "F:min"] * 8) + (["Bb:maj", "Bb:min"] * 4)
    out = post.collapse_power_qualities(labels)
    assert all(x == "F:5" for x in out[:16])
    assert all(parse(x).quality == "5" and parse(x).root in ("A#", "Bb") for x in out[16:])


def test_stable_major_is_not_collapsed():
    labels = ["B:maj"] * 12 + ["F#:maj"] * 12 + ["G#:min"] * 12 + ["E:maj"] * 12
    out = post.collapse_power_qualities(labels)
    assert out[0] == "B:maj" and out[12] == "F#:maj" and out[24] == "G#:min"


def test_neighbor_flicker_collapses_locally():
    labels = ["G:maj"] * 6 + ["C:maj", "C:min", "C:maj"] + ["G:maj"] * 4
    out = post.collapse_power_qualities(labels)
    assert out[0] == "G:maj"
    assert out[6:9] == ["C:5", "C:5", "C:5"]


def test_relative_minor_wins_when_it_is_the_home_chord():
    # Starts and lingers on the relative minor tonic; S-KEY reported the relative major.
    chords = (
        [{"start": 0, "end": 8, "label": "F#:min"}]
        + [{"start": 8, "end": 12, "label": "A:maj"}]
        + [{"start": 12, "end": 16, "label": "E:maj"}]
        + [{"start": 16, "end": 20, "label": "B:maj"}]
        + [{"start": 20, "end": 28, "label": "F#:min"}]
    )
    key = post.reconcile_relative_key({"tonic": "A", "mode": "major", "confidence": 0.8}, chords)
    assert key["tonic"] == "F#" and key["mode"] == "minor" and key["relative_adjusted"]


def test_relative_minor_wins_when_skey_picks_the_subdominant_major():
    # F#m–A–E–B loop; S-KEY sometimes reports E major (a chord in the loop).
    chords = (
        [{"start": 0, "end": 2.7, "label": "F#:min"}]
        + [{"start": 2.7, "end": 5.4, "label": "A:maj"}]
        + [{"start": 5.4, "end": 8.1, "label": "E:maj"}]
        + [{"start": 8.1, "end": 10.9, "label": "B:maj"}]
        + [{"start": 10.9, "end": 13.6, "label": "F#:min"}]
        + [{"start": 13.6, "end": 16.3, "label": "A:maj"}]
        + [{"start": 16.3, "end": 19.0, "label": "E:maj"}]
        + [{"start": 19.0, "end": 21.8, "label": "B:maj"}]
    )
    key = post.reconcile_relative_key({"tonic": "E", "mode": "major", "confidence": 0.82}, chords)
    assert key["tonic"] == "F#" and key["mode"] == "minor"


def test_relative_does_not_flip_a_clear_major_loop():
    # I–V–vi–IV in B: opening I, plenty of B major.
    chords = []
    t = 0
    for _ in range(4):
        for lab, dur in (("B:maj", 4), ("F#:maj", 4), ("G#:min", 4), ("E:maj", 4)):
            chords.append({"start": t, "end": t + dur, "label": lab})
            t += dur
    key = post.reconcile_relative_key({"tonic": "B", "mode": "major", "confidence": 0.8}, chords)
    assert key["tonic"] == "B" and key["mode"] == "major"
    assert not key["relative_adjusted"]


def test_missing_third_in_notes_becomes_power_chord():
    labels = ["F:maj"] * 4
    intervals = [(0, 1), (1, 2), (2, 3), (3, 4)]
    # F3 + C4 only (root + fifth), no A or Ab
    notes = [{"start": 0, "end": 4, "midi": 53}, {"start": 0, "end": 4, "midi": 60}]
    out = post.collapse_missing_thirds(labels, intervals, notes)
    assert out == ["F:5"] * 4


def test_triad_with_third_stays_major():
    labels = ["C:maj"] * 2
    intervals = [(0, 1), (1, 2)]
    notes = [{"start": 0, "end": 2, "midi": 48}, {"start": 0, "end": 2, "midi": 52},
             {"start": 0, "end": 2, "midi": 55}]
    assert post.collapse_missing_thirds(labels, intervals, notes) == ["C:maj", "C:maj"]


def test_power_chord_song_keeps_skey_tonic_when_roots_agree():
    chords = [{"start": i, "end": i + 2, "label": lab} for i, lab in
              enumerate(["F:5", "Bb:5", "Ab:5", "Db:5"] * 4)]
    key = post.reconcile_relative_key({"tonic": "F", "mode": "minor", "confidence": 0.7}, chords)
    assert key["tonic"] == "F"
    assert not key["relative_adjusted"]


def test_opening_minor_beats_a_nonrelative_major():
    # i–III–VII–IV: S-KEY often reports VII as the key (E major for F#m A E B).
    t = 0.0
    seq = []
    for lab in ["F#:min", "A:maj", "E:maj", "B:maj"] * 2:
        seq.append({"start": t, "end": t + 4, "label": lab})
        t += 4
    key = post.reconcile_relative_key({"tonic": "E", "mode": "major", "confidence": 0.8}, seq)
    assert key["tonic"] == "F#" and key["mode"] == "minor" and key["relative_adjusted"]


def test_power_riff_opening_root_beats_relative_major():
    seq = []
    t = 0.0
    for lab in ["F:5", "A#:5", "G#:5", "C#:5"] * 4:
        seq.append({"start": t, "end": t + 2, "label": lab})
        t += 2
    key = post.reconcile_relative_key({"tonic": "G#", "mode": "major", "confidence": 0.7}, seq)
    assert pc(key["tonic"]) == pc("F") and key["mode"] == "minor"
