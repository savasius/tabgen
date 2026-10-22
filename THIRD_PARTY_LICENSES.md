# Third-party components and licenses

TabGen is currently a **free, personal-use** tool. Before any public release, re-check every row below
(see `docs/design.md` in the project notes for the full risk analysis). Not legal advice.

| Component | Used for | Code license | Weights / data | Risk for publishing |
|---|---|---|---|---|
| [Beat This!](https://github.com/CPJKU/beat_this) | beats, downbeats, tempo | MIT | MIT (`final0`; mirrored on Hugging Face, same SHA-256) | low |
| [all-in-one-infer](https://github.com/openmirlab/all-in-one-infer) (fork of [All-In-One](https://github.com/mir-aidj/all-in-one)) | sections (intro/verse/chorus/…) | MIT | MIT (Harmonix-trained) | low–medium (uses Demucs stems) |
| [madmom-infer](https://pypi.org/project/madmom-infer/) | DBN post-processing inside all-in-one-infer | BSD | ships **no** madmom NC model files | low |
| [lv-chordia](https://github.com/openmirlab/lv-chordia) (Jiang et al., ISMIR 2019) | chord recognition | MIT | MIT claimed; trained on annotation sets with non-commercial terms | **medium** — swappable via `ChordRecognizer` |
| [S-KEY](https://github.com/deezer/s-key) (Deezer) | global key | MIT | MIT (bundled) | low |
| [Demucs](https://github.com/adefossez/demucs) `htdemucs_6s` (via demucs-infer) | stem separation | MIT | weights trained incl. MUSDB18 (NC data); status unclear | **medium** |
| [librosa](https://librosa.org) | tuning estimate, audio I/O | ISC | — | low |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | link input (personal mode only) | Unlicense | — | **high if hosted publicly** (YouTube ToS); disable with `TABGEN_URL_INGEST=0` |
| [FFmpeg](https://ffmpeg.org) | decoding (external binary) | LGPL/GPL build-dependent | — | call as external process only |
| [chords-db](https://github.com/tombatossals/chords-db) | chord diagrams data | MIT | — | low |
| [SVGuitar](https://github.com/omnibrain/svguitar) | chord diagram rendering | MIT | — | low |
| React, Vite, FastAPI, PyTorch, NumPy, SciPy | app framework | MIT / BSD | — | low |
| YouTube IFrame Player API | optional synced video playback (no download) | YouTube API ToS | — | allowed embed use |

Deliberately **not** used: madmom pretrained models (CC BY-NC-SA), Essentia (AGPL + NC models),
Chordino/NNLS-Chroma (GPL), BTC chord model (weights marked NC in redistributions), Rubber Band (GPL).
Slow-down uses the browser's built-in pitch-preserving `playbackRate`.
