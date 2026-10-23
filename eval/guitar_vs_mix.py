"""Prove chords + tabs hear the isolated guitar, not the mix.

Builds a rights-free guitar loop, buries it under bass / drums / vocal-ish distractors
in a different key, injects a fake Demucs guitar stem (no Demucs run), then scores:

- full pipeline on the guitar stem (what the app does after p2.3)
- lv-chordia + Basic Pitch on the mix (what the app used to do)

The mix path must not win. Writes data/eval/guitar_vs_mix.json.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

os.environ["TABGEN_SKIP_SEPARATE"] = "0"
os.environ.setdefault("TABGEN_DATA_DIR", str(Path(__file__).resolve().parents[1] / "data"))

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(REPO / "workers" / "analysis"))
sys.path.insert(0, str(HERE))

from score import chord_scores, tab_f1  # noqa: E402
from synth import SR, render_one, songs  # noqa: E402
from tabgen_analysis import config, pipeline  # noqa: E402
from tabgen_analysis.fingering import STANDARD_TUNING  # noqa: E402
from tabgen_analysis.stages import chords as chords_stage  # noqa: E402
from tabgen_analysis.stages import separate  # noqa: E402
from tabgen_analysis.stages import transcribe as transcribe_stage  # noqa: E402
from tabgen_analysis.stages.decode import decode  # noqa: E402


def _peak(y: np.ndarray, amp: float) -> np.ndarray:
    p = float(np.max(np.abs(y))) or 1.0
    return (amp * y / p).astype(np.float32)


def distractors(n: int, sr: int, bpm: float) -> dict[str, np.ndarray]:
    rng = np.random.default_rng(3)
    t = np.arange(n) / sr
    beat = max(1, int(sr * 60.0 / bpm))

    drums = np.zeros(n, dtype=np.float32)
    for i in range(0, n, beat):
        burst = rng.normal(0, 1, min(int(0.045 * sr), n - i)).astype(np.float32)
        burst *= np.linspace(1.0, 0.0, len(burst))
        drums[i: i + len(burst)] += burst
    drums = _peak(drums, 0.55)

    # Eb2 — off the B major guitar loop, loud enough to pull a mix-based chord model.
    bass = (np.sin(2 * np.pi * 77.78 * t) * (0.55 + 0.45 * np.sin(2 * np.pi * (bpm / 120.0) * t)))
    bass = _peak(bass.astype(np.float32), 0.5)

    # C#5 “vocal” — another off-key pitch the mix would hear.
    vox = np.sin(2 * np.pi * 554.37 * t) * np.exp(-2.5 * (t % 0.5))
    vox = _peak(vox.astype(np.float32), 0.32)

    # C-major pad — a second harmonic world the mix-based chord model will hear.
    piano = (
        np.sin(2 * np.pi * 130.81 * t)
        + 0.8 * np.sin(2 * np.pi * 164.81 * t)
        + 0.7 * np.sin(2 * np.pi * 196.00 * t)
    ).astype(np.float32)
    piano = _peak(piano, 0.55)
    other = np.zeros(n, dtype=np.float32)
    return {"drums": drums, "bass": bass, "vocals": vox, "piano": piano, "other": other}


def _stereo(y: np.ndarray) -> np.ndarray:
    y = np.asarray(y, dtype=np.float32)
    if y.ndim == 1:
        return np.stack([y, y], axis=1)
    return y


def write_stems(d: Path, guitar: np.ndarray, parts: dict[str, np.ndarray], sr: int) -> None:
    d.mkdir(parents=True, exist_ok=True)
    g = guitar.astype(np.float32)
    n = len(g)
    aligned = {k: np.pad(v, (0, max(0, n - len(v))))[:n].astype(np.float32) for k, v in parts.items()}
    sf.write(d / "guitar.wav", _stereo(g), sr)
    for name in ("drums", "bass", "other", "vocals", "piano"):
        sf.write(d / f"{name}.wav", _stereo(aligned[name]), sr)
    other4 = g + aligned["piano"] + aligned["other"]
    harmonic = other4 + aligned["bass"]
    sf.write(d / "other4.wav", _stereo(_peak(other4, 0.9)), sr)
    sf.write(d / "harmonic.wav", _stereo(_peak(harmonic, 0.9)), sr)
    separate.write_manifest(d, "demucs")


def segs_to_analysis(segs: list[dict], notes: list[dict]) -> dict:
    grid = [{"t": s["start"], "end": s["end"], "bar": 0, "pos": 0, "chord": s["label"]} for s in segs]
    return {"grid": grid, "tab": {"notes": notes}}


def main() -> dict:
    np.random.seed(0)
    spec = next(s for s in songs() if s["id"] == "major-loop")
    out_dir = REPO / "data" / "eval"
    ref = render_one(spec, out_dir)
    guitar, sr = sf.read(ref["wav"], dtype="float32")
    if guitar.ndim == 2:
        guitar = guitar.mean(axis=1)
    n = len(guitar)
    parts = distractors(n, sr, spec["bpm"])
    mix = guitar.astype(np.float32).copy()
    for v in parts.values():
        mix += v[:n]
    mix = _peak(mix, 0.95)
    mix_path = out_dir / "major-loop-with-distractors.wav"
    sf.write(mix_path, _stereo(mix), sr)
    guitar_path = out_dir / "major-loop-guitar-only.wav"
    sf.write(guitar_path, _stereo(guitar), sr)

    audio_hash, track = decode(mix_path)
    write_stems(separate.stems_dir(track), guitar, parts, sr)

    analysis = pipeline.run(
        mix_path,
        meta={"title": "Guitar vs mix (major-loop + distractors)", "source": "eval"},
        audio_hash=audio_hash,
        force=True,
    )
    guitar_scored = {
        "chords": chord_scores(analysis, ref["expect_basic"]),
        "tab": tab_f1((analysis.get("tab") or {}).get("notes") or [], ref.get("notes") or []),
        "key": analysis.get("key"),
        "guitar": analysis.get("guitar"),
        "chord_input": (analysis.get("models") or {}).get("chord_input"),
        "guitar_source": (analysis.get("models") or {}).get("guitar_source"),
    }

    rec = chords_stage.get_recognizer()
    mix_chords = chords_stage.recognize(mix_path, rec)
    mix_notes = transcribe_stage.transcribe(mix_path, list(STANDARD_TUNING)).get("notes") or []
    mix_scored = {
        "chords": chord_scores(segs_to_analysis(mix_chords, mix_notes), ref["expect_basic"]),
        "tab": tab_f1(mix_notes, ref.get("notes") or []),
    }
    # Old pipeline default: chords on harmonic.wav = mix − vocals − drums (still bass+piano).
    harmonic_path = separate.stems_dir(track) / "harmonic.wav"
    harm_chords = chords_stage.recognize(harmonic_path, rec)
    harmonic_scored = {
        "chords": chord_scores(segs_to_analysis(harm_chords, []), ref["expect_basic"]),
    }

    result = {
        "id": "guitar-vs-mix",
        "expect_basic": ref["expect_basic"],
        "pipeline_version": config.PIPELINE_VERSION,
        "guitar_stem": guitar_scored,
        "mix_baseline": mix_scored,
        "harmonic_baseline": harmonic_scored,
        "proof": {
            "chord_input_is_guitar": guitar_scored["chord_input"] in ("guitar", "guitarplusother"),
            "never_harmonic_or_mix": guitar_scored["guitar_source"] not in ("mix", "harmonic"),
            "guitar_chord_family_ge_mix": (
                guitar_scored["chords"]["family"] >= mix_scored["chords"]["family"]
            ),
            "guitar_tab_f1_ge_mix": guitar_scored["tab"]["f1"] >= mix_scored["tab"]["f1"],
        },
    }
    out = out_dir / "guitar_vs_mix.json"
    out.write_text(json.dumps(result, indent=2, default=str))
    print(json.dumps(result, indent=2, default=str))
    print("wrote", out)
    if not result["proof"]["chord_input_is_guitar"]:
        raise SystemExit("FAIL: pipeline chord_input is not guitar")
    if not result["proof"]["never_harmonic_or_mix"]:
        raise SystemExit("FAIL: guitar_source fell back to mix/harmonic")
    # The mix is supposed to be worse (or no better) on at least one of chords/tabs.
    if result["proof"]["guitar_chord_family_ge_mix"] or result["proof"]["guitar_tab_f1_ge_mix"]:
        return result
    raise SystemExit("FAIL: mix scored strictly better on both chords and tabs")


if __name__ == "__main__":
    main()
