"""Turn Guitar-TECHS player-03 music excerpts into real_bench song folders.

Guitar-TECHS (CC BY 4.0, https://guitar-techs.github.io, Zenodo 14963133) records real electric
guitar through an amp mic and a per-string MIDI pickup: one MIDI track per string (e B G D A E),
already in sync with the audio. So the reference tab is exact (string = track, fret = pitch -
open string) and needs no alignment (meta.json "synced": true).

  .venv/bin/python eval/real/gtechs_to_real.py data/eval/gtechs_dl/P3_music [--di]

Writes data/eval/real/gt-NN/{audio.wav -> symlink, ref.json, meta.json}.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pretty_midi

REAL = Path(__file__).resolve().parents[2] / "data" / "eval" / "real"
OPEN = {"E": 40, "A": 45, "D": 50, "G": 55, "B": 59, "e": 64}
STRING_I = {"E": 0, "A": 1, "D": 2, "G": 3, "B": 4, "e": 5}  # 0 = low E, as real_bench uses


def convert(src: Path, i: int, di: bool) -> dict:
    m = pretty_midi.PrettyMIDI(str(src / "midi" / f"midi_{i:02d}.mid"))
    notes, dropped = [], 0
    for ins in m.instruments:
        if ins.name not in OPEN:
            continue
        for n in ins.notes:
            fret = n.pitch - OPEN[ins.name]
            if not 0 <= fret <= 24:  # a pickup glitch or crosstalk, not a playable note on this string
                dropped += 1
                continue
            notes.append({"start": round(n.start, 4), "end": round(n.end, 4), "midi": n.pitch,
                          "string_i": STRING_I[ins.name], "fret": fret, "tech": []})
    notes.sort(key=lambda n: (n["start"], n["string_i"]))
    bpm = float(m.get_tempo_changes()[1][0])
    ref = {"tracks": [{"index": 0, "name": "Guitar", "percussion": False, "strings": 6, "notes": notes}],
           "bars": [], "tempos": [{"sec": 0.0, "bpm": bpm}], "duration": round(m.get_end_time(), 3)}
    d = REAL / f"gt-{i:02d}"
    d.mkdir(parents=True, exist_ok=True)
    (d / "ref.json").write_text(json.dumps(ref))
    (d / "meta.json").write_text(json.dumps({"title": f"Guitar-TECHS P3 music {i:02d}", "synced": True,
                                             "source": "Guitar-TECHS (CC BY 4.0)"}))
    audio = d / "audio.wav"
    audio.unlink(missing_ok=True)
    kind = "directinput" if di else "micamp"
    audio.symlink_to((src / "audio" / kind / f"{kind}_{i:02d}.wav").resolve())
    return {"song": d.name, "notes": len(notes), "dropped": dropped, "bpm": bpm}


def main() -> None:
    src = Path(sys.argv[1])
    for i in range(1, 13):
        print(convert(src, i, "--di" in sys.argv))


if __name__ == "__main__":
    main()
