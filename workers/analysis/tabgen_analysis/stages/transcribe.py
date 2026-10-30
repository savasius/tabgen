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
from .separate import is_mix_copy

log = logging.getLogger(__name__)

# v5: cache key includes guitar-stem routing so mix/harmonic transcriptions are not reused.
# v6: Basic Pitch thresholds 0.42/0.28/90ms -> 0.65/0.35/100ms (swept on GuitarSet 00-01;
#     held-out GuitarSet 05 note F1 0.78 -> 0.82, IDMT electric licks 0.70 -> 0.76).
# v7: 0.65/0.35/100ms -> 0.75/0.40/70ms (eval/bp_sweep_electric.py: better on every set at once --
#     Guitar-TECHS electric solos 0.63/0.66 -> 0.66/0.68 note F1 per half, GuitarSet 05 0.821 -> 0.823,
#     IDMT licks 0.752 -> 0.770; a stricter onset drops ghost notes, the shorter minimum keeps fast runs).
MODEL_KEY = "bp-0.4-onnx-tabcnn-gpfx-v7-guitar"
BP_ONSET, BP_FRAME, BP_MIN_MS = 0.75, 0.40, 70.0

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
    source: str  # guitar | guitar+bass | guitar+other | guitar+bass+other | guitar-weak
    rms: float
    mix_rms: float
    ratio: float
    warning: str | None = None
    empty: bool = False

    def cache_tag(self) -> str:
        return self.source.removesuffix("-weak").replace("+", "plus")

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


def _quiet_onnxruntime() -> None:
    """onnxruntime's usage telemetry can spin a core at process exit while it tries to flush
    (seen on macOS: the analysis finished, the process never did). TabGen sends nothing anyway."""
    try:
        import onnxruntime as ort
        ort.disable_telemetry_events()
    except Exception:  # noqa: BLE001 -- older/newer builds without the switch
        pass


def _bp():
    global _bp_model
    _quiet_onnxruntime()
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
            _quiet_onnxruntime()
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


# Bass-stem leakage. On a recording with no bass player, htdemucs_6s files much of the guitar's
# low register (E/A/D strings) under "bass" -- on Guitar-TECHS solos the bass stem was often louder
# than the guitar stem, and notes below D3 were heard 20% of the time instead of 60%. A real bass
# always sounds under 75 Hz (its E and A strings); leaked guitar barely does. Share of 30-400 Hz
# energy under 75 Hz in the bass stem: guitar-only takes (GuitarSet 05, Guitar-TECHS P3) <= 0.04,
# real or synthesized bass lines >= 0.27. Drop-tuned guitars read as "bass" (unchanged behaviour).
BASS_LOW_HZ = 75.0
BASS_LEAK_MAX_LOW = 0.15
BASS_LEAK_MIN_RATIO = 0.05  # bass stem RMS vs guitar stem: below this there is nothing to recover


