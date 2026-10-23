"""Guitar stem is the source of truth: never mix, never harmonic, never silent mix-copy."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from tabgen_analysis import config, pipeline
from tabgen_analysis.stages import beats as beats_stage
from tabgen_analysis.stages import chords as chords_stage
from tabgen_analysis.stages import key as key_stage
from tabgen_analysis.stages import separate, structure
from tabgen_analysis.stages import tabs as tabs_stage
from tabgen_analysis.stages import transcribe as transcribe_stage
from tabgen_analysis.stages.separate import resolve_playback
from tabgen_analysis.stages.transcribe import (
    WARN_EMPTY,
    WARN_WEAK,
    GuitarSource,
    GuitarStemError,
    pick_guitar_source,
)


def _tone(path: Path, freq: float = 220.0, amp: float = 0.25, sr: int = 22050, dur: float = 0.5):
    path.parent.mkdir(parents=True, exist_ok=True)
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    y = (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    sf.write(str(path), np.stack([y, y], axis=1), sr)


def _silence(path: Path, sr: int = 22050, dur: float = 0.5):
    path.parent.mkdir(parents=True, exist_ok=True)
    n = int(sr * dur)
    sf.write(str(path), np.zeros((n, 2), dtype=np.float32), sr)


def _stems(tmp: Path) -> tuple[Path, Path]:
    mix = tmp / "mix.wav"
    stems = tmp / "stems"
    stems.mkdir()
    _tone(mix, freq=80, amp=0.5)
    return mix, stems


def test_strong_guitar_is_used(tmp_path):
    mix, stems = _stems(tmp_path)
    _tone(stems / "guitar.wav", freq=220, amp=0.3)
    _tone(stems / "harmonic.wav", freq=80, amp=0.5)
    src = pick_guitar_source(stems, mix)
    assert src.source == "guitar"
    assert src.path.name == "guitar.wav"
    assert src.warning is None
    assert not src.empty
    assert src.cache_tag() == "guitar"


def test_never_returns_mix_or_harmonic_when_guitar_is_weak(tmp_path):
    mix, stems = _stems(tmp_path)
    _tone(stems / "guitar.wav", freq=220, amp=0.004)
    _tone(stems / "other.wav", freq=330, amp=0.004)
    _tone(stems / "harmonic.wav", freq=80, amp=0.5)
    src = pick_guitar_source(stems, mix)
    assert src.path.name not in {"mix.wav", "harmonic.wav"}
    assert src.source in {"guitar", "guitar+other", "guitar-weak"}
    assert src.warning
    assert mix.resolve() != src.path.resolve()


def test_missing_guitar_raises_not_mix(tmp_path):
    mix, stems = _stems(tmp_path)
    _tone(stems / "harmonic.wav", freq=80, amp=0.5)
    with pytest.raises(GuitarStemError, match="not used as a fallback"):
        pick_guitar_source(stems, mix)


def test_none_stems_raises():
    with pytest.raises(GuitarStemError, match="not used as a fallback"):
        pick_guitar_source(None, Path("/nope/mix.wav"))  # type: ignore[arg-type]


def test_empty_guitar_warns_and_stays_on_guitar(tmp_path):
    mix, stems = _stems(tmp_path)
    _silence(stems / "guitar.wav")
    _silence(stems / "other.wav")
    src = pick_guitar_source(stems, mix)
    assert src.path.name == "guitar.wav"
    assert src.empty
    assert src.warning == WARN_EMPTY
    assert src.source == "guitar-weak"


def test_weak_guitar_plus_other_not_harmonic(tmp_path):
    mix, stems = _stems(tmp_path)
    _tone(stems / "guitar.wav", freq=220, amp=0.004)
    _tone(stems / "other.wav", freq=330, amp=0.35)
    _tone(stems / "harmonic.wav", freq=80, amp=0.5)
    src = pick_guitar_source(stems, mix)
    assert src.source == "guitar+other"
    assert src.path.name == "guitar_plus_other.wav"
    assert src.warning is None
    assert src.cache_tag() == "guitarplusother"


def test_mix_copy_stems_are_not_ready(tmp_path):
    track = tmp_path / "track"
    track.mkdir()
    mix = track / "mix.wav"
    _tone(mix, freq=100, amp=0.4)
    d = separate.stems_dir(track)
    d.mkdir(parents=True)
    for n in (*separate.SIX_STEMS, *separate.DERIVED):
        import shutil
        shutil.copyfile(mix, d / f"{n}.wav")
    assert not separate.stems_ready(d, mix)
    separate.write_manifest(d, "eval")
    assert not separate.stems_ready(d, mix)


def test_demucs_manifest_is_ready(tmp_path):
    track = tmp_path / "track"
    track.mkdir()
    mix = track / "mix.wav"
    _tone(mix, freq=80, amp=0.4)
    d = separate.stems_dir(track)
    d.mkdir(parents=True)
    _tone(d / "guitar.wav", freq=220, amp=0.2)
    for n in ("drums", "bass", "other", "vocals", "piano", "other4", "harmonic"):
        _tone(d / f"{n}.wav", freq=40, amp=0.05)
    separate.write_manifest(d, "demucs")
    assert separate.stems_ready(d, mix)


def test_legacy_real_stems_recovered(tmp_path):
    track = tmp_path / "track"
    track.mkdir()
    mix = track / "mix.wav"
    _tone(mix, freq=80, amp=0.4)
    d = separate.stems_dir(track)
    d.mkdir(parents=True)
    _tone(d / "guitar.wav", freq=220, amp=0.2)
    for n in ("drums", "bass", "other", "vocals", "piano", "other4", "harmonic"):
        _tone(d / f"{n}.wav", freq=40, amp=0.05)
    assert separate.stems_ready(d, mix)
    assert (separate.read_manifest(d) or {}).get("method") == "demucs"


def test_skip_separate_writes_eval_manifest(tmp_path, monkeypatch):
    monkeypatch.setattr(separate, "SKIP_SEPARATE", True)
    track = tmp_path / "track"
    track.mkdir()
    _tone(track / "mix.wav", freq=110, amp=0.3)
    d = separate.separate(track)
    assert (separate.read_manifest(d) or {}).get("method") == "eval"
    src = pick_guitar_source(d, track / "mix.wav")
    assert src.source == "guitar"
    assert src.path.name == "guitar.wav"


def test_resolve_playback_stems(tmp_path):
    track = tmp_path / "track"
    track.mkdir()
    _tone(track / "mix.wav")
    (track / "playback.mp3").write_bytes(b"fake-mp3")
    d = separate.stems_dir(track)
    _tone(d / "guitar.wav", freq=220, amp=0.2)
    mix_path, mix_media = resolve_playback(track, "mix")
    assert mix_path.name == "playback.mp3"
    assert mix_media == "audio/mpeg"
    orig, _ = resolve_playback(track, "original")
    assert orig == mix_path
    g, g_media = resolve_playback(track, "guitar")
    assert g.name == "guitar.wav"
    assert g_media == "audio/wav"
    g2, _ = resolve_playback(track, "gitar")
    assert g2 == g
    with pytest.raises(ValueError, match="Unknown stem"):
        resolve_playback(track, "drums")
    with pytest.raises(FileNotFoundError, match="Guitar stem"):
        resolve_playback(tmp_path / "empty", "guitar")


def _install_pipeline_mocks(monkeypatch, seen: dict, stems: Path):
    monkeypatch.setattr(pipeline, "probe_duration", lambda p: 2.0)
    monkeypatch.setattr(separate, "separate", lambda track: stems)
    monkeypatch.setattr(
        beats_stage, "track_beats",
        lambda p: {"bpm": 120.0, "beats": [0.0, 0.5, 1.0, 1.5], "downbeats": [0.0]},
    )
    monkeypatch.setattr(
        structure, "analyze_structure",
        lambda s: {"bpm": 120, "beats": [0.0, 0.5, 1.0, 1.5], "downbeats": [0.0], "segments": []},
    )

    class Rec:
        key = "mock-chords"

    monkeypatch.setattr(chords_stage, "get_recognizer", lambda: Rec())

    def recognize(path, recognizer):
        seen["chords"] = Path(path).resolve()
        return [{"start": 0.0, "end": 2.0, "label": "C:maj", "confidence": 1}]

    monkeypatch.setattr(chords_stage, "recognize", recognize)

    def detect_key(path):
        seen["key"] = Path(path).resolve()
        return {"tonic": "C", "mode": "major", "confidence": 1}

    monkeypatch.setattr(key_stage, "detect_key", detect_key)

    def estimate_tuning(path):
        seen["tuning"] = Path(path).resolve()
        return {"a4_hz": 440.0, "cents": 0, "guess": "standard"}

    monkeypatch.setattr(key_stage, "estimate_tuning", estimate_tuning)

    def transcribe(path, tuning):
        seen["transcribe"] = Path(path).resolve()
        return {"notes": [{"start": 0.0, "end": 0.4, "midi": 60, "velocity": 0.8, "confidence": 0.8}],
                "model": "mock", "tabcnn": {"available": False}, "n_notes": 1}

    monkeypatch.setattr(transcribe_stage, "transcribe", transcribe)

    def build_tab(*args, **kwargs):
        seen["tab_guitar"] = Path(kwargs["guitar_path"]).resolve()
        return {"alpha_tex": "", "notes": [], "stats": {}, "technique_legend": {}}

    monkeypatch.setattr(tabs_stage, "build_tab", build_tab)


def test_pipeline_chords_key_tabs_use_guitar_not_harmonic(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "CHORD_INPUT", "harmonic")
    audio_hash = "a" * 20
    track = config.track_dir(audio_hash)
    mix = track / "mix.wav"
    _tone(mix, freq=80, amp=0.45)
    stems = separate.stems_dir(track)
    _tone(stems / "guitar.wav", freq=220, amp=0.25)
    _tone(stems / "harmonic.wav", freq=80, amp=0.45)
    for n in ("drums", "bass", "other", "vocals", "piano", "other4"):
        _tone(stems / f"{n}.wav", freq=40, amp=0.04)
    separate.write_manifest(stems, "demucs")

    seen: dict = {}
    _install_pipeline_mocks(monkeypatch, seen, stems)
    out = pipeline.run(mix, audio_hash=audio_hash, force=True, meta={"title": "t"})

    guitar = (stems / "guitar.wav").resolve()
    harmonic = (stems / "harmonic.wav").resolve()
    assert seen["chords"] == guitar
    assert seen["key"] == guitar
    assert seen["tuning"] == guitar
    assert seen["transcribe"] == guitar
    assert seen["tab_guitar"] == guitar
    assert seen["chords"] != harmonic
    assert out["models"]["chord_input"] == "guitar"
    assert out["guitar"]["source"] == "guitar"
    assert out["guitar"]["warning"] is None
    assert out["audio"]["guitar"].endswith("?stem=guitar")
    assert "guitarstem" in out["version"]


def test_pipeline_separate_failure_does_not_copy_mix(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    audio_hash = "b" * 20
    track = config.track_dir(audio_hash)
    mix = track / "mix.wav"
    _tone(mix, freq=80, amp=0.4)
    monkeypatch.setattr(pipeline, "probe_duration", lambda p: 2.0)

    def boom(_track):
        raise separate.SeparationError("demucs exploded")

    monkeypatch.setattr(separate, "separate", boom)
    with pytest.raises(separate.SeparationError, match="demucs exploded"):
        pipeline.run(mix, audio_hash=audio_hash, force=True)
    d = separate.stems_dir(track)
    assert not (d / "guitar.wav").exists()


def test_weak_guitar_warning_on_analysis(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    audio_hash = "c" * 20
    track = config.track_dir(audio_hash)
    mix = track / "mix.wav"
    _tone(mix, freq=80, amp=0.5)
    stems = separate.stems_dir(track)
    _silence(stems / "guitar.wav")
    _silence(stems / "other.wav")
    _tone(stems / "harmonic.wav", freq=80, amp=0.5)
    for n in ("drums", "bass", "vocals", "piano", "other4"):
        _silence(stems / f"{n}.wav")
    separate.write_manifest(stems, "demucs")
    seen: dict = {}
    _install_pipeline_mocks(monkeypatch, seen, stems)
    out = pipeline.run(mix, audio_hash=audio_hash, force=True)
    assert seen["chords"] == (stems / "guitar.wav").resolve()
    assert seen["chords"].name != "harmonic.wav"
    assert out["guitar"]["empty"] is True
    assert out["guitar"]["warning"] == WARN_EMPTY
    assert out["warnings"][0]["code"] == "guitar-empty"
    assert WARN_WEAK  # sanity: constants imported
    assert isinstance(out["guitar"], dict)


def test_guitar_source_dataclass_never_names_mix():
    src = GuitarSource(path=Path("guitar.wav"), source="guitar-weak", rms=0.0,
                       mix_rms=0.2, ratio=0.0, warning=WARN_EMPTY, empty=True)
    assert "mix" not in src.source
    assert "harmonic" not in src.source
