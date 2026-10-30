"""End-to-end analysis: audio file -> analysis.json (chords + tab).

Chords, key, tuning, transcription, fingering, and techniques all listen to the
isolated guitar stem (or guitar+other on 6-stem bleed). Beat This! stays on the
mix so drums can stabilize the grid. The mix / harmonic.wav are never chord or tab input.
"""

import logging
import time
from pathlib import Path
from typing import Callable

from . import config, edits
from .cache import cached_json, write_json_atomic
from .device import run_with_timeout
from .stages import beats as beats_stage
from .stages import chords as chords_stage
from .stages import guitar_parts
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


def part_musicxml_path(audio_hash: str, part_id: str) -> Path:
    return config.track_dir(audio_hash) / f"tab@{config.PIPELINE_VERSION}.{part_id}.musicxml"


# A half-time grid holding more played notes per beat than this is too slow to read (fast jazz /
# bossa comping at 150-200 BPM came out at half speed). Fitted with eval/tempo_bench.py --fit.
HALF_TIME_MAX_NOTES_PER_BEAT = 4.0


def choose_beat_grid(bt: dict, aio: dict, n_notes: int | None = None,
                     duration: float | None = None) -> tuple[dict, str]:
    """Beat This! is primary. Both trackers sometimes lock onto eighth notes; when Beat This! is
    fast (>130 BPM) and All-In-One reports exactly half, use All-In-One's grid (the felt tempo
    guitarists count, e.g. I'm Yours: 76 not 152) — unless the guitar plays so many notes that the
    half-time bars would be crammed, which means the fast grid was the real beat."""
    bpm_bt, bpm_aio = bt["bpm"], float(aio.get("bpm") or 0)
    if bpm_bt > 130 and bpm_aio and abs(bpm_bt / bpm_aio - 2) < 0.12 and len(aio.get("downbeats", [])) > 4:
        if n_notes and duration:
            per_beat = n_notes / max(1.0, duration * bpm_aio / 60.0)
            if per_beat > HALF_TIME_MAX_NOTES_PER_BEAT:
                return bt, "beat_this"
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
    tuning = cached_json(
        audio_hash, f"tuning-librosa-src-{src_tag}",
        lambda: key_stage.estimate_tuning(guitar_path),
    )

    progress("transcribe", 80)
    raw_notes = timed(
        "transcribe",
        lambda: cached_json(
            audio_hash, f"{transcribe_stage.MODEL_KEY}-src-{src_tag}",
            lambda: transcribe_stage.transcribe(guitar_path, list(STANDARD_TUNING))),
        required=False,
        default={"notes": [], "model": None, "tabcnn": {"available": False}, "n_notes": 0},
    )
    n_notes = len(raw_notes.get("notes") or []) if raw_notes.get("model") else None
    key = timed(
        "key", lambda: key_stage.detect_key_notes(raw_notes.get("notes") or [], guitar_path),
        required=False, default={"tonic": "C", "mode": "major", "confidence": 0},
    )
    beats, beat_source = choose_beat_grid(beats, struct, n_notes, duration)
    beats = post.fold_tempo_octave(beats, duration)
    tempo_factor = (edits.load(audio_hash) or {}).get("tempo_factor")
    if tempo_factor:
        beats = post.scale_tempo(beats, float(tempo_factor), duration)
    intervals = post._beat_intervals(beats["beats"], duration)
    beat_labels = post.collapse_power_qualities(post.chord_per_beat(raw_chords, intervals))
    grid, bars, ts, merged = post.rebuild_after_labels(
        beats, beat_labels, intervals, struct.get("segments") or [], duration)
    key = post.reconcile_relative_key(key, merged)

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

    # Several guitars in the stem (panned apart, or a lead line over comping): one tab each.
    # The whole-stem tab above stays as "all guitars" so older clients keep working.
    progress("parts", 93)
    found = timed("parts", lambda: guitar_parts.find_parts(
        audio_hash, guitar_path, raw_notes, list(STANDARD_TUNING)), required=False, default=[])
    parts_out = []
    for part in guitar_parts.order(found or []):
        pchords, pgrid = merged, None
        if part["split"] == "stereo" and part["role"] != "lead":
            praw = cached_json(
                audio_hash, f"{recognizer.key}-src-{part['tag']}",
                lambda part=part: chords_stage.recognize(part["audio"], recognizer))
            labels = post.collapse_power_qualities(post.chord_per_beat(praw, intervals))
            labels = post.collapse_missing_thirds(labels, intervals, part["raw"]["notes"])
            pgrid, _b, _ts, pchords = post.rebuild_after_labels(
                beats, labels, intervals, struct.get("segments") or [], duration)
        ptab = timed(f"tab-{part['id']}", lambda part=part, pchords=pchords: tabs_stage.build_tab(
            part["raw"], beats=beats["beats"], bars=bars, sections=sections, chords=pchords,
            duration=duration, bpm=beats["bpm"], ts=ts, title=title, guitar_path=part["audio"], capo=0,
        ), required=False, default=None)
        if not ptab:
            continue
        pxml = ptab.pop("musicxml", None)
        if pxml:
            part_musicxml_path(audio_hash, part["id"]).write_text(pxml)
        parts_out.append({
            "id": part["id"], "role": part["role"], "pan": part["pan"],
            "side": guitar_parts.pan_label(part["pan"]), "share": part["share"], "split": part["split"],
            "chords": pchords, "grid": pgrid, "chords_source": "part" if pgrid else "song",
            "audio": (f"/v1/analyses/{audio_hash}/audio?stem=guitar&part={part['id']}"
                      if part["split"] == "stereo" else f"/v1/analyses/{audio_hash}/audio?stem=guitar"),
            "tab": ptab,
        })
    if len(parts_out) < 2:
        parts_out = []

    warnings = []
    if not raw_notes.get("model"):
        # Never silent: without notes the tab is chord-shape guesswork (this is what a broken
        # basic-pitch install looked like — every song "worked" but the tab was nonsense).
        warnings.append({
            "code": "transcribe-failed",
            "message": "Note transcription failed on the guitar stem; the tab is a chord-shape guess. "
                       "Check the server log and re-run setup, then reanalyze.",
        })
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
                  "beat_source": beat_source, "tempo_folded": beats.get("tempo_folded"),
                  "tempo_user": beats.get("tempo_user")},
        "beats": beats["beats"],
        "downbeats": beats["downbeats"],
        "key": key,
        "tuning": tuning,
        "sections": sections,
        "chords": merged,
        "grid": grid,
        "bars": bars,
        "tab": {k: v for k, v in tab.items() if k != "musicxml"},
        "parts": parts_out,
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
                   "key": key_stage.MODEL_KEY, "tab": transcribe_stage.MODEL_KEY,
                   "parts": guitar_parts.MODEL_KEY, "device": config.DEVICE,
                   "demucs_device": config.demucs_device(), "guitar_source": guitar.source,
                   "separation_method": sep_method},
        "timings": timings,
        "created_at": time.time(),
    }
    write_json_atomic(out_path, analysis)
    # what the library list shows, without parsing the full analysis for every song
    write_json_atomic(config.track_dir(audio_hash) / "summary.json",
                      {"version": config.PIPELINE_VERSION, "guitars": max(1, len(parts_out)),
                       "bpm": beats["bpm"], "key": f"{key.get('tonic')} {key.get('mode')}"})
    progress("done", 100)
    return analysis
