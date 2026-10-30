# Tab accuracy report — p2.3 → p2.4 → p2.5 → p2.6

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

## 7. Multi-guitar: one tab per guitar (p2.5)

`eval/multi_bench.py`, held-out test split: GuitarSet player 04 comping, player 03 second comping,
player 05 solo, over the same 30 pieces (all recorded to one click, so the parts fit together).
Thresholds and weights were fitted on players 00/01/02 only. "One tab" = what the app did
before (the whole guitar stem as one tab). "Separate tracks" = each guitar transcribed from its
own clean recording, the ceiling for any separation.

Mean tab F1 per real guitar (a guitar with no matching predicted part counts 0):

| Scene | One tab (before) | **p2.5** | Separate tracks (ceiling) | Guitars counted right | Lead/rhythm label right |
|---|---|---|---|---|---|
| rhythm left + lead centre | 0.23 | **0.66** | 0.69 | 100% | 100% |
| rhythm left + lead right | 0.23 | **0.65** | 0.69 | 100% | 100% |
| rhythm L + rhythm R + lead centre | 0.13 | **0.47** | 0.69 | 100% | 97% |
| two rhythm guitars L/R, no lead | 0.26 | **0.58** | 0.68 | 90% | 85% |
| rhythm + lead both centred | 0.24 | **0.38** | 0.69 | 77% | 77% |
| same, distorted lead: lead centre | 0.21 | **0.60** | 0.64 | 100% | 100% |
| same, distorted lead: rhythm L+R + lead | 0.12 | **0.44** | 0.66 | 97% | 97% |
| + drums/bass, through Demucs (10 pieces): rhythm L + lead C | 0.20 | **0.54** | 0.64 | 100% | 100% |
| + drums/bass, through Demucs: rhythm L+R + lead | 0.13 | **0.43** | 0.67 | 100% | 100% |
| + drums/bass, through Demucs: both centred | 0.16 | **0.24** | 0.64 | 60% | 70% |

How it works (`workers/analysis/tabgen_analysis/parts.py`):
- **Stereo position.** Every time-frequency bin of the stereo guitar stem gets a pan value; peaks of
  the energy-weighted pan histogram (with a real dip between them) are guitars; soft masks
  resynthesize each one, which then goes through the normal transcription + tab path. A note that is
  a much quieter copy of a note in another guitar is mask leakage and is dropped; equal-loudness
  copies are real doubling and kept.
- **Lead or rhythm.** Among panned guitars, at most one is the lead: the most "single-note line,
  high, no strums" one, if ≥75% of its onsets are single notes and it stands out from the next.
- **No stereo cue.** If the stem has one stereo position but looks like a lead line over comping,
  a Viterbi pass assigns each onset's top note to a monophonic lead line or to the rhythm.

Single-guitar songs stay single: the three real songs in the library (Comfortably Numb cover,
Echoes tutorial, finger exercise) all come out as one guitar.

What it can't do yet:
- **Two guitars in the centre** (no stereo cue) is the weak case: 0.38 clean, 0.24 after Demucs. The
  note-level split cannot recover what transcribing both guitars at once loses (all-notes tab F1
  0.51 on the mix vs 0.67 from separate tracks). This needs a real same-instrument separation model.
- **Double-tracked rhythm** loses notes to the centre: where both sides play the same chord the bin
  looks centred. 0.47 vs 0.69 ceiling.
- The scenes are acoustic GuitarSet guitars (plus synthetic distortion); real rock mixes, reverb and
  stereo effects (chorus, wide delays) are untested here. Please add your own multi-guitar songs.

## 8. p2.6: real-song eval, tempo octave, tuner, play-along

**Real-song eval (`eval/real_bench.py`).** Scores TabGen against a trusted Guitar Pro / MusicXML /
alphaTex tab of your own recording, aligned automatically (chroma DTW -> robust line -> per-window
onset refinement). QA with known answers (`eval/real/make_qa.py`): alignment error <= 35 ms on a
clip shifted 1.5 s and slowed 4%, on repetitive comping and on the 3-guitar mix (before the fix:
100 ms to 4 s). It also caught an export bug: bars with more/fewer beats than the time signature
were written into 4/4, so alphaTab (and Tab gitar) slipped; every library song had such bars
(Echoes: 14). Feeding our own tab back as the reference went 0.68 -> 0.90 note F1 after the fix.

