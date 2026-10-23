"""Score an analysis JSON against eval/refs/*.json (chords + optional tab notes)."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from tabgen_analysis.chord_label import parse, pc

ROOT = Path(__file__).resolve().parent


def _sym(label: str) -> str:
    c = parse(parse(label).level("basic"))
    if c.is_none or c.root is None:
        return "N"
    if c.quality == "5":
        return c.root + "5"
    return c.root + ("m" if c.quality == "min" else "")


def _family(sym: str) -> str:
    return sym.rstrip("5").rstrip("m")


def _parse_expect(s: str) -> set[str]:
    out = set()
    for tok in s.split():
        out.add(_sym(tok if ":" in tok else (
            f"{tok[:-1]}:5" if tok.endswith("5") else
            f"{tok[:-1]}:min" if tok.endswith("m") else f"{tok}:maj"
        )))
    return out


def chord_scores(analysis: dict, expect: str) -> dict:
    expected = _parse_expect(expect)
    expected_roots = {_family(s) for s in expected}
    voiced = [_sym(g["chord"]) for g in analysis["grid"] if _sym(g["chord"]) != "N"]
    if not voiced:
        return {"vocab_strict": 0.0, "family": 0.0, "n": 0, "top": []}
    fam = sum(_family(b) in expected_roots for b in voiced) / len(voiced)
    strict = sum(
        b in expected or (b.endswith("5") and (_family(b) in expected or _family(b) + "m" in expected))
        for b in voiced
    ) / len(voiced)
    from collections import Counter
    return {"vocab_strict": round(strict, 3), "family": round(fam, 3), "n": len(voiced),
            "top": Counter(voiced).most_common(6)}


def key_score(analysis: dict, expect: dict) -> dict:
    got_t, got_m = analysis["key"]["tonic"], analysis["key"]["mode"]
    exp_t, exp_m = expect["tonic"], expect["mode"]
    exact = pc(got_t) == pc(exp_t) and got_m == exp_m
    rel_pc = (pc(exp_t) + (9 if exp_m == "major" else 3)) % 12
    relative = pc(got_t) == rel_pc and got_m != exp_m
    return {"exact": exact, "relative": relative, "got": f"{got_t} {got_m}"}


TECH_TYPES = ("bend", "vibrato", "hammer", "pull", "slide")


def _tech_type(t) -> str | None:
    if isinstance(t, str):
        return t if t in TECH_TYPES else None
    if isinstance(t, dict):
        k = t.get("type")
        return k if k in TECH_TYPES else None
    return None


def technique_scores(pred_notes: list[dict], gt_notes: list[dict], *,
                     events: list[dict] | None = None, clean_until: float | None = None,
                     window: float = 0.28) -> dict:
    """Match predicted technique tags to timed ground-truth events.

    Empty `events` means the clip should have no techniques (e.g. a picked scale);
    every predicted tag is then a false positive. `clean_until` counts tags that
    landed on the opening picked region even when later events exist.
    """
    evs = list(events) if events is not None else []
    if not evs:
        for g in gt_notes:
            for t in g.get("techniques") or []:
                typ = _tech_type(t)
                if typ:
                    evs.append({"type": typ, "t": float(g["start"]), "midi": g.get("midi")})

    pred: list[dict] = []
    confs: list[float] = []
    for n in pred_notes:
        for t in n.get("techniques") or []:
            typ = _tech_type(t)
            if not typ:
                continue
            pred.append({"type": typ, "t": float(n["start"]), "midi": n.get("midi")})
            confs.append(float(t.get("confidence") or 0.0))

    per = {k: {"tp": 0, "fp": 0, "fn": 0} for k in TECH_TYPES}
    used = [False] * len(pred)
    tp = 0
    for ev in evs:
        best = None
        for i, p in enumerate(pred):
            if used[i] or p["type"] != ev["type"]:
                continue
            d = abs(p["t"] - float(ev["t"]))
            if d <= window and (best is None or d < best[0]):
                best = (d, i)
        if best:
            used[best[1]] = True
            tp += 1
            per[ev["type"]]["tp"] += 1
        else:
            per[ev["type"]]["fn"] += 1
    fp = 0
    for i, p in enumerate(pred):
        if not used[i]:
            fp += 1
            per[p["type"]]["fp"] += 1
    fn = len(evs) - tp
    prec = 1.0 if (tp + fp) == 0 else tp / (tp + fp)
    rec = 1.0 if (tp + fn) == 0 else tp / (tp + fn)
    f1 = 0.0 if prec + rec == 0 else 2 * prec * rec / (prec + rec)
    clean_fp = sum(1 for p in pred if clean_until is not None and p["t"] < clean_until)
    return {
        "precision": round(prec, 3),
        "recall": round(rec, 3),
        "f1": round(f1, 3),
        "tp": tp, "fp": fp, "fn": fn,
        "n_pred_tags": len(pred),
        "n_gt": len(evs),
        "clean_fp": clean_fp,
        "mean_confidence": round(sum(confs) / len(confs), 3) if confs else None,
        "per_type": {k: v for k, v in per.items() if v["tp"] or v["fp"] or v["fn"]},
    }


def tab_f1(pred_notes: list[dict], gt_notes: list[dict], window: float = 0.10) -> dict:
    used = [False] * len(gt_notes)
    tp = 0
    for p in pred_notes:
        best = None
        for i, g in enumerate(gt_notes):
            if used[i] or int(g["midi"]) != int(p["midi"]):
                continue
            d = abs(float(p["start"]) - float(g["start"]))
            if d <= window and (best is None or d < best[0]):
                best = (d, i)
        if best:
            used[best[1]] = True
            tp += 1
    fp = len(pred_notes) - tp
    fn = len(gt_notes) - tp
    prec = tp / max(1, tp + fp)
    rec = tp / max(1, tp + fn)
    f1 = 0.0 if prec + rec == 0 else 2 * prec * rec / (prec + rec)
    spans = []
    for n in pred_notes:
        # same-time group span check is done globally in fingering tests
        spans.append(n.get("fret") or 0)
    return {"precision": round(prec, 3), "recall": round(rec, 3), "f1": round(f1, 3),
            "tp": tp, "fp": fp, "fn": fn, "n_pred": len(pred_notes), "n_gt": len(gt_notes)}


def score_file(analysis_path: Path, ref: dict) -> dict:
    a = json.loads(analysis_path.read_text())
    out = {
        "id": ref["id"],
        "title": ref["title"],
        "chords": chord_scores(a, ref["expect_basic"]),
        "key": key_score(a, ref["key"]),
        "bpm_got": a.get("tempo", {}).get("bpm"),
        "bpm_exp": ref["bpm"],
        "tab": tab_f1((a.get("tab") or {}).get("notes") or [], ref.get("notes") or []),
        "techniques": technique_scores(
            (a.get("tab") or {}).get("notes") or [],
            ref.get("notes") or [],
            events=ref.get("techniques") or [],
            clean_until=ref.get("clean_until"),
        ),
        "timings": a.get("timings"),
        "tab_stats": (a.get("tab") or {}).get("stats"),
        "relative_adjusted": a.get("key", {}).get("relative_adjusted"),
    }
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("analysis", type=Path)
    ap.add_argument("--ref", type=Path, required=True)
    args = ap.parse_args()
    ref = json.loads(args.ref.read_text())
    print(json.dumps(score_file(args.analysis, ref), indent=2, default=str))


if __name__ == "__main__":
    main()
