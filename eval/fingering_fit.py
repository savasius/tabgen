"""Fit FingeringParams on true pitches (string withheld) from two styles, test on held-out data.

Train: GuitarSet players 00-04 (acoustic comping/solos) + IDMT-SMT-Guitar licks on the
Aria and Strat (electric). Test: GuitarSet player 05 + IDMT Les Paul licks. The objective is
the mean of the two datasets so neither style's habits (GuitarSet avoids open strings,
rock licks live in open position) dominates.

Fits a handful of weights by coordinate search, not a learned model, so it can't memorize
songs. Prints train/test oracle string+fret accuracy for the legacy greedy pass, the v2
defaults and the fitted v2.

  PYTHONPATH=workers/analysis .venv/bin/python eval/fingering_fit.py
"""

from __future__ import annotations

import dataclasses
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "workers" / "analysis"))
sys.path.insert(0, str(HERE))

from tab_bench import guitarset_clips  # noqa: E402
from tabgen_analysis import fingering  # noqa: E402
from tabgen_analysis.fingering import FingeringParams  # noqa: E402


def _inputs(clips):
    return [[{"start": n["start"], "end": n["end"], "midi": n["midi"], "velocity": 0.7,
              "confidence": 0.7, "_gt": (n["string_i"], n["fret"])} for n in c["notes"]] for c in clips]


def acc2(sets, fn, **kw) -> float:
    return sum(acc(x, fn, **kw) for x in sets) / len(sets)


def acc(inputs, fn, **kw) -> float:
    ok = tot = 0
    for est in inputs:
        out = fn([dict(n) for n in est], **kw)
        ok += sum(1 for n in out if n.get("string_i") is not None and (n["string_i"], n["fret"]) == n["_gt"])
        tot += len(est)
    return ok / max(1, tot)


GRID = {
    "fret": [-0.05, 0.0, 0.02, 0.05, 0.1, 0.2],
    "high": [0.0, 0.2, 0.6, 1.2],
    "open_bonus": [-0.6, -0.3, -0.15, 0.0, 0.15, 0.25, 0.6],
    "span": [0.0, 0.1, 0.25, 0.5],
    "pos": [0.3, 0.6, 0.9, 1.4, 2.0, 3.0],
    "string": [0.0, 0.1, 0.25, 0.5, 1.0],
    "rest_decay": [0.2, 0.6, 1.5, 4.0],
}


def fit(train, rounds: int = 3, start: FingeringParams | None = None) -> FingeringParams:
    p = start or FingeringParams()
    best = acc2(train, fingering.assign_notes_v2, params=p)
    for r in range(rounds):
        improved = False
        for name, values in GRID.items():
            for v in values:
                q = dataclasses.replace(p, **{name: v})
                a = acc2(train, fingering.assign_notes_v2, params=q)
                if a > best + 1e-4:
                    best, p, improved = a, q, True
            print(f"round {r} {name}={getattr(p, name)} train={best:.4f}", flush=True)
        if not improved:
            break
    return p


def main() -> None:
    from technique_bench import licks
    lk = licks()
    train = [_inputs(guitarset_clips("00,01,02,03,04")), _inputs([c for c in lk if not c["id"].startswith("LP_")])]
    test_gs = _inputs(guitarset_clips("05"))
    test_lp = _inputs([c for c in lk if c["id"].startswith("LP_")])
    start = FingeringParams(**json.loads(sys.argv[1])) if len(sys.argv) > 1 else FingeringParams()

    def report(name, fn, **kw):
        return (acc2(train, fn, **kw), acc(test_gs, fn, **kw), acc(test_lp, fn, **kw))
    rows = {"legacy_greedy": report("legacy", fingering.assign_notes),
            "v2_start": report("v2", fingering.assign_notes_v2, params=start)}
    p = fit(train, start=start)
    rows["v2_fitted"] = report("fit", fingering.assign_notes_v2, params=p)
    for k, (a, b, c) in rows.items():
        print(f"{k:14s} train={a:.4f} test_gs05={b:.4f} test_idmt_lp={c:.4f}")
    fitted = {k: v for k, v in dataclasses.asdict(p).items() if k in GRID}
    print(json.dumps(fitted))
    out = HERE.parent / "data" / "eval" / "fingering_fit.json"
    out.write_text(json.dumps({"params": fitted, "scores": rows}, indent=1))


if __name__ == "__main__":
    main()
