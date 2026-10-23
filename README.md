# TabGen

**TR:** Bir şarkıyı yükle (ya da bağlantısını yapıştır); TabGen tempoyu, vuruşları, bölümleri
(giriş / kıta / nakarat / solo…), her vuruşun akorunu ve **gitar tab'ını** çıkarır. Şarkı çalarken
akor ızgarası veya tab (alphaTab + ölçü tablosu) senkron kayar. Bölüm döngüsü, perdeyi bozmadan
yavaşlatma, ton değiştirme, kapo önerisi ve "Basit / Normal / Tam" akor seviyesi var. Tamamen
**kendi bilgisayarında, ücretsiz** çalışır. (Aşama 3: mikrofonla "birlikte çal" kontrolü.)

**EN:** Upload a song (or paste a link) and TabGen finds tempo, beats, sections, per-beat chords and
guitar tab, then shows them synced to playback (chords grid or alphaTab), with section looping,
pitch-preserving slow-down, transpose, capo suggestions and a simplified-chord toggle. Runs locally,
free, no cloud.

## Quick start (macOS, Apple Silicon or Intel)

```bash
git clone https://github.com/savasius/tabgen && cd tabgen
./scripts/setup.sh     # one time: installs ffmpeg/node/python via Homebrew if missing, models (~1 GB), web build
./scripts/run.sh       # opens http://localhost:8000
```

That's it. Drop an MP3/M4A/WAV/FLAC on the page, or paste a YouTube/SoundCloud link.
A 4-minute song takes about 2–3 minutes the first time on a laptop CPU; afterwards it's cached
(same audio → instant).

Linux works the same way (`apt install ffmpeg nodejs python3-venv` first). Windows: use WSL2.

- Open from your phone on the same Wi-Fi: `HOST=0.0.0.0 ./scripts/run.sh`, then `http://<mac-ip>:8000`.
- Turn off link input: `TABGEN_URL_INGEST=0 ./scripts/run.sh`.
- Force CPU (if Apple GPU/MPS misbehaves): `TABGEN_DEVICE=cpu ./scripts/run.sh`.
- Data (decoded audio, stems, analyses) lives in `./data/` — delete it to clear the cache.

## Using it

| Control | What it does |
|---|---|
| Section strip | click = jump; double-click = loop that section |
| Grid | one cell per beat, one box per bar; click a beat to jump there |
| Speed 50–125% | slows down without changing pitch |
| Loop A / B | first press marks bar A, second marks bar B; or "Loop this section" (`L`) |
| Count-in | clicks one bar before playback starts |
| Transpose ± | renames chords by semitones (audio is not pitch-shifted yet) |
| Capo | shows the shapes to play with a capo; the suggested capo is pre-selected |
| Basit / Normal / Tam | Simple = major/minor only, Normal = up to 7ths, Full = everything incl. inversions |
| Akorlar / Tab | chord grid, Songsterr-like tab staff (now-line + section jump), light alphaTab stave, fretboard, measure table |
| Yeniden analiz et | rebuild chords+tab from cached stems (Phase 1 Mac runs are reused; Demucs does not run again) |
| Player → YouTube | play the official YouTube video instead of the file (embed, nothing downloaded); paste the link and adjust the sync offset |

Keyboard: `Space` play/pause, `←/→` previous/next bar, `L` loop current section.

## How it works

```
upload / link ──▶ decode (ffmpeg, sha256 of PCM = cache key)
                 ├─ Demucs htdemucs_6s ─▶ stems (required; Apple MPS is CPU-only). Mix copies are not stems.
                 ├─ Beat This! on the mix ─▶ beats, downbeats, BPM (All-In-One 2× check; fold ½×/2× into 70–168)
                 ├─ All-In-One (our stems) ─▶ sections
                 ├─ lv-chordia on the isolated guitar stem ─▶ chords  (never mix / harmonic)
                 ├─ S-KEY + tuning on the guitar stem
                 ├─ post: beat grid, maj/min flicker or missing-third notes → :5, key from chord hierarchy
                 ├─ guitar stem → Basic Pitch (+ TabCNN-GPFX prior) → octave-clean → 16th quantize → Viterbi
                 └─ techniques (bend/vibrato from contour; H/P/slide heuristic) → alphaTex + MusicXML
```

If Demucs fails, the job fails — the mix is never analyzed as guitar. A weak/empty guitar stem
still runs chords and tabs on that stem and sets `guitar.warning` (loud UI banner). Re-upload of
the same file, or **Yeniden analiz et**, reuses real Demucs stems; mix-copy leftovers are discarded
so Demucs runs again. `TABGEN_SKIP_SEPARATE=1` is eval/tests only (the clip already IS guitar).

Playback: `GET /v1/analyses/{id}/audio?stem=mix|original|guitar`.

Each stage is cached separately under `data/tracks/<hash>/stages/`, so swapping one model only
recomputes that stage. Chord recognition is behind a `ChordRecognizer` interface
(`workers/analysis/tabgen_analysis/stages/chords.py`).

## Repo layout

```
apps/api/          FastAPI app + in-process job queue (serves the built web app)
apps/web/          React + Vite + TypeScript UI (src/music = chord/capo/transpose logic + tests)
workers/analysis/  Python analysis pipeline (one module per stage) + tests
eval/              accuracy sanity check script
scripts/           setup.sh, run.sh, dev.sh
.cursor/           Cursor rules + cloud/remote dev environment
```

## Development

```bash
./scripts/dev.sh                          # API with reload on :8000 + Vite hot reload on :5173
cd apps/web && npx vitest run             # chord logic tests
.venv/bin/python -m pytest workers/analysis/tests
.venv/bin/tabgen-analyze song.mp3 -o out.json   # pipeline without the web UI
.venv/bin/python eval/check.py data/tracks/<hash>/analysis@*.json --expect "G D Em C" --key "G major"
```

**Continuing from Cursor (desktop, web or mobile):** the repo ships `.cursor/environment.json`
(install = `./scripts/setup.sh`, terminal = `./scripts/dev.sh`) and `.cursor/rules/project.mdc`
(architecture + conventions for the agent). Start a Cloud Agent on this repo from cursor.com/agents
or the mobile app and it gets the same environment.

## Licenses

TabGen's own code: license to be decided (see `LICENSE`). Third-party models and libraries, and
which ones carry non-commercial or copyleft risk, are listed in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). In short: everything used is MIT/BSD/ISC-licensed
code; the **lv-chordia** and **Demucs** weights were trained on data with non-commercial terms, and
**yt-dlp** link input must be disabled for any public deployment. No GPL/AGPL components are
linked (FFmpeg is called as an external program).