def bass_low_share(path: Path) -> float:
    """Fraction of the stem's 30-400 Hz energy that lies under BASS_LOW_HZ."""
    wav, sr = sf.read(str(path), dtype="float32", always_2d=False)
    y = wav.mean(axis=1) if getattr(wav, "ndim", 1) == 2 else wav
    n = 1 << 15
    if len(y) < n:
        y = np.pad(y, (0, n - len(y)))
    win = np.hanning(n).astype(np.float32)
    power = np.zeros(n // 2 + 1)
    for k in range(0, len(y) - n + 1, n // 2):
        power += np.abs(np.fft.rfft(y[k:k + n] * win)) ** 2
    f = np.fft.rfftfreq(n, 1 / sr)
    total = power[(f > 30) & (f < 400)].sum()
    return float(power[(f > 30) & (f < BASS_LOW_HZ)].sum() / total) if total > 0 else 1.0


def bass_is_guitar_leak(bass: Path, guitar_rms: float) -> bool:
    b = rms_path(bass)
    return b >= BASS_LEAK_MIN_RATIO * max(guitar_rms, 1e-9) and b >= EMPTY_RMS \
        and bass_low_share(bass) < BASS_LEAK_MAX_LOW


def pick_guitar_source(stems: Path, mix: Path) -> GuitarSource:
    """Isolated guitar (+ the bass stem when it is only leaked guitar, + other on 6-stem bleed).
    Never mix, never harmonic, never a real bass line."""
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
    base, base_source = guitar, "guitar"
    bass = stems / "bass.wav"
    # (eval mode copies the input into every stem slot: a copy is not leakage)
    if bass.exists() and not is_mix_copy(bass, guitar) and bass_is_guitar_leak(bass, g):
        base, base_source = stems / "guitar_plus_bass.wav", "guitar+bass"
        sum_wavs(guitar, bass, base)
        g = rms_path(base)
    chosen = GuitarSource(
        path=base, source=base_source, rms=g, mix_rms=m,
        ratio=g / max(m, 1e-9), warning=None, empty=False,
    )
    if chosen.ratio >= WEAK_RATIO and g >= EMPTY_RMS:
        return chosen

    other = stems / "other.wav"
    if other.exists():
        combo = stems / base.name.replace(".wav", "_plus_other.wav")
        sum_wavs(base, other, combo)
        c = rms_path(combo)
        c_ratio = c / max(m, 1e-9)
        if c_ratio > chosen.ratio * 1.25 and c >= EMPTY_RMS:
            chosen = GuitarSource(
                path=combo, source=f"{base_source}+other", rms=c, mix_rms=m,
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


def transcribe_basic_pitch(audio_path: Path, onset_threshold: float = BP_ONSET,
                           frame_threshold: float = BP_FRAME, min_note_ms: float = BP_MIN_MS) -> list[dict]:
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
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            minimum_note_length=min_note_ms,
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


def _bp_events(audio_path: Path, settings: list[tuple[float, float, float]]) -> list[list]:
    """One Basic Pitch forward pass, note decoding at several threshold settings."""
    import contextlib
    import io
    from basic_pitch import inference as bpi
    from basic_pitch.constants import AUDIO_SAMPLE_RATE, FFT_HOP
    from basic_pitch.note_creation import model_output_to_notes

    with contextlib.redirect_stdout(io.StringIO()):
        out = bpi.run_inference(str(audio_path), _bp())
    res = []
    for onset, frame, min_ms in settings:
        _midi, events = model_output_to_notes(
            out, onset_thresh=onset, frame_thresh=frame,
            min_note_len=int(np.round(min_ms / 1000 * (AUDIO_SAMPLE_RATE / FFT_HOP))),
            min_freq=MIN_HZ, max_freq=MAX_HZ, multiple_pitch_bends=True, melodia_trick=True,
            midi_tempo=120,
        )
        res.append(events)
    return res


def _event_notes(events) -> list[dict]:
    notes = []
    for start, end, pitch, vel, bends in events:
        conf = float(vel)
        notes.append({
            "start": round(float(start), 4), "end": round(float(end), 4), "midi": int(pitch),
            "velocity": round(conf, 4), "confidence": round(min(1.0, conf), 4),
            "bends": [int(b) for b in bends] if bends else None,
            "source": "basic-pitch", "low_confidence": conf < 0.35,
        })
    return notes


def transcribe_with_continuations(audio_path: Path) -> list[dict]:
    """Strict thresholds for the notes, plus loose-threshold notes that start inside a kept note.

    The strict setting drops most ghost notes, but also the unpicked second half of a split bend,
    slide or hammer-on (its onset is weak by definition). Those come back flagged
    `continuation`; techniques.resolve_continuations keeps only the ones that turn out legato.
    """
    hi_ev, lo_ev = _bp_events(audio_path, [(BP_ONSET, BP_FRAME, BP_MIN_MS), (0.42, 0.28, 60.0)])
    hi, lo = _event_notes(hi_ev), _event_notes(lo_ev)
    out = list(hi)
    for n in lo:
        t, m = float(n["start"]), int(n["midi"])
        if any(int(h["midi"]) == m and abs(float(h["start"]) - t) < 0.05 for h in hi):
            continue
        if any(float(h["start"]) < t - 0.03 and t <= float(h["end"]) + 0.05
               and 1 <= abs(m - int(h["midi"])) <= 5 for h in hi):
            out.append({**n, "continuation": True, "low_confidence": True})
    out.sort(key=lambda n: (float(n["start"]), int(n["midi"])))
    return out


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
    # transcribe_with_continuations (strict + loose notes for split bends) was benchmarked and
    # lost to plain strict thresholds on GuitarSet and IDMT; kept as the `bp-cont` eval backend.
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


def clean_notes_v2(notes: list[dict], onset_merge: float = 0.045,
                   harmonic_window: float = 0.06, ghost_ratio: float = 0.6) -> list[dict]:
    """Like `clean_notes`, but keeps real chord octaves.

    A strummed open E has E2 B2 E3 G#3 B3 E4: 12-, 19- and 24-semitone pairs that are all
    played. The legacy cleaner deleted the upper note of every such pair, gutting chords.
    Here an upper partial is only dropped when it is clearly weaker than its fundamental
    and does not start first (a played note has its own attack).
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
            if float(n.get("velocity") or 0) > float(merged[-1].get("velocity") or 0):
                merged[-1]["velocity"] = n.get("velocity")
                merged[-1]["confidence"] = n.get("confidence", n.get("velocity"))
            continue
        merged.append(n)

    def vel(n: dict) -> float:
        return float(n.get("velocity") or n.get("confidence") or 0)

    drop: set[int] = set()
    for i, hi in enumerate(merged):
        th = float(hi["start"])
        for j in range(i - 1, -1, -1):
            lo = merged[j]
            if th - float(lo["start"]) > harmonic_window:
                break
            d = int(hi["midi"]) - int(lo["midi"])
            if d not in (12, 19, 24, 28, 31):
                continue
            if vel(hi) < ghost_ratio * vel(lo):
                drop.add(i)
                break
    out = [n for i, n in enumerate(merged) if i not in drop]
    out.sort(key=lambda n: (float(n["start"]), int(n["midi"])))
    return out


# ---------------------------------------------------------------- swappable transcribers
#
# Every backend returns raw (uncleaned) notes: start/end seconds, midi, velocity, confidence,
# optional `bends` (Basic Pitch 1/3-semitone contour) and optional `tabcnn`/`string_i`+`fret`
# priors. Cleaning, fingering and techniques run downstream and are shared, so swapping the
# note model is one registry entry. `eval/tab_bench.py` scores every entry on the same audio.


class Transcriber:
    key = "base"

    def transcribe(self, audio_path: Path, tuning: list[int]) -> list[dict]:
        raise NotImplementedError


class BasicPitchTranscriber(Transcriber):
    def __init__(self, onset: float = 0.42, frame: float = 0.28, min_ms: float = 90.0,
                 tabcnn: bool = True):
        self.onset, self.frame, self.min_ms, self.use_tabcnn = onset, frame, min_ms, tabcnn
        self.key = f"bp-{onset}-{frame}-{int(min_ms)}" + ("-tabcnn" if tabcnn else "")

    def transcribe(self, audio_path: Path, tuning: list[int]) -> list[dict]:
        notes = transcribe_basic_pitch(audio_path, self.onset, self.frame, self.min_ms)
        if self.use_tabcnn:
            try:
                attach_tabcnn(notes, audio_path, tuning)
            except Exception:
                log.exception("TabCNN attach failed")
        return notes


class BasicPitchContTranscriber(Transcriber):
    key = "bp-cont"

    def transcribe(self, audio_path: Path, tuning: list[int]) -> list[dict]:
        notes = transcribe_with_continuations(audio_path)
        attach_tabcnn(notes, audio_path, tuning)
        return notes


class TabCNNTranscriber(Transcriber):
    """TabCNN-GPFX on its own: per-string fret classes per frame → notes on that string."""
    key = "tabcnn-gpfx"

    def __init__(self, min_frames: int = 3, prob: float = 0.5):
        self.min_frames, self.prob = min_frames, prob

    def transcribe(self, audio_path: Path, tuning: list[int]) -> list[dict]:
        frames, _ = _tabcnn_frames(audio_path)
        if frames is None:
            return []
        probs = np.exp(frames)  # [T, 6, 21]; class 0 = silent
        cls = probs.argmax(-1)
        conf = probs.max(-1)
        notes: list[dict] = []
        # TabCNN's string axis is low E first in GuitarSet ordering (verified by attach_tabcnn
        # order search on real clips); fret class k → fret k-1.
        for s in range(6):
            t = 0
            T = len(cls)
            while t < T:
                k = int(cls[t, s])
                if k == 0 or conf[t, s] < self.prob:
                    t += 1
                    continue
                u = t
                while u + 1 < T and int(cls[u + 1, s]) == k:
                    u += 1
                if u - t + 1 >= self.min_frames:
                    fret = k - 1
                    c = float(conf[t:u + 1, s].mean())
                    notes.append({
                        "start": round(t * TABCNN_HOP, 4), "end": round((u + 1) * TABCNN_HOP, 4),
                        "midi": int(tuning[s]) + fret, "velocity": round(c, 4),
                        "confidence": round(c, 4), "bends": None, "source": "tabcnn",
                        "tabcnn": {"string": s, "fret": fret, "confidence": round(c, 3)},
                        "low_confidence": c < 0.6,
                    })
                t = u + 1
        notes.sort(key=lambda n: (n["start"], n["midi"]))
        return notes


def _registry() -> dict[str, callable]:
    return {
        "bp": lambda: BasicPitchTranscriber(BP_ONSET, BP_FRAME, BP_MIN_MS, tabcnn=True),  # pipeline
        "bp-cont": lambda: BasicPitchContTranscriber(),  # eval: strict notes + loose split-bend halves
        "bp-legacy": lambda: BasicPitchTranscriber(0.42, 0.28, 90.0, tabcnn=True),  # p2.3 settings
        "bp-notabcnn": lambda: BasicPitchTranscriber(0.42, 0.28, 90.0, tabcnn=False),
        "tabcnn": lambda: TabCNNTranscriber(),
    }


def get_transcriber(name: str) -> Transcriber:
    """`bp@onset/frame/min_ms` builds a Basic Pitch variant on the fly (used by the bake-off)."""
    if name.startswith("bp@"):
        o, f, m = (float(x) for x in name[3:].split("/"))
        return BasicPitchTranscriber(o, f, m, tabcnn=True)
    reg = _registry()
    if name not in reg:
        raise KeyError(f"unknown transcriber {name!r}; have {sorted(reg)}")
    return reg[name]()
