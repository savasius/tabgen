import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "eval"))
from score import technique_scores  # noqa: E402


def test_technique_scores_matches_events():
    pred = [
        {"start": 1.50, "midi": 60, "techniques": [{"type": "hammer", "confidence": 0.7}]},
        {"start": 3.72, "midi": 62, "techniques": [{"type": "bend", "confidence": 0.8, "cents": 180}]},
        {"start": 0.10, "midi": 57, "techniques": [{"type": "hammer", "confidence": 0.4}]},
    ]
    out = technique_scores(
        pred, [],
        events=[{"type": "hammer", "t": 1.56}, {"type": "bend", "t": 3.70}],
        clean_until=1.25,
    )
    assert out["tp"] == 2
    assert out["fp"] == 1
    assert out["fn"] == 0
    assert out["clean_fp"] == 1
    assert out["recall"] == 1.0


def test_technique_scores_empty_gt_is_all_fp():
    pred = [{"start": 0.2, "midi": 60, "techniques": [{"type": "slide", "confidence": 0.5}]}]
    out = technique_scores(pred, [], events=[], clean_until=5.0)
    assert out["tp"] == 0 and out["fp"] == 1 and out["fn"] == 0
    assert out["precision"] == 0.0
    assert out["recall"] == 1.0  # nothing to find
    assert out["clean_fp"] == 1
