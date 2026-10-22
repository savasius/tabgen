"""Decode any input with ffmpeg into canonical files and compute the content hash."""

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from ..config import MAX_DURATION_S, track_dir

SR = 44100


class DecodeError(RuntimeError):
    pass


def _ffmpeg(*args: str) -> None:
    proc = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise DecodeError(proc.stderr.strip() or "ffmpeg failed")


def probe_duration(path: Path) -> float:
    proc = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
                          capture_output=True, text=True)
    try:
        return float(json.loads(proc.stdout)["format"]["duration"])
    except Exception as e:
        raise DecodeError(f"Unreadable audio file: {proc.stderr.strip()}") from e


def probe_tags(path: Path) -> dict:
    proc = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags=title,artist", "-of", "json",
                           str(path)], capture_output=True, text=True)
    try:
        tags = {k.lower(): v for k, v in json.loads(proc.stdout)["format"].get("tags", {}).items()}
    except Exception:
        return {}
    return {k: tags[k] for k in ("title", "artist") if tags.get(k)}


def decode(input_path: Path) -> tuple[str, Path]:
    """Returns (audio_hash, track_dir). Writes mix.wav (44.1k stereo) and playback.mp3.

    The hash is sha256 of the decoded PCM, so the same song in different containers
    or tags maps to the same cache entry (re-encodes at other bitrates will not).
    """
    duration = probe_duration(input_path)
    if duration > MAX_DURATION_S:
        raise DecodeError(f"Song too long ({duration:.0f}s > {MAX_DURATION_S:.0f}s)")

    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "mix.wav"
        _ffmpeg("-i", str(input_path), "-vn", "-ac", "2", "-ar", str(SR), "-c:a", "pcm_s16le", str(wav))
        h = hashlib.sha256()
        with open(wav, "rb") as f:
            f.seek(44)
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        audio_hash = h.hexdigest()[:20]
        d = track_dir(audio_hash)
        if not (d / "mix.wav").exists():
            shutil.move(str(wav), d / "mix.wav")
    if not (d / "playback.mp3").exists():
        tmp_mp3 = d / "playback.tmp.mp3"
        _ffmpeg("-i", str(d / "mix.wav"), "-c:a", "libmp3lame", "-b:a", "192k", str(tmp_mp3))
        os.replace(tmp_mp3, d / "playback.mp3")
    return audio_hash, d
