# Eval

Audio files stay out of the repo. After analyzing a song:

```bash
.venv/bin/python eval/check.py data/tracks/<hash>/analysis@*.json \
  --expect "G D Em C" --key "G major"
```

`--expect` is the sounding chord vocabulary at the **basic** (maj/min/power) level.
`in expected vocabulary` matches quality (Am vs A) but treats `F5` as matching `F`/`Fm`.
`root in expected roots` is family-only. Relative major/minor key swaps are reported
separately by `eval/score.py` (`exact` vs `relative`).

Synth clips (generated, not commercial recordings) — these are the Phase 2
regression set (I–V–vi–IV, power-chord riff, relative-minor home, pentatonic
solo, plus a guitar-like technique clip for bend / hammer / pull / slide /
vibrato). `eval/score.py` reports technique precision/recall against timed
events; a picked opening on the technique clip and the whole pentatonic solo
must not be tagged as legato.

```bash
.venv/bin/python eval/synth.py
.venv/bin/python eval/tab_smoke.py          # Basic Pitch + Viterbi F1 on the pentatonic solo
PYTHONPATH=workers/analysis .venv/bin/python eval/run_synth_pipeline.py
```

`run_synth_pipeline.py` writes `data/eval/summary.json`. Do not add per-song
overrides to chase one clip; remaining errors belong in the accuracy report.

Phase 1 smoke songs (personal copies, not redistributed):

| Song | Expected (basic) | Key | Notes |
|---|---|---|---|
| Jason Mraz — I'm Yours | B F# G#m E | B major | capo 4 → G D Em C |
| Nirvana — Smells Like Teen Spirit | F Bb Ab Db | F minor | power chords; maj/min often confused |
| Oasis — Wonderwall (acoustic cover) | F#m A E B D | F# minor | relative major (A) is a common key miss |
