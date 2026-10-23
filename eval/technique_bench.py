"""Technique + electric-guitar tab check on IDMT-SMT-Guitar dataset2 (real licks, CC BY-NC-ND).

198 licks on three electric guitars, annotated per note with string/fret and expression
style: BE bend, SL slide, VI vibrato, HA harmonic, DN dead note, NO normal. There are no
hammer-on / pull-off labels, so H/P is reported only as tags per 100 notes (on licks that
are mostly picked, a high rate is false positives).

  PYTHONPATH=workers/analysis .venv/bin/python eval/technique_bench.py --backend bp-legacy
"""

from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "workers" / "analysis"))
sys.path.insert(0, str(HERE))

from score import technique_scores  # noqa: E402
from tab_bench import DATA, _distort, run_backend, score  # noqa: E402
import soundfile as sf  # noqa: E402
from tabgen_analysis import fingering, techniques  # noqa: E402
from tabgen_analysis.stages import transcribe as tr  # noqa: E402

D2 = DATA / "idmt" / "IDMT-SMT-GUITAR_V2" / "dataset2"
EXPR = {"BE": "bend", "SL": "slide", "VI": "vibrato"}


def licks() -> list[dict]:
    out = []
    for xp in sorted((D2 / "annotation").glob("*Lick*.xml")):
        wav = D2 / "audio" / (xp.stem + ".wav")
        if not wav.exists():
            continue
        notes, events = [], []
        for e in ET.parse(xp).getroot().iter("event"):
            t = float(e.findtext("onsetSec"))
            s = int(e.findtext("stringNumber")) - 1
            fret = int(e.findtext("fretNumber"))
            midi = int(e.findtext("pitch"))
            notes.append({"start": t, "end": float(e.findtext("offsetSec")), "midi": midi,
                          "string_i": s, "fret": fret})
            kind = EXPR.get(e.findtext("expressionStyle"))
            if kind:
                events.append({"type": kind, "t": t, "midi": midi})
        out.append({"id": xp.stem, "wav": wav, "notes": notes, "events": events})
    return out


def distorted(wav: Path) -> Path:
    dest = DATA / "hard-dist-idmt" / wav.name
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        y, sr = sf.read(str(wav), dtype="float32")
        sf.write(str(dest), _distort(y.mean(axis=1) if y.ndim == 2 else y, sr), sr)
    return dest


def run(backend: str, fing: str, limit: int | None = None, merge: bool = True, hard: str = "") -> dict:
    rows, tech_pred, tech_gt = [], [], []
    hp = n_notes = 0
    assign = fingering.assign_notes_v2 if fing == "v2" else fingering.assign_notes
    merge = merge and hasattr(techniques, "merge_split_bends")  # baseline checkout has neither
    for c in licks()[:limit]:
        wav = distorted(c["wav"]) if hard == "dist" else c["wav"]
        raw = run_backend(backend, wav)
        notes = tr.clean_notes([dict(n) for n in raw["notes"]])  # same cleaner as the pipeline
        audio = techniques.load_audio(wav)
        techniques.attach_onsets(notes, audio)
        if merge:
            notes = techniques.merge_split_bends(notes, audio)
            notes = techniques.resolve_continuations(notes)
        placed = [n for n in assign(notes) if n.get("string_i") is not None]
        techniques.annotate(placed, audio=audio)
        s = score(c["notes"], placed)
        s["id"] = c["id"]
        rows.append(s)
        # Offset each clip so events from different licks never match each other.
        off = 1000.0 * len(rows)
        tech_pred += [{**n, "start": float(n["start"]) + off} for n in placed]
        tech_gt += [{**e, "t": e["t"] + off} for e in c["events"]]
        hp += sum(1 for n in placed for t in n.get("techniques") or [] if t["type"] in ("hammer", "pull"))
        n_notes += len(placed)
    tech = technique_scores(tech_pred, [], events=tech_gt, window=0.15)
    agg = {k: round(float(np.mean([r[k] for r in rows])), 4) for k in ("note_f1", "tab_f1", "sf_acc")}
    agg["hp_per_100"] = round(100.0 * hp / max(1, n_notes), 2)
    return {"mean": agg, "techniques": tech, "n_clips": len(rows)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", default="bp-legacy")
    ap.add_argument("--fingering", default="v2")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--no-merge", action="store_true")
    ap.add_argument("--hard", default="", help="dist = amp-style distortion")
    ap.add_argument("--out", type=Path, default=DATA / "technique_bench.json")
    a = ap.parse_args()
    res = run(a.backend, a.fingering, a.limit, merge=not a.no_merge, hard=a.hard)
    t = res["techniques"]
    print(json.dumps(res["mean"]), f"tech P={t['precision']} R={t['recall']} F1={t['f1']}",
          json.dumps(t["per_type"]))
    prev = json.loads(a.out.read_text()) if a.out.exists() else {}
    prev[f"{a.backend}:{a.fingering}" + ("" if not a.no_merge else ":nomerge") + (f":{a.hard}" if a.hard else "")] = res
    a.out.write_text(json.dumps(prev, indent=1))


if __name__ == "__main__":
    main()
