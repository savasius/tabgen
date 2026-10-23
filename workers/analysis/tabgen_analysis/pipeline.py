"""End-to-end analysis: audio file -> analysis.json (chords + tab).

Chords, key, tuning, transcription, fingering, and techniques all listen to the
isolated guitar stem (or guitar+other on 6-stem bleed). Beat This! stays on the
mix so drums can stabilize the grid. The mix / harmonic.wav are never chord or tab input.
"""

import logging
import time
from pathlib import Path
from typing import Callable

from . import config
from .cache import cached_json, write_json_atomic
from .device import run_with_timeout
from .stages import beats as beats_stage
from .stages import chords as chords_stage
from .stages import key as key_stage
from .stages import post, separate, structure
from .stages import tabs as tabs_stage
from .stages import transcribe as transcribe_stage
from .fingering import STANDARD_TUNING
from .stages.decode import decode, probe_duration

log = logging.getLogger(__name__)

Progress = Callable[[str, int], None]


def analysis_path(audio_hash: str) -> Path:
    return config.track_dir(audio_hash) / f"analysis@{config.PIPELINE_VERSION}.json"


def find_analysis(audio_hash: str) -> Path | None:
    current = analysis_path(audio_hash)
    if current.exists():
        return current
    track = config.track_dir(audio_hash)
    files = sorted(track.glob("analysis@*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def tab_musicxml_path(audio_hash: str) -> Path:
    return config.track_dir(audio_hash) / f"tab@{config.PIPELINE_VERSION}.musicxml"


def tab_alphatex_path(audio_hash: str) -> Path:
    return config.track_dir(audio_hash) / f"tab@{config.PIPELINE_VERSION}.alphatex"


def choose_beat_grid(bt: dict, aio: dict) -> tuple[dict, str]:
    """Beat This! is primary. Both trackers sometimes lock onto eighth notes; when Beat This! is
    fast (>130 BPM) and All-In-One reports exactly half, use All-In-One's grid (the felt tempo
    guitarists count, e.g. I'm Yours: 76 not 152)."""
    bpm_bt, bpm_aio = bt["bpm"], float(aio.get("bpm") or 0)
    if bpm_bt > 130 and bpm_aio and abs(bpm_bt / bpm_aio - 2) < 0.12 and len(aio.get("downbeats", [])) > 4:
        return {"beats": aio["beats"], "downbeats": aio["downbeats"], "bpm": round(bpm_aio, 1)}, "allin1"
    return bt, "beat_this"


def _stage(name: str, fn, required: bool, default=None):
    timeout = config.STAGE_TIMEOUTS.get(name)
    try:
        return run_with_timeout(name, fn, timeout)
    except Exception as e:
        noisy = not isinstance(e, (ModuleNotFoundError, TimeoutError))
        log.warning("stage %s failed: %s", name, e, exc_info=noisy)
        if required:
            raise
        return default


def run(input_path: Path, meta: dict | None = None, progress: Progress | None = None,
        audio_hash: str | None = None, force: bool = False) -> dict:
    progress = progress or (lambda stage, pct: None)
    timings: dict[str, float] = {}

    def timed(name: str, fn, required: bool = True, default=None):
        t0 = time.time()
        out = _stage(name, fn, required, default)
        timings[name] = round(time.time() - t0, 2)
        return out

    if audio_hash is None:
        progress("decoding", 2)
        t0 = time.time()
        audio_hash, track = decode(input_path)
        timings["decode"] = round(time.time() - t0, 2)
    else:
        track = config.track_dir(audio_hash)
    out_path = analysis_path(audio_hash)
    if out_path.exists() and not force:
        import json
        return json.loads(out_path.read_text())

    mix = track / "mix.wav"
    duration = probe_duration(mix)

    progress("separating", 8)
    # Required: a failed Demucs run must fail the job, not silently copy the mix into guitar.wav.
    stems = timed("separate", lambda: separate.separate(track), required=True)
    guitar = transcribe_stage.pick_guitar_source(stems, mix)
    guitar_path = guitar.path
    src_tag = guitar.cache_tag()
    sep_method = (separate.read_manifest(stems) or {}).get("method")

    progress("beats", 40)
    beats = timed("beats", lambda: cached_json(audio_hash, beats_stage.MODEL_KEY,
                                               lambda: beats_stage.track_beats(mix)))

    progress("sections", 50)
    struct = timed(
        "sections",
        lambda: cached_json(audio_hash, structure.MODEL_KEY, lambda: structure.analyze_structure(stems)),
        required=False,
        default={"bpm": beats.get("bpm", 0), "beats": beats.get("beats", []),
                 "downbeats": beats.get("downbeats", []), "segments": []},
    )

    progress("chords", 60)
    recognizer = chords_stage.get_recognizer()
    raw_chords = timed(
        "chords",
        lambda: cached_json(
            audio_hash, f"{recognizer.key}-src-{src_tag}",
            lambda: chords_stage.recognize(guitar_path, recognizer)),
        required=False,
        default=[{"start": 0.0, "end": duration, "label": "N"}],
    )

    progress("key", 70)
    key = timed(
        "key",
        lambda: cached_json(
            audio_hash, f"{key_stage.MODEL_KEY}-src-{src_tag}",
            lambda: key_stage.detect_key(guitar_path)),
        required=False,
        default={"tonic": "C", "mode": "major", "confidence": 0},
    )
    tuning = cached_json(
        audio_hash, f"tuning-librosa-src-{src_tag}",
        lambda: key_stage.estimate_tuning(guitar_path),
    )

    beats, beat_source = choose_beat_grid(beats, struct)
    beats = post.fold_tempo_octave(beats, duration)
    intervals = post._beat_intervals(beats["beats"], duration)
    beat_labels = post.collapse_power_qualities(post.chord_per_beat(raw_chords, intervals))
    grid, bars, ts, merged = post.rebuild_after_labels(
        beats, beat_labels, intervals, struct.get("segments") or [], duration)
    key = post.reconcile_relative_key(key, merged)

    progress("transcribe", 80)
    raw_notes = timed(
        "transcribe",
        lambda: cached_json(
            audio_hash, f"{transcribe_stage.MODEL_KEY}-src-{src_tag}",
            lambda: transcribe_stage.transcribe(guitar_path, list(STANDARD_TUNING))),
        required=False,
        default={"notes": [], "model": None, "tabcnn": {"available": False}, "n_notes": 0},
    )
    beat_labels = post.collapse_missing_thirds(beat_labels, intervals, raw_notes.get("notes") or [])
    grid, bars, ts, merged = post.rebuild_after_labels(
        beats, beat_labels, intervals, struct.get("segments") or [], duration)
    key = post.reconcile_relative_key(key, merged)
    sections = post.snap_sections(struct.get("segments") or [], beats["downbeats"], duration)

    progress("tab", 90)
    title = (meta or {}).get("title") or audio_hash

    def _build():
        return tabs_stage.build_tab(
            raw_notes, beats=beats["beats"], bars=bars, sections=sections, chords=merged,
            duration=duration, bpm=beats["bpm"], ts=ts, title=title, guitar_path=guitar_path, capo=0,
        )

    tab = timed("tab", _build, required=False, default=None)
    if tab is None:
        tab = tabs_stage.empty_tab("tab-stage-failed", bars=bars, beats=beats["beats"],
                                   duration=duration, bpm=beats["bpm"], ts=ts, title=title)
    xml = tab.pop("musicxml", None)
    if xml:
        tab_musicxml_path(audio_hash).write_text(xml)
    tab_alphatex_path(audio_hash).write_text(tab.get("alpha_tex") or "")
    tab.setdefault("stats", {})["guitar_source"] = guitar.source
    tab["stats"]["guitar_rms"] = round(float(guitar.rms), 5)

    warnings = []
    if guitar.warning:
        warnings.append({
            "code": "guitar-empty" if guitar.empty else "guitar-weak",
            "message": guitar.warning,
        })

    progress("finalizing", 96)
    analysis = {
        "id": audio_hash,
        "version": config.PIPELINE_VERSION,
        "meta": {"title": None, "artist": None, "source": None, **(meta or {})},
        "duration": round(duration, 3),
        "tempo": {"bpm": beats["bpm"], "bpm_allin1": struct.get("bpm"), "time_signature": ts,
                  "beat_source": beat_source, "tempo_folded": beats.get("tempo_folded")},
        "beats": beats["beats"],
        "downbeats": beats["downbeats"],
        "key": key,
        "tuning": tuning,
        "sections": sections,
        "chords": merged,
        "grid": grid,
        "bars": bars,
        "tab": {k: v for k, v in tab.items() if k != "musicxml"},
        "raw_chords": raw_chords,
        "guitar": {
            "source": guitar.source,
            "rms": round(float(guitar.rms), 5),
            "mix_rms": round(float(guitar.mix_rms), 5),
            "ratio": round(float(guitar.ratio), 4),
            "warning": guitar.warning,
            "empty": guitar.empty,
            "separation": sep_method,
        },
        "audio": {
            "mix": f"/v1/analyses/{audio_hash}/audio?stem=mix",
            "original": f"/v1/analyses/{audio_hash}/audio?stem=original",
            "guitar": f"/v1/analyses/{audio_hash}/audio?stem=guitar",
        },
        "warnings": warnings,
        "models": {"separation": separate.MODEL_NAME, "beats": beats_stage.MODEL_KEY,
                   "sections": structure.MODEL_KEY, "chords": recognizer.key, "chord_input": src_tag,
                   "key": key_stage.MODEL_KEY, "tab": transcribe_stage.MODEL_KEY, "device": config.DEVICE,
                   "demucs_device": config.demucs_device(), "guitar_source": guitar.source,
                   "separation_method": sep_method},
        "timings": timings,
        "created_at": time.time(),
    }
    write_json_atomic(out_path, analysis)
    progress("done", 100)
    return analysis
