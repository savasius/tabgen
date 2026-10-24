"""Multi-guitar benchmark: can we tell the guitars apart and give each its own tab?

Scenes are built from GuitarSet, where every piece was recorded by six players to the same
click: one player's comping + another player's solo over the same changes is a realistic
two-guitar arrangement with string/fret truth for both. Layouts:

  mono2  comp + solo, both centred (no stereo cue: hardest)
  lc2    comp left, solo centre (one rhythm guitar + lead)
  lr2    comp left, solo right
  dbl3   comp (player A) left, comp (player B) right, solo centre (double-tracked rhythm + lead)
  rr2    two comping guitars left/right, no lead (must not invent one)

Split: dev = solo 00 / comp 01 / comp 02 (tune here), test = solo 05 / comp 04 / comp 03.
`--band` puts drums/bass/pad on top and runs Demucs, as the app does (slow on CPU).

Methods:
  single       one tab of the whole stem (what the app did before)
  oracle       each guitar transcribed from its own clean track (upper bound for separation)
  stereo       stereo-position split, one tab per pan cluster
  role         lead/rhythm split of the notes (mono)
  auto         what the app runs: stereo split when it finds 2+ guitars, else lead/rhythm split
               when the part looks mixed (role-splitting an already-panned part was measured and hurt)

Metrics (per scene, then mean): parts found vs real; part_tab_f1 = mean over the real guitars
of the tab F1 of the predicted part matched to it (Hungarian; unmatched = 0); union_tab_f1 =
all notes of all guitars together (does splitting lose notes?); assign = of the correctly heard
notes, share that landed in the right guitar's tab.

  PYTHONPATH=workers/analysis .venv/bin/python eval/multi_bench.py --split dev
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "workers" / "analysis"))
sys.path.insert(0, str(HERE))

from tab_bench import DATA, GS, _band, _distort, _jams_notes, run_backend, score  # noqa: E402
from tabgen_analysis import fingering, parts as parts_mod, techniques  # noqa: E402
from tabgen_analysis.fingering import STANDARD_TUNING  # noqa: E402
from tabgen_analysis.stages import transcribe as tr  # noqa: E402

OUT = DATA / "multi"
SPLITS = {"dev": ("00", "01", "02"), "test": ("05", "04", "03")}
LAYOUTS = {
    "mono2": [("comp", 0.0), ("solo", 0.0)],
    "lc2": [("comp", -0.7), ("solo", 0.0)],
    "lr2": [("comp", -0.8), ("solo", 0.6)],
    "dbl3": [("comp", -0.85), ("comp2", 0.85), ("solo", 0.0)],
    "rr2": [("comp", -0.8), ("comp2", 0.8)],
}
METHODS = ("single", "oracle", "stereo", "role", "auto")


def _pieces() -> list[str]:
    ann = next((GS / "annotation").rglob("*.jams")).parent
    return sorted({p.stem[3:].rsplit("_", 1)[0] for p in ann.glob("00_*.jams")})


def _track(player: str, piece: str, kind: str) -> tuple[np.ndarray, list[dict]]:
    ann = next((GS / "annotation").rglob("*.jams")).parent
    audio = next((GS / "audio").rglob("*_mic.wav")).parent
    name = f"{player}_{piece}_{kind}"
    y, _ = sf.read(str(audio / f"{name}_mic.wav"), dtype="float32")
    notes, _b = _jams_notes(ann / f"{name}.jams")
    return (y.mean(axis=1) if y.ndim == 2 else y), notes


def _pan(y: np.ndarray, p: float) -> np.ndarray:
    th = (p + 1) * np.pi / 4
    return np.stack([np.cos(th) * y, np.sin(th) * y], axis=1)


def scene(piece: str, layout: str, split: str, band: bool, dist_solo: bool) -> dict:
    solo_p, comp_p, comp2_p = SPLITS[split]
    who = {"comp": (comp_p, "comp"), "comp2": (comp2_p, "comp"), "solo": (solo_p, "solo")}
    sid = f"{split}-{layout}{'-band' if band else ''}{'-dsolo' if dist_solo else ''}-{piece}"
    d = OUT / sid
    meta = d / "scene.json"
    if meta.exists():
        return json.loads(meta.read_text())
    d.mkdir(parents=True, exist_ok=True)
    sr = 44100
    tracks, refs = [], []
    for role, pan in LAYOUTS[layout]:
        player, kind = who[role]
        y, notes = _track(player, piece, kind)
        y = y / (np.sqrt(np.mean(y ** 2)) + 1e-9) * (1.25 if role == "solo" else 1.0)
        if role == "solo" and dist_solo:
            y = _distort(y, sr) / 0.8 * 1.0
            y = y / (np.sqrt(np.mean(y ** 2)) + 1e-9) * 1.25
        solo_path = d / f"{role}.wav"
        sf.write(str(solo_path), (0.1 * y).astype(np.float32), sr)
        tracks.append(_pan(y, pan))
        refs.append({"role": role, "pan": pan, "player": player, "notes": notes, "wav": str(solo_path)})
    n = min(len(t) for t in tracks)
    gtr = sum(t[:n] for t in tracks)
    peak = np.abs(gtr).max() + 1e-9
    gtr = 0.9 * gtr / peak
    stem_path = d / "stem.wav"
    if band:
        all_notes = [nt for r in refs for nt in r["notes"]]
        b = _band(sr, n, all_notes, seed=int(hashlib.md5(sid.encode()).hexdigest()[:6], 16))
        b = np.stack([b, b], axis=1)
        mix = gtr / (np.sqrt(np.mean(gtr ** 2)) + 1e-9) + 1.4 * b / (np.sqrt(np.mean(b ** 2)) + 1e-9)
        mix = (0.9 * mix / np.abs(mix).max()).astype(np.float32)
        sf.write(str(d / "mix.wav"), mix, sr)
        sf.write(str(stem_path), _demucs_stereo(d / "mix.wav"), sr)
    else:
        sf.write(str(stem_path), gtr.astype(np.float32), sr)
    out = {"id": sid, "piece": piece, "layout": layout, "stem": str(stem_path), "refs": refs}
    meta.write_text(json.dumps(out))
    return out


def _demucs_stereo(mix_path: Path) -> np.ndarray:
    import tempfile
    from tabgen_analysis.stages import separate
    with tempfile.TemporaryDirectory() as td:
        track = Path(td)
        y, sr = sf.read(str(mix_path), dtype="float32")
        sf.write(str(track / "mix.wav"), y, sr)
        stems = separate.separate(track)
        g, _ = sf.read(str(stems / "guitar.wav"), dtype="float32")
        return g


# ---------------------------------------------------------------- methods


def _wav(dirpath: Path, name: str, y: np.ndarray, sr: int = 44100) -> Path:
    p = dirpath / f"{name}.wav"
    if not p.exists():
        sf.write(str(p), y.astype(np.float32), sr)
    return p


def _raw(wav: Path) -> list[dict]:
    notes = [dict(n) for n in run_backend("bp", wav)["notes"]]
    return tr.clean_notes(notes)


def _finger(notes: list[dict], wav: Path) -> list[dict]:
    a = techniques.load_audio(wav)
    notes = [dict(n) for n in notes]
    techniques.attach_onsets(notes, a)
    notes = techniques.resolve_continuations(techniques.merge_split_bends(notes, a))
    placed = fingering.assign_notes_v2(notes, tuning=list(STANDARD_TUNING))
    return [n for n in placed if n.get("string_i") is not None]


def _stereo(sc: dict) -> list[tuple[Path, list[dict]]]:
    d = Path(sc["stem"]).parent
    y, sr = sf.read(sc["stem"], dtype="float32")
    found = parts_mod.stereo_parts(y)
    tag = hashlib.md5(repr((parts_mod.MASK_SIGMA, parts_mod.MIN_SHARE, parts_mod.VALLEY)).encode()).hexdigest()[:6]
    wavs = [_wav(d, f"pan{k}-{p.pan:+.2f}-{tag}", p.audio) for k, p in enumerate(found)]
    notes = parts_mod.dedupe_bleed([_raw(w) for w in wavs]) if len(wavs) > 1 else [_raw(wavs[0])]
    return list(zip(wavs, notes))


def predict(sc: dict, method: str, role_params: dict | None = None) -> list[dict]:
    """[{role, notes}] per predicted guitar (role: lead | rhythm)."""
    d = Path(sc["stem"]).parent
    if method == "oracle":
        return [{"role": "lead" if r["role"] == "solo" else "rhythm",
                 "notes": _finger(_raw(Path(r["wav"])), Path(r["wav"]))} for r in sc["refs"]]
    if method in ("single", "role", "role-always"):
        y, _ = sf.read(sc["stem"], dtype="float32")
        mono = _wav(d, "mono", y.mean(axis=1))
        notes = _raw(mono)
        kind = parts_mod.classify_part(notes)
        if method in ("role", "role-always"):
            sp = parts_mod.split_roles(notes, role_params) if method == "role-always" or kind == "mixed" else None
            if sp:
                return [{"role": "lead", "notes": _finger(sp[0], mono)},
                        {"role": "rhythm", "notes": _finger(sp[1], mono)}]
        return [{"role": "lead" if kind == "lead" else "rhythm", "notes": _finger(notes, mono)}]
    groups = _stereo(sc)
    if method == "auto" and len(groups) == 1:
        return predict(sc, "role", role_params)
    roles = parts_mod.assign_roles([n for _w, n in groups])
    return [{"role": r, "notes": _finger(notes, wav)} for (wav, notes), r in zip(groups, roles)]


# ---------------------------------------------------------------- scoring


def evaluate(sc: dict, pred: list[dict]) -> dict:
    from scipy.optimize import linear_sum_assignment
    refs = [r["notes"] for r in sc["refs"]]
    est = [p["notes"] for p in pred]
    tab = np.array([[score(r, e)["tab_f1"] if e else 0.0 for e in est] for r in refs])
    note = np.array([[score(r, e)["note_f1"] if e else 0.0 for e in est] for r in refs])
    ri, ei = linear_sum_assignment(-tab)
    matched = dict(zip(ri, ei))
    part_tab = [tab[i, matched[i]] if i in matched else 0.0 for i in range(len(refs))]
    part_note = [note[i, matched[i]] if i in matched else 0.0 for i in range(len(refs))]
    all_ref = sorted((n for r in refs for n in r), key=lambda n: n["start"])
    all_est = sorted((n for e in est for n in e), key=lambda n: n["start"])
    u = score(all_ref, all_est)
    # assignment: correctly-heard notes that sit in the tab matched to their own guitar
    from tab_bench import _mir
    owner_ref = [k for k, r in enumerate(refs) for _ in r]
    ref_flat = [n for r in refs for n in r]
    owner_est = [k for k, e in enumerate(est) for _ in e]
    est_flat = [n for e in est for n in e]
    _p, _r, _f, match = _mir(ref_flat, est_flat)
    ok = sum(1 for i, j in match if matched.get(owner_ref[i]) == owner_est[j])
    true_role = ["lead" if r["role"] == "solo" else "rhythm" for r in sc["refs"]]
    role_ok = [float(pred[matched[i]]["role"] == true_role[i]) if i in matched else 0.0 for i in range(len(refs))]
    extra_leads = sum(1 for k, p in enumerate(pred) if p["role"] == "lead" and k not in matched.values())
    return {"n_ref": len(refs), "n_est": len(est), "count_ok": float(len(est) == len(refs)),
            "role_ok": float(np.mean(role_ok)) if extra_leads == 0 else 0.0,
            "part_tab_f1": float(np.mean(part_tab)), "part_note_f1": float(np.mean(part_note)),
            "union_note_f1": u["note_f1"], "union_tab_f1": u["tab_f1"],
            "assign": ok / max(1, len(match)),
            "per_role": {sc["refs"][i]["role"]: round(float(part_tab[i]), 4) for i in range(len(refs))}}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="dev")
    ap.add_argument("--layouts", default=",".join(LAYOUTS))
    ap.add_argument("--methods", default=",".join(METHODS))
    ap.add_argument("--limit", type=int)
    ap.add_argument("--band", action="store_true")
    ap.add_argument("--dist-solo", action="store_true", help="distorted lead guitar")
    ap.add_argument("--role-params", default="", help="JSON overrides for split_roles")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    role_params = json.loads(args.role_params) if args.role_params else None
    pieces = _pieces()[: args.limit] if args.limit else _pieces()
    results = {}
    for layout in args.layouts.split(","):
        scenes = [scene(p, layout, args.split, args.band, args.dist_solo) for p in pieces]
        for method in args.methods.split(","):
            rows = [dict(evaluate(sc, predict(sc, method, role_params)), id=sc["id"]) for sc in scenes]
            agg = {k: round(float(np.mean([r[k] for r in rows])), 4)
                   for k in ("count_ok", "n_est", "role_ok", "part_tab_f1", "part_note_f1", "union_tab_f1", "assign")}
            roles = {}
            for r in rows:
                for k, v in r["per_role"].items():
                    roles.setdefault(k, []).append(v)
            agg.update({f"{k}_tab": round(float(np.mean(v)), 4) for k, v in roles.items()})
            results.setdefault(layout, {})[method] = {"mean": agg, "scenes": rows}
            print(f"{layout:6s} {method:12s} " + " ".join(f"{k}={v}" for k, v in agg.items()), flush=True)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(results, indent=1))


if __name__ == "__main__":
    main()