**Tempo octave (`eval/tempo_bench.py`, GuitarSet player 05, 30 pieces, 68-200 BPM).** Share of
clips counted at the right beat level:

| Set | p2.5 | p2.6 |
|---|---|---|
| Comping, guitar only | 0.80 | **0.90** |
| Comping + drums/bass (drums on the real beats), through Demucs | 0.90 | **0.93** |
| Solo lines, guitar only (no drums) | 0.57 | 0.53 |

Two narrow changes, chosen on all three sets: the "I'm Yours" half-time switch is skipped when
the half-time grid would hold > 4 played notes per beat (fast bossa/jazz comping came out at half
speed), and doubling starts below 65 BPM instead of 70 (a 68 BPM ballad was doubled). Rejected
after measuring: a candidate scorer (tempo prior + notes per beat + agreement) — 0.04 on held-out
solos; a "both trackers agree on a slow tempo" rule — broke solos. Unaccompanied solos fail mostly
with 3:2 errors no octave rule can fix. **Comfortably Numb stays at 125 BPM** (true ~63): both
trackers report 125 and none of these cues separates it from a real 125.

**Tuner.** IDMT dataset1, 312 real electric-guitar notes (`apps/web/src/lib/pitch.real.test.ts`):
right note 100% (old 100%); a true 7-cent change read with 0.01 cent median error (old 4.0; the
old whole-sample detector missed it entirely on 1 note in 10).

**Play-along chords.** GuitarSet comping, tuned on player 01, reported on player 05
(`apps/web/src/lib/playalong.real.test.ts`), share of beats marked green:

| Style | Played right | Played a wrong chord |
|---|---|---|
| Singer-songwriter | 0.88 | 0.03 |
| Rock | 0.74 | 0.05 |
| Funk | 0.56 | 0.09 |
| Bossa | 0.40 | 0.13 |
| Jazz | 0.30 | 0.11 |

Browser check with a synthetic player following the chords: 100% over 23 beats; a wrong chord 0%.

**Hand edits** (no metric): note/chord fixes are stored apart from the analysis, survive
reanalysis, and drive Tab gitar playback and exports. Checked end to end in the browser: fret,
string move (pitch kept), technique, add, delete, keyboard, revert, chord per beat/bar.

## 9. p2.7: real electric solos (Guitar-TECHS) and the bass-stem leak

**Test set.** Guitar-TECHS (CC BY 4.0) player 03 "music" excerpts: 12 original electric solos,
amp-mic recording, ground truth from a per-string MIDI pickup recorded with the audio (string =
track, fret = pitch - open string, no alignment needed). `eval/real/gtechs_to_real.py` builds the
folders; `eval/real_bench.py` scores them. Not commercial songs and no band, but real playing.

**Weakest area found.** Notes below about D3 were heard 20% of the time vs ~60% above. Cause: on a
recording with no bass player, htdemucs_6s files the guitar's low register under "bass" (the bass
stem was often *louder* than the guitar stem). A real bass always sounds under 75 Hz; leaked guitar
barely does: share of the bass stem's 30-400 Hz energy under 75 Hz is <= 0.04 on every guitar-only
take we have (GuitarSet 05, Guitar-TECHS) and >= 0.27 on every take with a real or synthesized bass
(GuitarSet band variants, the 3-guitar demo, the Comfortably Numb cover). Fix: when the share is
under 0.15, the bass stem is added back to the guitar stem before transcription (and playback).
Band mixes are untouched (the rule never fires on them).

| 12 solos, mean | note F1 | tab F1 | string+fret right (heard notes) |
|---|---|---|---|
| p2.6 | 0.60 | 0.34 | 0.56 |
| p2.7 | **0.66** | **0.37** | 0.55 |

Biggest gains: gt-02 0.55 -> 0.83, gt-12 0.51 -> 0.69, gt-01 0.56 -> 0.70 (note F1). Two solos
lost tab F1 (gt-05 0.62 -> 0.40, gt-09 0.25 -> 0.19) with the same notes heard: the extra low
notes moved the fingering to a different, equally playable position. Tempo octave on these solos:
9/12 right; the three misses are 50-58 BPM pieces shown at 1.5-2x.

**Next weakest: position choice.** On these solos the player sits higher up the neck (mean fret
7.4) than TabGen places notes (6.4); a fret-12 phrase on the A/D/G strings comes out at fret 7 on
the next string up. Same pitches, different (playable) tab — see gap 7.

