"""Batch note transcriber using YourMT3+ (eval backend only, not part of the app).

Setup (once; everything lands in gitignored data/eval/):

    GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://huggingface.co/spaces/mimbres/YourMT3-cpu data/eval/vendor/YourMT3
    (cd data/eval/vendor/YourMT3 && git lfs pull --include="amt/logs/2024/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops/checkpoints/last.ckpt")
    ~/.local/bin/uv venv --python 3.11 data/eval/venvs/yourmt3
    VIRTUAL_ENV=data/eval/venvs/yourmt3 ~/.local/bin/uv pip install "torch==2.4.1" "torchaudio==2.4.1" \
        "lightning>=2.2.1,<2.5" "pytorch-lightning>=2.2.1,<2.5" deprecated einops "transformers==4.44.2" \
        mido librosa soundfile "numpy<2" mir_eval wandb pretty_midi torchmetrics matplotlib

Run with the dedicated venv:

    data/eval/venvs/yourmt3/bin/python eval/backends/yourmt3_runner.py \
        --out-dir DIR [--device cpu|mps|auto] wav1 wav2 ...

For each input wav writes DIR/<stem>.json:
    {"notes": [{"start", "end", "midi", "velocity", "confidence", "program",
                "source": "yourmt3"}, ...], "sec": runtime_seconds, "model": "<checkpoint id>"}

YourMT3 code (vendored at data/eval/vendor/YourMT3, from the HF Space
mimbres/YourMT3-cpu) is GPL-3.0 (GitHub repo) / Apache-2.0 (Space headers).
It is imported at runtime from the vendor dir and never shipped with the app.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
import time
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
VENDOR = Path(os.environ.get("YOURMT3_DIR", REPO / "data/eval/vendor/YourMT3"))

PROJECT = "2024"
CKPT = "mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops@last.ckpt"
MODEL_ID = f"YourMT3+ YPTF.MoE+Multi (noPS) {PROJECT}/{CKPT}"
MODEL_ARGS = [CKPT, "-p", PROJECT, "-tk", "mc13_full_plus_256", "-dec", "multi-t5",
              "-nl", "26", "-enc", "perceiver-tf", "-sqr", "1", "-ff", "moe",
              "-wf", "4", "-nmoe", "8", "-kmoe", "2", "-act", "silu", "-epe", "rope",
              "-rp", "1", "-ac", "spec", "-hop", "300", "-atc", "1", "-pr", "32"]

GUITAR_PROGRAMS = set(range(24, 32))


def load_model(device: str):
    import torch
    sys.path.insert(0, str(VENDOR / "amt/src"))
    sys.path.insert(0, str(VENDOR))
    cwd = os.getcwd()
    os.chdir(VENDOR)  # config uses save_dir="amt/logs" relative to the Space root
    try:
        with contextlib.redirect_stdout(sys.stderr):
            from model_helper import load_model_checkpoint
            model = load_model_checkpoint(args=MODEL_ARGS)
    finally:
        os.chdir(cwd)
    if device == "auto":
        device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = model.to(device).eval()
    return model, device


def transcribe(model, device: str, wav: Path, bsz: int):
    import torch
    import torchaudio
    from utils.audio import slice_padded_array
    from utils.note2event import mix_notes
    from utils.event2note import merge_zipped_note_events_and_ties_to_notes

    audio, sr = torchaudio.load(str(wav))
    audio = torch.mean(audio, dim=0).unsqueeze(0)
    audio = torchaudio.functional.resample(audio, sr, model.audio_cfg["sample_rate"])
    frames = model.audio_cfg["input_frames"]
    segs = slice_padded_array(audio, frames, frames)
    segs = torch.from_numpy(segs.astype("float32")).to(device).unsqueeze(1)

    with torch.inference_mode():
        pred_token_arr, _ = model.inference_file(bsz=bsz, audio_segments=segs)

    n_items = segs.shape[0]
    start_secs = [frames * i / model.audio_cfg["sample_rate"] for i in range(n_items)]
    per_ch = []
    err = Counter()
    for ch in range(model.task_manager.num_decoding_channels):
        arr_ch = [a[:, ch, :] for a in pred_token_arr]
        zipped, _, _ = model.task_manager.detokenize_list_batches(arr_ch, start_secs, return_events=True)
        notes_ch, e = merge_zipped_note_events_and_ties_to_notes(zipped)
        per_ch.append(notes_ch)
        err += e
    return mix_notes(per_ch)


def to_records(notes):
    pitched = [n for n in notes if not n.is_drum]
    guitar = [n for n in pitched if n.program in GUITAR_PROGRAMS]
    keep = guitar if guitar else pitched
    out = []
    for n in sorted(keep, key=lambda n: (n.onset, n.pitch)):
        vel = float(n.velocity)
        vel = vel / 127.0 if vel > 1 else 0.7  # mc13 task ignores velocity (0/1)
        out.append({
            "start": round(float(n.onset), 4),
            "end": round(float(max(n.offset, n.onset + 0.01)), 4),
            "midi": int(n.pitch),
            "velocity": round(min(max(vel, 0.0), 1.0), 4),
            "confidence": 1.0,  # autoregressive decoder gives no per-note score
            "program": int(n.program) if n.program is not None else None,
            "source": "yourmt3",
        })
    return out, len(guitar), len(pitched)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--device", default="cpu", choices=["cpu", "mps", "auto"])
    ap.add_argument("--bsz", type=int, default=8)
    ap.add_argument("wavs", nargs="+", type=Path)
    a = ap.parse_args()
    a.out_dir.mkdir(parents=True, exist_ok=True)

    todo = [w for w in a.wavs if not (a.out_dir / f"{w.stem}.json").exists()]
    print(f"[yourmt3] {len(todo)}/{len(a.wavs)} to do", file=sys.stderr)
    if not todo:
        return
    t0 = time.time()
    model, device = load_model(a.device)
    print(f"[yourmt3] model loaded on {device} in {time.time() - t0:.1f}s", file=sys.stderr)

    for w in todo:
        t = time.time()
        with contextlib.redirect_stdout(sys.stderr):
            notes = transcribe(model, device, w.resolve(), a.bsz)
        recs, n_gtr, n_pitched = to_records(notes)
        sec = time.time() - t
        out = {"notes": recs, "sec": round(sec, 3), "model": MODEL_ID}
        tmp = a.out_dir / f"{w.stem}.json.tmp"
        tmp.write_text(json.dumps(out))
        tmp.replace(a.out_dir / f"{w.stem}.json")
        print(f"[yourmt3] {w.name}: {len(recs)} notes (guitar {n_gtr}/{n_pitched} pitched) {sec:.1f}s",
              file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
