# Eval

## Tab benchmarks on real guitar (p2.4)

Results and the before/after table: [REPORT.md](REPORT.md). Data goes under `data/eval/` (gitignored):

```bash
mkdir -p data/eval/guitarset data/eval/idmt
# GuitarSet (CC BY 4.0): annotations + mono mic audio (~700 MB)
curl -L -o data/eval/guitarset/annotation.zip https://zenodo.org/api/records/3371780/files/annotation.zip/content
curl -L -o data/eval/guitarset/audio_mono-mic.zip https://zenodo.org/api/records/3371780/files/audio_mono-mic.zip/content
(cd data/eval/guitarset && unzip -q annotation.zip -d annotation && unzip -q audio_mono-mic.zip -d audio)
# IDMT-SMT-Guitar v2 (CC BY-NC-ND 4.0, eval only, ~1.3 GB)
curl -L -o data/eval/idmt/idmt.zip https://zenodo.org/api/records/7544110/files/IDMT-SMT-GUITAR_V2.zip/content
(cd data/eval/idmt && unzip -q idmt.zip)
```

```bash
export PYTHONPATH=workers/analysis
# note F1 / tab F1 / string+fret accuracy / export survival on GuitarSet player 05 (+ hard variants)
.venv/bin/python eval/tab_bench.py --backends bp-legacy:legacy:v2 --hard dist
.venv/bin/python eval/tab_bench.py --backends bp-legacy:legacy:v2 --hard mix --limit 12   # runs Demucs
# bend / slide / vibrato P/R + electric tab on IDMT licks (clean and distorted)
.venv/bin/python eval/technique_bench.py --backend bp-legacy --fingering v2 [--hard dist]
# refit the fingering weights (true pitches, string withheld; held-out GuitarSet 05 + IDMT Les Paul)
.venv/bin/python eval/fingering_fit.py
```

Optional YourMT3+ backend (GPL-3.0, eval only, ~40 s per clip on an M1 Pro CPU) — setup and
runner: `eval/backends/yourmt3_runner.py` (docstring); results are read by the `yourmt3` backend.

Backend spec is `transcriber:cleaner:fingering` — transcribers are registered in
`tabgen_analysis/stages/transcribe.py` (`bp-legacy` = Basic Pitch + TabCNN prior, `bp-notabcnn`,
`tabcnn`, `bp@onset/frame/min_ms`). To get the "before" numbers, run the same scripts from a
checkout of the previous commit (`git worktree add ../tabgen-baseline <commit>`; the scripts fall
back to the old APIs there).

## Multi-guitar benchmark (p2.5)

`eval/multi_bench.py` builds two- and three-guitar scenes from GuitarSet: every piece was
recorded by six players to the same click, so one player's comping under another player's solo
is a real arrangement with string/fret truth for each guitar. Layouts: both centred (`mono2`),
rhythm left + lead centre (`lc2`), left/right (`lr2`), double-tracked rhythm + lead (`dbl3`),
two rhythm guitars and no lead (`rr2`). Tune on `--split dev` (players 00/01/02), report on
`--split test` (05/04/03).

```bash
PYTHONPATH=workers/analysis .venv/bin/python eval/multi_bench.py --split dev
PYTHONPATH=workers/analysis .venv/bin/python eval/multi_bench.py --split test --dist-solo   # distorted lead
PYTHONPATH=workers/analysis .venv/bin/python eval/multi_bench.py --split test --band --dist-solo --limit 10  # + drums/bass, Demucs
```

Metrics: `part_tab_f1` = mean over the real guitars of the tab F1 of the predicted part
matched to it (unmatched guitar = 0), `count_ok`, `role_ok` (lead/rhythm label right and no
lead invented), `assign` (correctly heard notes that landed in the right guitar's tab).

## Real songs against a trusted tab (`eval/real_bench.py`)

Put `audio.*` + `ref.*` (Guitar Pro 3-7 / GPX / MusicXML / alphaTex, converted by
`eval/real/score2json.mjs` with the app's alphaTab, repeats unrolled) in
`data/eval/real/<name>/`. The reference is aligned to the recording: chroma DTW (pinned or open
ends, whichever fits the recording's onsets better) -> robust line -> per-6 s offset on the onset
envelope. `eval/real/make_qa.py` builds QA songs with known answers (GuitarSet clips shifted 1.5 s
and slowed 4%, the 3-guitar demo): alignment error <= 35 ms on all of them.

## Phase 1/2 smoke checks

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
PYTHONPATH=workers/analysis .venv/bin/python eval/guitar_vs_mix.py
```

`guitar_vs_mix.py` injects a fake Demucs guitar stem (no Demucs run) plus loud bass/drums/vox
distractors, then scores chords+tabs on the isolated guitar vs the same models on the mix.
The mix path must not win — that is the regression for “the app is hearing the whole song.”

`run_synth_pipeline.py` writes `data/eval/summary.json`. Do not add per-song
overrides to chase one clip; remaining errors belong in the accuracy report.

Phase 1 smoke songs (personal copies, not redistributed):

| Song | Expected (basic) | Key | Notes |
|---|---|---|---|
| Jason Mraz — I'm Yours | B F# G#m E | B major | capo 4 → G D Em C |
| Nirvana — Smells Like Teen Spirit | F Bb Ab Db | F minor | power chords; maj/min often confused |
| Oasis — Wonderwall (acoustic cover) | F#m A E B D | F# minor | relative major (A) is a common key miss |
