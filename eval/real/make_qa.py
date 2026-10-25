"""QA folders for eval/real_bench.py with known answers (GuitarSet truth, no commercial audio).

  qa-solo05 / qa-comp05   one GuitarSet clip, 1.5 s of silence in front and 4% slower: the DTW
                          alignment has to undo both; scores should match eval/tab_bench.py.
  qa-3gtr                 the 3-guitar demo (rhythm L, rhythm R, lead C) with its three true
                          tracks: tests matching TabGen's guitar parts to reference tracks.

  PYTHONPATH=workers/analysis .venv/bin/python eval/real/make_qa.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import multi_bench as mb  # noqa: E402
from tab_bench import _band, _distort  # noqa: E402

REAL = HERE.parent.parent / "data" / "eval" / "real"
SR = 44100


def track(name, notes, index):
    return {"index": index, "name": name, "tuning": [40, 45, 50, 55, 59, 64], "capo": 0,
            "percussion": False, "strings": 6,
            "notes": [{**{k: n[k] for k in ("start", "end", "midi", "string_i", "fret")}, "tech": [], "chord": None}
                      for n in notes]}


def write(name, y, tracks, beats_per_bar=4, bpm=None, beats=None):
    d = REAL / name
    d.mkdir(parents=True, exist_ok=True)
    sf.write(str(d / "audio.wav"), y.astype(np.float32), SR)
    dur = max(n["end"] for t in tracks for n in t["notes"])
    bars = [float(b) for b in (beats or [])[::beats_per_bar]]
    (d / "ref.json").write_text(json.dumps({
        "source": "qa", "title": name, "tempo": bpm, "duration": dur, "bars": bars,
        "tempos": [{"sec": 0.0, "bpm": bpm}], "tracks": tracks}))


def stretch(y, rate):
    import librosa
    if y.ndim == 1:
        return librosa.effects.time_stretch(y, rate=rate)
    return np.stack([librosa.effects.time_stretch(y[:, c], rate=rate) for c in range(y.shape[1])], axis=1)


def main():
    from tab_bench import _jams_notes, GS
    ann = next((GS / "annotation").rglob("*.jams")).parent
    for kind in ("solo", "comp"):
        name = f"05_Rock1-130-A_{kind}"
        y, notes = mb._track("05", "Rock1-130-A", kind)
        _n, beats = _jams_notes(ann / f"{name}.jams")
        y = y / np.abs(y).max() * 0.8
        y = np.concatenate([np.zeros(int(1.5 * SR), np.float32), stretch(y, 1 / 1.04)])
        write(f"qa-{kind}05", np.stack([y, y], axis=1), [track(name, notes, 0)], bpm=130, beats=beats)
    # 3 guitars + band, like the app demo
    parts, refs = [], []
    for i, (player, kind, pan, gain) in enumerate([("04", "comp", -0.7, 1.0), ("03", "comp", 0.75, 0.9), ("05", "solo", 0.0, 1.3)]):
        a, n = mb._track(player, "Rock1-130-A", kind)
        a = a / np.sqrt(np.mean(a ** 2)) * gain
        if kind == "solo":
            a = _distort(a, SR)
            a = a / np.sqrt(np.mean(a ** 2)) * gain
        parts.append(mb._pan(a, pan))
        refs.append(track(f"{kind}-{player}", n, i))
    n = min(len(p) for p in parts)
    g = sum(p[:n] for p in parts)
    _n, beats = _jams_notes(ann / "05_Rock1-130-A_comp.jams")
    b = _band(SR, n, [x for t in refs for x in t["notes"]], seed=7, beats=beats)
    mix = g / np.sqrt(np.mean(g ** 2)) + 1.2 * np.stack([b, b], 1) / np.sqrt(np.mean(b ** 2))
    write("qa-3gtr", 0.9 * mix / np.abs(mix).max(), refs, bpm=130, beats=beats)
    print("wrote", sorted(p.name for p in REAL.iterdir()))


if __name__ == "__main__":
    main()
