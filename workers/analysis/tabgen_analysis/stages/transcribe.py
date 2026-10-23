"""Guitar-stem transcription: Basic Pitch (notes + contours) and optional TabCNN-GPFX.

TabCNN is a string/fret prior at each onset; Basic Pitch remains the source of
timing, MIDI pitch, and pitch-bend. Either model failing is non-fatal.
"""

from __future__ import annotations

import hashlib
import logging
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import models_dir

log = logging.getLogger(__name__)

# v5: cache key includes guitar-stem routing so mix/harmonic transcriptions are not reused.
MODEL_KEY = "bp-0.4-onnx-tabcnn-gpfx-v5-guitar"

WEAK_RATIO = 0.08
EMPTY_RMS = 1e-4
EMPTY_RATIO = 0.01

WARN_WEAK = (
    "Guitar stem is quiet compared to the mix. Chords and tabs still used the isolated "
    "guitar (never the full mix, vocals, drums, or bass)."
)
WARN_EMPTY = (
    "Guitar stem is empty or near-silent. Chords and tabs were NOT computed from the mix. "
    "Results will be empty or unreliable — the track may have no separable guitar."
)


class GuitarStemError(RuntimeError):
    """No usable guitar stem. Callers must not fall back to the mix."""


@dataclass(frozen=True)
class GuitarSource:
    path: Path
    source: str  # guitar | guitar+other | guitar-weak
    rms: float
    mix_rms: float
    ratio: float
    warning: str | None = None
    empty: bool = False

    def cache_tag(self) -> str:
        if self.source == "guitar+other":
            return "guitarplusother"
        return "guitar"

TABCNN_URL = "https://huggingface.co/cstr/tabcnn-onnx/resolve/main/tabcnn-gpfx.onnx"
TABCNN_SHA256 = "8d9ce59157bdab37fb4816d32d7f29f3da0cdbf3c7876707c819af4d1f88e6b7"

# Guitar-ish MIDI range (Drop D through high E).
MIN_HZ = 65.0
MAX_HZ = 1320.0
TABCNN_HOP = 512 / 22050  # seconds

_bp_model = None
_tabcnn_sess = None


def tabcnn_path() -> Path:
    return models_dir() / "tabcnn-gpfx.onnx"


def ensure_tabcnn() -> Path | None:
    path = tabcnn_path()
    if path.exists() and path.stat().st_size > 1000:
        return path
    tmp = path.with_suffix(".part")
    try:
        log.info("Downloading TabCNN-GPFX ONNX")
        urllib.request.urlretrieve(TABCNN_URL, tmp)
        digest = hashlib.sha256(tmp.read_bytes()).hexdigest()
        if digest != TABCNN_SHA256:
            raise ValueError(f"tabcnn checksum mismatch ({digest})")
        tmp.replace(path)
        return path
    except Exception as e:
        log.warning("TabCNN download failed: %s", e)
        tmp.unlink(missing_ok=True)
        return path if path.exists() else None


def _bp():
    global _bp_model
    if _bp_model is None:
        from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
        from basic_pitch.inference import Model
        _bp_model = Model(build_icassp_2022_model_path(FilenameSuffix.onnx))
    return _bp_model


def _tabcnn():
    global _tabcnn_sess
    if _tabcnn_sess is False:
        return None
    if _tabcnn_sess is None:
        path = ensure_tabcnn()
        if not path:
            _tabcnn_sess = False
            return None
        try:
            import onnxruntime as ort
            _tabcnn_sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        except Exception as e:
            log.warning("TabCNN session failed: %s", e)
            _tabcnn_sess = False
            return None
    return _tabcnn_sess


def rms_path(path: Path) -> float:
    wav, _sr = sf.read(str(path), dtype="float32", always_2d=False)
    mono = wav.mean(axis=1) if getattr(wav, "ndim", 1) == 2 else wav
    return float(np.sqrt((mono.astype(np.float64) ** 2).mean() + 1e-16))


def _as_2d(wav: np.ndarray) -> np.ndarray:
    return wav[:, None] if getattr(wav, "ndim", 1) == 1 else wav


def sum_wavs(a: Path, b: Path, dest: Path) -> None:
    aw, sr = sf.read(str(a), dtype="float32")
    bw, _ = sf.read(str(b), dtype="float32")
    aw, bw = _as_2d(aw), _as_2d(bw)
    n = min(len(aw), len(bw))
    ch = min(aw.shape[1], bw.shape[1])
    mixed = aw[:n, :ch] + bw[:n, :ch]
    peak = float(np.abs(mixed).max()) or 1.0
    if peak > 1.0:
        mixed = mixed / peak
    sf.write(str(dest), mixed, sr)


