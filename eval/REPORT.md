# Tab accuracy report — p2.3 → p2.4

All numbers come from `eval/tab_bench.py`, `eval/technique_bench.py` and `eval/fingering_fit.py`
(commands in [README.md](README.md)). "Before" = the previous commit's code (p2.3) run through the
same scripts; "after" = this branch. Onset tolerance 50 ms (mir_eval), offsets ignored.

- **note F1**: pitch + onset — the transcription itself.
- **tab F1**: pitch + onset + same string + same fret — what you read on the staff.
- **string/fret acc.**: of the notes heard correctly, how many sit on the right string and fret.
- **export kept**: share of fingered notes that reach the alphaTex the UI renders and plays.

## 1. Real recordings with string/fret ground truth

GuitarSet player 05 = 60 clips (30 comping, 30 solo; bossa, funk, jazz, rock, singer-songwriter).
Hard variants are built from the same clips: **dist** = amp-style distortion + cabinet filter;
**mix** = guitar buried under drums / bass / pad, then separated with Demucs `htdemucs_6s` (the app's
real path; 12 clips because Demucs on CPU is slow).

| Set | Metric | Before (p2.3) | After (p2.4) |
|---|---|---|---|
| GuitarSet clean (60) | note F1 | 0.783 | 0.816 |
| | **tab F1** | **0.437** | **0.700** |
| | string/fret acc. | 0.569 | 0.860 |
| | export kept | 0.924 | 0.993 |
| GuitarSet distorted (60) | note F1 | 0.648 | 0.698 |
| | **tab F1** | **0.337** | **0.520** |
| | string/fret acc. | 0.548 | 0.742 |
| | export kept | 0.902 | 0.988 |
| GuitarSet in a band mix → Demucs (12) | note F1 | 0.690 | 0.745 |
| | **tab F1** | **0.286** | **0.482** |
| | string/fret acc. | 0.418 | 0.654 |
| | export kept | 0.916 | 0.995 |
| IDMT electric licks (198) | note F1 | 0.692 | 0.762 |
| | **tab F1** | **0.379** | **0.533** |
| | string/fret acc. | 0.547 | 0.697 |
| IDMT licks distorted (198) | note F1 | 0.594 | 0.707 |
| | **tab F1** | **0.320** | **0.408** |
| | string/fret acc. | 0.537 | 0.569 |

**Caveat — training overlap.** Basic Pitch and the TabCNN-GPFX prior were both trained with
GuitarSet, so absolute GuitarSet numbers are optimistic, especially string/fret accuracy (TabCNN
alone scores 0.90 there). IDMT was never used to train either model; treat the IDMT rows as the
honest ones for electric rock/pop guitar.

## 2. Fingering on its own (true pitches, string withheld)

| | GuitarSet 05 (held out) | IDMT Les Paul licks (held out) |
|---|---|---|
| p2.3 greedy pass | 0.531 | 0.510 |
| p2.4 Viterbi, weights fitted on GuitarSet only | 0.686 | 0.486 |
| **p2.4 Viterbi, weights fitted on GuitarSet 00–04 + IDMT Aria/Strat** (shipped) | **0.640** | **0.550** |

The GuitarSet-only fit learned "avoid open strings, play mid-neck" (jazz/bossa comping) and got worse
on rock licks, so the shipped weights are fitted on both styles. On audio, with the TabCNN prior,
the joint weights were better on both datasets (GuitarSet tab F1 0.630 → 0.658, IDMT 0.418 → 0.459).

## 3. Model bake-off (same audio, same fingering/export)

GuitarSet 05, clean. Basic Pitch thresholds were swept on players 00–01 and only then checked here.

| Transcriber (+ shared fingering/export) | note F1 | tab F1 | string/fret acc. | s / 30 s clip |
|---|---|---|---|---|
| Basic Pitch, p2.3 thresholds (0.42 / 0.28 / 90 ms) + TabCNN prior | 0.778 | 0.662 | 0.852 | 0.8 |
| **Basic Pitch 0.65 / 0.35 / 100 ms + TabCNN prior (shipped)** | **0.816** | **0.700** | 0.860 | 1.0 |
| same, no TabCNN prior | 0.778* | 0.390* | 0.521* | 0.3 |
| TabCNN-GPFX alone (string/fret classes → notes) | 0.708 | 0.634 | 0.896 | 0.6 |
| Basic Pitch strict + loose split-bend halves (`bp-cont`) | 0.805 | 0.693 | 0.862 | 1.0 |
| Basic Pitch with octave-keeping cleaner v2 | 0.774* | 0.651* | 0.841* | 0.8 |
| YourMT3+ (YPTF.MoE+Multi, GPL-3.0, eval only) + TabCNN prior | 0.903† | 0.794† | 0.880† | ~39 (CPU) |

\* at p2.3 thresholds. Threshold sweep on players 00–01 (tab F1): 0.42/0.28/90 0.675 ·
0.5/0.3/90 0.694 · 0.6/0.35/120 0.689 · **0.65/0.35/100 0.696** · 0.7/0.4/120 0.679 ·
0.6/0.45/150 0.611. String/fret accuracy is 0.96 on players 00–01 — TabCNN clearly saw them.

Why Basic Pitch + TabCNN prior wins: TabCNN alone is better at *which string* but misses ~30% of
notes; Basic Pitch hears more notes and its pitch contours drive bend/slide/vibrato detection.
Using TabCNN only as a string/fret prior inside the Viterbi gets most of both. The prior is what
makes fingering work: without it, tab F1 falls to 0.39.