## 10. p2.8: note thresholds for electric guitar, fingering up the neck, tempo fix

**Note detection.** Basic Pitch's decoder thresholds were swept on GuitarSet (acoustic) only.
`eval/bp_sweep_electric.py` sweeps them from one model pass per clip on Guitar-TECHS P3 solos (two
halves), GuitarSet 05 and IDMT licks. 0.75 / 0.40 / 70 ms beats the shipped 0.65 / 0.35 / 100 ms on
every set at once (note F1, 50 ms): P3 0.627/0.659 -> 0.661/0.675, GuitarSet 05 0.821 -> 0.823,
IDMT 0.752 -> 0.770. A stricter onset drops ghost notes; the shorter minimum keeps fast runs.

**Fingering.** With true pitches the fingering alone gets 0.51 on the P3 solos (best possible rule
tuning, fitted on the test itself: 0.62). Fitting on half the solos plus the old train sets and
testing on the other half kept one change that generalised: the penalty per fret above 12 drops
0.6 -> 0.1 (oracle P3 0.508 -> 0.533, GuitarSet 05 0.640 -> 0.641, IDMT Les Paul 0.550 -> 0.550;
GuitarSet tab F1 on audio, players 04-05: 0.702 -> 0.702). TabCNN's string prior stays at weight
1.4: lowering it costs P3 tab F1 (0.7: 0.384, 0: 0.349), though it is often wrong high on the neck
(it was trained on acoustic GuitarSet). Inharmonicity per note was tried as a string cue on the
Guitar-TECHS single-note sets and was too noisy on amped tone to use yet (`eval/strings/`).

| 12 P3 solos, mean | note F1 | tab F1 | string+fret right |
|---|---|---|---|
| p2.6 | 0.60 | 0.34 | 0.56 |
| p2.7 (bass leak) | 0.66 | 0.37 | 0.55 |
| **p2.8** | **0.69** | **0.39** | **0.56** |

**Tempo.** The trackers count the 50-58 BPM solos at double time or on triplets (55 -> 107,
50 -> 94, 58 -> 176/88); a felt-tempo rule overfit before, so the BPM badge now offers x2 / /2
(edits.json `tempo_factor`, reanalysis from cached stems). gt-04 with /2: 107.1 -> 53.5 BPM.

## 6. Remaining gaps, ranked by impact

1. **Note transcription on distorted chords** (note F1 ≈ 0.53 on distorted comping). Basic Pitch
   hears intermodulation as notes. Needs a guitar-specific transcriber trained with amp augmentation
   (e.g. a GuitarSet+EGDB/EGDB-PG fine-tune); no permissively licensed weights exist today.
2. **Bends on distorted, reverb-heavy leads.** Bend recall is ~0.45 on IDMT and visibly lower on the
   Comfortably Numb cover. Needs a pitch tracker that follows one string through the bend
   (e.g. a monophonic f0 model on the lead stem) instead of reading Basic Pitch's note split.
3. **Beat grid on slow songs** can still lock to double time when both trackers agree on it
   (Comfortably Numb: 125 instead of 63). p2.6 fixed the 68 BPM and fast-jazz cases (§8); this one
   needs a learned beat-level model or the user's tap tempo. Unaccompanied solos: 0.53 right.
4. **Rhythm + lead in one stem.** p2.5 splits them by stereo position, or by lead line vs comping
   when both are centred (§7). Centred guitars remain weak (0.24–0.38 per-guitar tab F1).
5. **Hammer-on / pull-off accuracy is unmeasured** — no public labeled set was found. Precision on
   picked material is now high; recall is unknown.
6. **Slide precision ~0.6, recall ~0.4** — slides are often confused with vibrato wobble or a re-pick; a small
   learned transition classifier (IDMT + synthetic) would help.
7. **Fingering still ~30-45% wrong on electric solos** where several positions are equally playable
   (Guitar-TECHS: 0.56 right after p2.8, §10; rule tuning tops out near 0.62 even fitted on the test).
   TabCNN's prior is the main audio cue; a timbre-based string classifier would close more of it.
8. Editing, tuner and play-along exist (p2.6). Play-along is weak on jazz/bossa voicings and needs
   headphones; there is no Guitar Pro export yet. Real electric solos are now scored (§9); a real commercial
   song with a trusted tab is still missing (GOAT has covers + Guitar Pro tabs, by request).
