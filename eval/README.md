# Eval

Audio files stay out of the repo. After analyzing a song:

```bash
.venv/bin/python eval/check.py data/tracks/<hash>/analysis@*.json \
  --expect "G D Em C" --key "G major"
```

`--expect` is the sounding chord vocabulary at the **basic** (maj/min) level.
`in expected vocabulary` requires the quality (Am vs A); `root in expected roots`
forgives major/minor swaps, which power-chord songs (e.g. grunge) trigger often.

Phase 1 smoke songs (personal copies, not redistributed):

| Song | Expected (basic) | Key | Notes |
|---|---|---|---|
| Jason Mraz — I'm Yours | B F# G#m E | B major | capo 4 → G D Em C |
| Nirvana — Smells Like Teen Spirit | F Bb Ab Db | F minor | power chords; maj/min often confused |
| Oasis — Wonderwall (acoustic cover) | F#m A E B D | F# minor | relative major (A) is a common key miss |