† YourMT3+ trained on GuitarSet with a random 4-of-6-player split per piece, so about two thirds of
these clips were in its training data. On IDMT, which it never saw, it loses to Basic Pitch:
note F1 0.664 vs 0.762, tab F1 0.475 vs 0.533, and technique F1 0.065 vs 0.511 (it outputs no pitch
contours, so bends/slides can't be measured). It is also ~40× slower on this Mac and GPL-licensed.
**Verdict: Basic Pitch + TabCNN prior stays the engine.** MuScriptor (2026, CC-BY-NC weights) was not
tested: its weights are behind a Hugging Face license click-through.

On IDMT (never in either model's training) the shipped thresholds also win: note F1 0.70 → 0.76,
technique F1 0.43 → 0.51; distorted: 0.60 → 0.71 / 0.36 → 0.45.

## 4. Techniques (IDMT licks: bend / slide / vibrato labels)

Event match ±150 ms. IDMT has no hammer-on / pull-off labels and the licks are mostly picked, so H/P
is reported as tags per 100 notes — on this material, nearly all of them are false positives.

| | Clean before | Clean after | Distorted before | Distorted after |
|---|---|---|---|---|
| technique F1 (bend+slide+vibrato, H/P counted as FP) | 0.119 | **0.511** | 0.105 | **0.453** |
| bend correct / tagged | 3 / 96 | 21 / 28 | 2 / 90 | 19 / 30 |
| bend recall (45 real bends) | 0.07 | 0.47 | 0.04 | 0.42 |
| slide correct / tagged | 1 / 19 | 30 / 47 | 2 / 54 | 26 / 56 |
| slide recall (72 real slides) | 0.01 | 0.42 | 0.03 | 0.36 |
| vibrato correct / tagged | 25 / 71 | 38 / 61 | 28 / 65 | 37 / 54 |
| false H/P per 100 notes | 2.22 | **0.38** | 3.68 | **0.68** |

What changed, and why (each rule came from measuring, not from one song):
- Basic Pitch writes a bent note as *two* notes (fretted pitch, then the target with no new pick).
  Those pairs became fake hammer-ons. They are now folded into one note with `{b (0 N)}`, plus a
  release `{b (0 N N 0)}` when the pitch comes back unpicked.
- Bend vs slide vs hammer comes from the pitch contour across the boundary: a hammer lands in one
  frame; a slide jumps fret-by-fret in 1–2 frames (or moves 3+ semitones, or falls); a bend ramps
  over 3+ frames. Measured on IDMT pairs.
- Bends detected *inside* one note's contour were 0/113 correct (pitch sag at the decay, the next
  note bleeding in), so they are off.
- The legato threshold (attack ratio) was 1.55, which flagged 20% of picked notes on clean licks and
  35% on distorted ones. 1.1 flags 1–2% and keeps about half of the unpicked notes.
- Vibrato limited to 3.3–6.8 Hz and ≤ 55 cents (real IDMT vibrato: 3.8–6.2 Hz, 15–40 cents).

These rules were tuned on the IDMT licks, so §4 is a development-set score, not a held-out one.

## 5. Real songs (no ground truth — listened and looked)

Pink Floyd clips already in the library (Comfortably Numb solo cover, Echoes tutorial, a
four-finger exercise), analyzed from the Demucs guitar stem:
- Before: the p2.3 install could not import Basic Pitch (setuptools ≥ 81 removed `pkg_resources`),
  so every new analysis silently got a chord-shape fallback tab. Fixed and now surfaced as an error.
- After: 473 notes on the solo (the stricter thresholds remove ghost notes), standard tuning (the
  old rule called it Drop D from six bass-bleed ghosts), 31 H/P instead of 86, 21 vibratos, 12
  slides — but only 2 bends. Strict thresholds also drop the unpicked half of many split bends on
  this reverb-heavy distorted lead; the loose-threshold recovery (`bp-cont`) found more bends but
  scored worse overall, so it is not shipped. This is the most visible remaining problem on this
  song (see gap 2). alphaTab's own parser accepts every generated tab. Screenshot of the final build
  (bars 16–18: `sl`, `b1`, `h`, `p`, `b½↓`): `docs/demo/tab-view-techniques.jpg`.
- Orijinal | Gitar | Tab gitar switching keeps the playhead (checked in the browser while playing).

## 6. Remaining gaps, ranked by impact

1. **Note transcription on distorted chords** (note F1 ≈ 0.53 on distorted comping). Basic Pitch
   hears intermodulation as notes. Needs a guitar-specific transcriber trained with amp augmentation
   (e.g. a GuitarSet+EGDB/EGDB-PG fine-tune); no permissively licensed weights exist today.
2. **Bends on distorted, reverb-heavy leads.** Bend recall is ~0.45 on IDMT and visibly lower on the
   Comfortably Numb cover. Needs a pitch tracker that follows one string through the bend
   (e.g. a monophonic f0 model on the lead stem) instead of reading Basic Pitch's note split.
3. **Beat grid on slow songs** can lock to double time (Comfortably Numb: 125 instead of 63 BPM), so
   bars look twice as dense. Fold rule should consider bar length vs. chord-change rate.
4. **Rhythm + lead in one stem.** Covers with a backing guitar put both parts in Demucs' guitar stem.
   A lead/rhythm split (or two-voice tab) is the next UX win.
5. **Hammer-on / pull-off accuracy is unmeasured** — no public labeled set was found. Precision on
   picked material is now high; recall is unknown.
6. **Slide precision ~0.6, recall ~0.4** — slides are often confused with vibrato wobble or a re-pick; a small
   learned transition classifier (IDMT + synthetic) would help.
7. **Fingering still ~30% wrong on electric licks** where several positions are equally playable.
   TabCNN's prior is the main audio cue; a timbre-based string classifier would close more of it.
8. Manual note/chord editing, MusicXML/GP export polish, mic play-along — not started in this pass.
