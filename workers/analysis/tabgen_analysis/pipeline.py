"""End-to-end analysis: audio file -> analysis.json (see docs in README)."""

import logging
import time
from pathlib import Path
from typing import Callable

from . import config
from .cache import cached_json, write_json_atomic
from .stages import beats as beats_stage
from .stages import chords as chords_stage
from .stages import key as key_stage
from .stages import post, separate, structure
from .stages.decode import decode, probe_duration

log = logging.getLogger(__name__)

Progress = Callable[[str, int], None]


def analysis_path(audio_hash: str) -> Path:
    return config.track_dir(audio_hash) / f"analysis@{config.PIPELINE_VERSION}.json"


def choose_beat_grid(bt: dict, aio: dict) -> tuple[dict, str]:
    """Beat This! is primary. Both trackers sometimes lock onto eighth notes; when Beat This! is
    fast (>130 BPM) and All-In-One reports exactly half, use All-In-One's grid (the felt tempo
    guitarists count, e.g. I'm Yours: 76 not 152)."""
    bpm_bt, bpm_aio = bt["bpm"], float(aio.get("bpm") or 0)
    if bpm_bt > 130 and bpm_aio and abs(bpm_bt / bpm_aio - 2) < 0.12 and len(aio.get("downbeats", [])) > 4:
        return {"beats": aio["beats"], "downbeats": aio["downbeats"], "bpm": round(bpm_aio, 1)}, "allin1"
    return bt, "beat_this"


def run(input_path: Path, meta: dict | None = None, progress: Progress | None = None,
        audio_hash: str | None = None) -> dict:
    progress = progress or (lambda stage, pct: None)
    timings: dict[str, float] = {}

    def timed(name: str, fn):
        t0 = time.time()
        out = fn()
        timings[name] = round(time.time() - t0, 2)
        return out

    if audio_hash is None:
        progress("decoding", 2)
        audio_hash, track = timed("decode", lambda: decode(input_path))
    else:
        track = config.track_dir(audio_hash)
    out_path = analysis_path(audio_hash)
    if out_path.exists():
        import json
        return json.loads(out_path.read_text())

    mix = track / "mix.wav"
    duration = probe_duration(mix)

    progress("separating", 8)
    stems = timed("separate", lambda: separate.separate(track))

    progress("beats", 45)
    beats = timed("beats", lambda: cached_json(audio_hash, beats_stage.MODEL_KEY,
                                               lambda: beats_stage.track_beats(mix)))

    progress("sections", 55)
    struct = timed("sections", lambda: cached_json(audio_hash, structure.MODEL_KEY,
                                                   lambda: structure.analyze_structure(stems)))

    progress("chords", 70)
    recognizer = chords_stage.get_recognizer()
    chord_input = stems / "harmonic.wav" if config.CHORD_INPUT == "harmonic" else mix
    raw_chords = timed("chords", lambda: cached_json(
        audio_hash, f"{recognizer.key}-{config.CHORD_INPUT}",
        lambda: chords_stage.recognize(chord_input, recognizer)))

    progress("key", 90)
    key = timed("key", lambda: cached_json(audio_hash, key_stage.MODEL_KEY, lambda: key_stage.detect_key(mix)))
    tuning = cached_json(audio_hash, "tuning-librosa", lambda: key_stage.estimate_tuning(stems / "harmonic.wav"))

    progress("finalizing", 96)
    beats, beat_source = choose_beat_grid(beats, struct)
    intervals = post._beat_intervals(beats["beats"], duration)
    beat_labels = post.chord_per_beat(raw_chords, intervals)
    sections = post.snap_sections(struct["segments"], beats["downbeats"], duration)
    grid, bars, ts = post.build_grid(beats["beats"], beats["downbeats"], beat_labels, intervals, sections)

    analysis = {
        "id": audio_hash,
        "version": config.PIPELINE_VERSION,
        "meta": {"title": None, "artist": None, "source": None, **(meta or {})},
        "duration": round(duration, 3),
        "tempo": {"bpm": beats["bpm"], "bpm_allin1": struct["bpm"], "time_signature": ts, "beat_source": beat_source},
        "beats": beats["beats"],
        "downbeats": beats["downbeats"],
        "key": key,
        "tuning": tuning,
        "sections": sections,
        "chords": post.merge_chords(grid),
        "grid": grid,
        "bars": bars,
        "raw_chords": raw_chords,
        "models": {"separation": separate.MODEL_NAME, "beats": beats_stage.MODEL_KEY,
                   "sections": structure.MODEL_KEY, "chords": recognizer.key, "chord_input": config.CHORD_INPUT,
                   "key": key_stage.MODEL_KEY, "device": config.DEVICE},
        "timings": timings,
        "created_at": time.time(),
    }
    write_json_atomic(out_path, analysis)
    progress("done", 100)
    return analysis
