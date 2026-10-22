"""Guitar-stem transcription: Basic Pitch (notes + contours) and optional TabCNN-GPFX.

TabCNN is a string/fret prior at each onset; Basic Pitch remains the source of
timing, MIDI pitch, and pitch-bend. Either model failing is non-fatal.
"""

from __future__ import annotations

import hashlib
import logging
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import models_dir

log = logging.getLogger(__name__)

MODEL_KEY = "bp-0.4-onnx-tabcnn-gpfx-v2"

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


def pick_guitar_source(stems: Path | None, mix: Path) -> tuple[Path, str, float]:
    """Prefer the Demucs guitar stem; fall back to guitar+other / harmonic / mix if it's weak."""
    if stems is None:
        return mix, "mix", rms_path(mix)
    guitar = stems / "guitar.wav"
    if not guitar.exists():
        return mix, "mix", rms_path(mix)
    g = rms_path(guitar)
    m = rms_path(mix)
    if g >= 0.08 * max(m, 1e-6):
        return guitar, "guitar", g
    other = stems / "other.wav"
    if other.exists():
        combo = stems / "guitar_plus_other.wav"
        if not combo.exists():
            gw, sr = sf.read(str(guitar), dtype="float32")
            ow, _ = sf.read(str(other), dtype="float32")
            n = min(len(gw), len(ow))
            mixed = gw[:n] + ow[:n]
            peak = float(np.abs(mixed).max()) or 1.0
            sf.write(combo, mixed / max(peak, 1.0), sr)
        c = rms_path(combo)
        if c >= 0.08 * max(m, 1e-6):
            return combo, "guitar+other", c
    harmonic = stems / "harmonic.wav"
    if harmonic.exists():
        return harmonic, "harmonic", rms_path(harmonic)
    return guitar, "guitar-weak", g


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


def clean_notes(notes: list[dict], onset_merge: float = 0.045) -> list[dict]:
    """Merge overlapping same-MIDI events and drop quieter octave doubles.

    Basic Pitch often emits a fundamental plus its octave (or a split note).
    Keeping both inflates false-positive tab notes on every strum.
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
        if groups and float(n["start"]) - float(groups[-1][0]["start"]) <= onset_merge:
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
                if abs(ma - mb) not in (12, 24):
                    continue
                va = float(a.get("velocity") or a.get("confidence") or 0)
                vb = float(b.get("velocity") or b.get("confidence") or 0)
                higher = i if ma > mb else j
                quieter = i if va < vb else j
                drop.add(higher if abs(va - vb) < 0.12 else quieter)
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
