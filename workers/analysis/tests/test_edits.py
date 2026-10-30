import json

import pytest

from tabgen_analysis import config, edits


def _analysis(hash_="abc123"):
    beats = [i * 0.5 for i in range(8)]
    grid = [{"t": b, "end": b + 0.5, "bar": i // 4, "pos": i % 4, "chord": "C:maj"} for i, b in enumerate(beats)]
    notes = [{"start": 0.0, "end": 0.5, "midi": 48, "string": 5, "fret": 3, "techniques": []}]
    tab = {"tuning": ["E2", "A2", "D3", "G3", "B3", "E4"], "capo": 0, "notes": notes, "alpha_tex": "x",
           "stats": {"n_notes": 1, "n_low_confidence": 0}}
    return {
        "id": hash_, "duration": 4.0, "meta": {"title": "t"}, "beats": beats, "downbeats": [0.0, 2.0],
        "tempo": {"bpm": 120, "time_signature": "4/4"}, "grid": grid, "chords": [],
        "bars": [{"index": 0, "start": 0.0, "end": 2.0, "beats": [0, 1, 2, 3]},
                 {"index": 1, "start": 2.0, "end": 4.0, "beats": [4, 5, 6, 7]}],
        "tab": tab, "parts": [{"id": "s1", "tab": json.loads(json.dumps(tab)), "grid": None, "chords": []}],
    }


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    (tmp_path / "tracks" / "abc123").mkdir(parents=True)
    return tmp_path


def test_pitch_follows_string_and_fret():
    tuning = ["E2", "A2", "D3", "G3", "B3", "E4"]
    n = edits.clean_notes([{"start": 1.0, "end": 1.5, "string": 1, "fret": 5, "midi": 0}], tuning, 0, 4.0)
    assert n[0]["midi"] == 64 + 5          # high e + 5
    n = edits.clean_notes([{"start": 1.0, "end": 1.5, "string": 6, "fret": 0}], tuning, 2, 4.0)
    assert n[0]["midi"] == 40 + 2          # low E with capo 2
    with pytest.raises(ValueError):
        edits.clean_notes([{"start": 0, "end": 1, "string": 7, "fret": 0}], tuning, 0, 4.0)
    with pytest.raises(ValueError):
        edits.clean_notes([{"start": 0, "end": 1, "string": 1, "fret": 30}], tuning, 0, 4.0)


def test_tab_edit_is_applied_and_reverted(data_dir):
    a = _analysis()
    fixed = edits.clean_notes([{"start": 0.0, "end": 0.5, "string": 4, "fret": 7, "edited": True},
                               {"start": 2.0, "end": 2.5, "string": 1, "fret": 0, "edited": True}],
                              a["tab"]["tuning"], 0, 4.0)
    edits.set_tab("abc123", "all", fixed)
    out = edits.apply(a)
    assert out["tab"]["edited"] and [n["fret"] for n in out["tab"]["notes"]] == [7, 0]
    assert "7.4" in out["tab"]["alpha_tex"] and "0.1" in out["tab"]["alpha_tex"]
    assert out["parts"][0]["tab"]["notes"][0]["fret"] == 3   # the other guitar is untouched
    assert out["edits"]["tabs"] == ["all"]
    edits.set_tab("abc123", "all", None)
    assert not edits.edits_path("abc123").exists()
    assert edits.apply(a) is a


def test_chord_edit_rewrites_grid_and_segments(data_dir):
    a = _analysis()
    edits.set_chords("abc123", "all", {"4": "A:min", "5": "A:min", "6": "A:min", "7": "A:min"})
    out = edits.apply(a)
    assert [g["chord"] for g in out["grid"]] == ["C:maj"] * 4 + ["A:min"] * 4
    assert [(c["label"], c["beats"]) for c in out["chords"]] == [("C:maj", 4), ("A:min", 4)]
    with pytest.raises(ValueError):
        edits.set_chords("abc123", "all", {"0": "H:maj"})


def test_part_edits_only_touch_that_part(data_dir):
    a = _analysis()
    notes = edits.clean_notes([{"start": 0.0, "end": 0.5, "string": 2, "fret": 1}], a["tab"]["tuning"], 0, 4.0)
    edits.set_tab("abc123", "s1", notes)
    out = edits.apply(a)
    assert out["tab"]["notes"][0]["fret"] == 3
    assert out["parts"][0]["tab"]["notes"][0]["fret"] == 1 and out["parts"][0]["tab"]["edited"]


def test_tempo_factor_is_saved_and_clears_chord_fixes(tmp_path, monkeypatch):
    from tabgen_analysis import config, edits
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(edits, "track_dir", lambda h: tmp_path / h)
    (tmp_path / "abc").mkdir()
    edits._save("abc", {"chords": {"all": {"3": "A:min"}}})
    edits.set_tempo("abc", 0.5)
    assert edits.load("abc") == {**edits.load("abc"), "tempo_factor": 0.5} and "chords" not in edits.load("abc")
    edits.set_tempo("abc", None)
    assert edits.load("abc") == {}