def pick_guitar_source(stems: Path, mix: Path) -> GuitarSource:
    """Isolated guitar (or guitar+other on 6-stem bleed). Never mix, never harmonic."""
    if stems is None:
        raise GuitarStemError(
            "No stem directory — Demucs did not run. The mix is not used as a fallback."
        )
    guitar = stems / "guitar.wav"
    if not guitar.exists():
        raise GuitarStemError(
            "Demucs did not write guitar.wav. The mix is not used as a fallback. "
            "Re-run analysis after fixing separation."
        )
    g = rms_path(guitar)
    m = rms_path(mix)
    chosen = GuitarSource(
        path=guitar, source="guitar", rms=g, mix_rms=m,
        ratio=g / max(m, 1e-9), warning=None, empty=False,
    )
    if chosen.ratio >= WEAK_RATIO and g >= EMPTY_RMS:
        return chosen

    other = stems / "other.wav"
    if other.exists():
        combo = stems / "guitar_plus_other.wav"
        sum_wavs(guitar, other, combo)
        c = rms_path(combo)
        c_ratio = c / max(m, 1e-9)
        if c_ratio > chosen.ratio * 1.25 and c >= EMPTY_RMS:
            chosen = GuitarSource(
                path=combo, source="guitar+other", rms=c, mix_rms=m,
                ratio=c_ratio, warning=None, empty=False,
            )
            if chosen.ratio >= WEAK_RATIO:
                return chosen

    empty = chosen.rms < EMPTY_RMS or chosen.ratio < EMPTY_RATIO
    warning = WARN_EMPTY if empty else WARN_WEAK
    source = "guitar-weak" if chosen.source == "guitar" else chosen.source
    log.warning("%s (source=%s rms=%.5f mix_rms=%.5f ratio=%.4f)",
                warning, source, chosen.rms, chosen.mix_rms, chosen.ratio)
    return GuitarSource(
        path=chosen.path, source=source, rms=chosen.rms, mix_rms=chosen.mix_rms,
        ratio=chosen.ratio, warning=warning, empty=empty,
    )


def transcribe_basic_pitch(audio_path: Path) -> list[dict]:
    import contextlib
    import io
    from basic_pitch.inference import predict

    with contextlib.redirect_stdout(io.StringIO()):
        _out, _midi, events = predict(
            str(audio_path),
            model_or_model_path=_bp(),
            multiple_pitch_bends=True,
            minimum_frequency=MIN_HZ,
            maximum_frequency=MAX_HZ,
            midi_tempo=120,
            # Slightly more sensitive than the vocal-oriented defaults: guitar
            # strums split energy across strings so onsets are weaker per pitch.
            onset_threshold=0.42,
            frame_threshold=0.28,
            minimum_note_length=90.0,
        )
    notes = []
    for start, end, pitch, vel, bends in events:
        conf = float(vel)
        notes.append({
            "start": round(float(start), 4),
            "end": round(float(end), 4),
            "midi": int(pitch),
            "velocity": round(conf, 4),
            "confidence": round(min(1.0, conf), 4),
            "bends": [int(b) for b in bends] if bends else None,
            "source": "basic-pitch",
            "low_confidence": conf < 0.35,
        })
    return notes


def _tabcnn_frames(audio_path: Path) -> tuple[np.ndarray, str] | tuple[None, None]:
    """Returns (frames [T,6,21] log-softmax, string_order guess later)."""
    sess = _tabcnn()
    if sess is None:
        return None, None
    import librosa
    y, _sr = librosa.load(str(audio_path), sr=22050, mono=True)
    if y.size < 2048:
        return None, None
    cqt = np.abs(librosa.cqt(y, sr=22050, hop_length=512, n_bins=192, bins_per_octave=24,
                             fmin=32.70315564769983))
    feats = librosa.amplitude_to_db(cqt, ref=np.max)
    feats = (feats - feats.min()) / (feats.max() - feats.min() + 1e-9)
    frames = np.swapaxes(feats, 0, 1).astype(np.float32)  # [T, 192]
    pad = np.pad(frames, ((4, 4), (0, 0)))
    windows = np.stack([pad[i:i + 9].T for i in range(len(frames))])[..., np.newaxis]
    out_chunks = []
    bs = 256
    inp_name = sess.get_inputs()[0].name
    for i in range(0, len(windows), bs):
        chunk = windows[i:i + bs]
        out_chunks.append(sess.run(None, {inp_name: chunk})[0])
    return np.concatenate(out_chunks, axis=0), "unknown"


