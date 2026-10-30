"""Training data for the string classifier: one example per played note.

Input: the note's first ~200 ms as a constant-Q spectrogram patch *aligned to the note's own pitch*
(bin 0 = an octave below the fundamental), so the model sees the shape of the overtones -- what a
thick string high up the neck sounds like versus a thin string low down -- and not the pitch itself.
The pitch goes in separately. Label: the string (0 = low E).

Sources (all CC BY 4.0, usable for a shipped model):
  train  Guitar-TECHS players 1-2 (single notes, chords, scales, techniques; amp mic + DI),
         GuitarSet players 00-04 (acoustic)
  test   Guitar-TECHS player 3 music (the 12 solos), GuitarSet player 05 -- never seen in training

  PYTHONPATH=workers/analysis .venv/bin/python eval/strings/dataset.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "workers" / "analysis"))
sys.path.insert(0, str(REPO / "eval"))

from tabgen_analysis.string_model import note_patches  # noqa: E402

GT = REPO / "data" / "eval" / "gtechs_dl"
OUT = REPO / "data" / "eval" / "strings"
OPEN = {"E": 40, "A": 45, "D": 50, "G": 55, "B": 59, "e": 64}
STRING_I = {"E": 0, "A": 1, "D": 2, "G": 3, "B": 4, "e": 5}


def gtechs_notes(midi_path: Path) -> list[dict]:
    import pretty_midi
    m = pretty_midi.PrettyMIDI(str(midi_path))
    out = []
    for ins in m.instruments:
        if ins.name not in OPEN:
            continue
        for n in ins.notes:
            fret = n.pitch - OPEN[ins.name]
            if 0 <= fret <= 22 and n.end - n.start >= 0.03:
                out.append({"start": n.start, "end": n.end, "midi": n.pitch, "string_i": STRING_I[ins.name], "fret": fret})
    return out


def gtechs_files(players: tuple[str, ...], kinds: tuple[str, ...], mics: tuple[str, ...]):
    for p in players:
        for kind in kinds:
            root = GT / f"{p}_{kind}"
            if not root.exists():
                continue
            for mp in sorted((root / "midi").glob("*.mid")):
                tag = mp.stem.replace("midi_", "")
                for mic in mics:
                    wav = root / "audio" / mic / f"{mic}_{tag}.wav"
                    if wav.exists():
                        yield f"{p}-{kind}-{tag}-{mic}", wav, gtechs_notes(mp)


def build(name: str, items) -> None:
    X, P, Y, F, G = [], [], [], [], []
    for gid, (src, wav, notes) in enumerate(items):
        x, keep = note_patches(Path(wav), notes)
        X.append(x)
        P += [notes[i]["midi"] for i in keep]
        Y += [notes[i]["string_i"] for i in keep]
        F += [notes[i]["fret"] for i in keep]
        G += [gid] * len(keep)
        print(f"{name}: {src} {len(keep)} notes", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUT / f"{name}.npz", x=np.concatenate(X).astype(np.float16), midi=np.array(P, np.int16),
                        string=np.array(Y, np.int8), fret=np.array(F, np.int8), group=np.array(G, np.int32))


def main() -> None:
    from tab_bench import guitarset_clips
    kinds = ("singlenotes", "chords", "scales", "techniques")
    train = list(gtechs_files(("P1", "P2"), kinds, ("micamp", "directinput")))
    train += [(c["id"], c["wav"], c["notes"]) for c in guitarset_clips("00,01,02,03,04")]
    build("train", train)
    test_p3 = [(f"P3-music-{i:02d}", GT / "P3_music" / "audio" / "micamp" / f"micamp_{i:02d}.wav",
                json.loads((REPO / "data" / "eval" / "real" / f"gt-{i:02d}" / "ref.json").read_text())["tracks"][0]["notes"])
               for i in range(1, 13)]
    build("test_p3", test_p3)
    build("test_gs05", [(c["id"], c["wav"], c["notes"]) for c in guitarset_clips("05")])


if __name__ == "__main__":
    main()