def attach_tabcnn(notes: list[dict], audio_path: Path, tuning: list[int]) -> dict:
    """For each note, if a TabCNN string's implied MIDI matches, keep it as a fingering prior."""
    frames, _ = _tabcnn_frames(audio_path)
    meta = {"available": frames is not None, "string_order": None, "n_notes_matched": 0}
    if frames is None or not notes:
        return meta

    def implied(order: str, s: int, fret: int) -> int:
        # order low-to-high: index 0 = low E. high-to-low: index 0 = high E.
        if order == "high-to-low":
            s = 5 - s
        return int(tuning[s]) + int(fret)

    best_order, best_hits = "low-to-high", -1
    for order in ("low-to-high", "high-to-low"):
        hits = 0
        for n in notes:
            fi = min(int(round(float(n["start"]) / TABCNN_HOP)), len(frames) - 1)
            row = frames[fi]  # [6, 21]
            midi = int(n["midi"])
            for s in range(6):
                k = int(np.argmax(row[s]))
                if k == 0:
                    continue
                fret = k - 1
                if implied(order, s, fret) == midi:
                    hits += 1
                    break
        if hits > best_hits:
            best_hits, best_order = hits, order

    meta["string_order"] = best_order
    matched = 0
    for n in notes:
        fi = min(int(round(float(n["start"]) / TABCNN_HOP)), len(frames) - 1)
        row = frames[fi]
        midi = int(n["midi"])
        best = None
        for s in range(6):
            k = int(np.argmax(row[s]))
            if k == 0:
                continue
            fret = k - 1
            if implied(best_order, s, fret) != midi:
                continue
            # convert to internal low-E=0
            si = 5 - s if best_order == "high-to-low" else s
            lp = float(row[s, k])
            conf = float(np.exp(lp))  # logsoftmax
            cand = {"string": si, "fret": fret, "confidence": round(min(1.0, conf), 3)}
            if best is None or cand["confidence"] > best["confidence"]:
                best = cand
        if best:
            n["tabcnn"] = best
            matched += 1
    meta["n_notes_matched"] = matched
    return meta


def clean_notes(notes: list[dict], onset_merge: float = 0.045,
                harmonic_window: float = 0.10) -> list[dict]:
    """Merge overlapping same-MIDI events and drop quieter harmonic leftovers.

    Basic Pitch often emits a fundamental plus its octave, 12th, or a quiet
    high ghost a few tens of ms later. Keeping those inflates false-positive tabs.
    """
    if not notes:
        return notes
    ordered = sorted(notes, key=lambda n: (float(n["start"]), int(n["midi"])))
    merged: list[dict] = []
    for n in ordered:
        n = dict(n)
        if (merged and int(merged[-1]["midi"]) == int(n["midi"])
                and float(n["start"]) <= float(merged[-1]["end"]) + onset_merge):
            merged[-1]["end"] = max(float(merged[-1]["end"]), float(n["end"]))
            va = float(merged[-1].get("velocity") or 0)
            vb = float(n.get("velocity") or 0)
            if vb > va:
                merged[-1]["velocity"] = vb
                merged[-1]["confidence"] = float(n.get("confidence") or vb)
            continue
        merged.append(n)

    groups: list[list[dict]] = []
    for n in merged:
        if groups and float(n["start"]) - float(groups[-1][0]["start"]) <= harmonic_window:
            groups[-1].append(n)
        else:
            groups.append([n])
    out: list[dict] = []
    for g in groups:
        drop: set[int] = set()
        for i, a in enumerate(g):
            for j, b in enumerate(g):
                if i >= j:
                    continue
                ma, mb = int(a["midi"]), int(b["midi"])
                va = float(a.get("velocity") or a.get("confidence") or 0)
                vb = float(b.get("velocity") or b.get("confidence") or 0)
                # Octave, double-octave, or 12th (3rd harmonic).
                if abs(ma - mb) in (12, 19, 24):
                    higher = i if ma > mb else j
                    quieter = i if va < vb else j
                    drop.add(higher if abs(va - vb) < 0.12 else quieter)
                    continue
                # Quiet high ghost sitting on a louder lower note.
                if abs(ma - mb) >= 12:
                    higher, lower = (i, j) if ma > mb else (j, i)
                    hi_v = float(g[higher].get("velocity") or g[higher].get("confidence") or 0)
                    lo_v = float(g[lower].get("velocity") or g[lower].get("confidence") or 0)
                    if hi_v <= 0.55 * lo_v + 0.02:
                        drop.add(higher)
        out.extend(n for i, n in enumerate(g) if i not in drop)
    out.sort(key=lambda n: (float(n["start"]), int(n["midi"])))
    return out


def transcribe(audio_path: Path, tuning: list[int]) -> dict:
    notes = clean_notes(transcribe_basic_pitch(audio_path))
    tabcnn_meta = {"available": False}
    try:
        tabcnn_meta = attach_tabcnn(notes, audio_path, tuning)
    except Exception:
        log.exception("TabCNN attach failed")
    return {
        "notes": notes,
        "model": "basic-pitch-onnx",
        "tabcnn": tabcnn_meta,
        "n_notes": len(notes),
    }
