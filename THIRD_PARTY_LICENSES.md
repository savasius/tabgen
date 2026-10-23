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
| [Basic Pitch](https://github.com/spotify/basic-pitch) (Spotify) | guitar note events + pitch contours | Apache-2.0 | Apache-2.0 (ICASSP 2022 ONNX in the wheel) | low |
| [TabCNN-GPFX](https://huggingface.co/cstr/tabcnn-onnx) ONNX | optional string/fret prior | CC BY 4.0 | CC BY 4.0 (GuitarSet + Pedroza et al. DAFx-24; cite both) | low (attribution) |
| [onnxruntime](https://onnxruntime.ai) | Basic Pitch + TabCNN inference | MIT | — | low |

### Evaluation data (not shipped, not redistributed — downloaded into `data/eval/` by hand)

| Dataset | Used for | License | Risk |
|---|---|---|---|
| [GuitarSet](https://zenodo.org/records/3371780) (Xi et al. 2018) | note / string+fret ground truth (`eval/tab_bench.py`), fingering fit | CC BY 4.0 | low (cite) |
| [IDMT-SMT-Guitar v2](https://zenodo.org/records/7544110) (Kehling et al. 2014) | bend / slide / vibrato + electric-guitar tab check (`eval/technique_bench.py`), fingering fit | CC BY-NC-ND 4.0 | eval only; fitted weights are a handful of numbers, no audio or labels are redistributed |
| [pretty-midi](https://github.com/craffel/pretty-midi) | MIDI helper | MIT | — | low |
| [alphaTab](https://alphatab.net) (`@coderline/alphatab`) | tab render + cursor | **MPL-2.0** | — | visible attribution required; modified MPL files must stay open |
| React, Vite, FastAPI, PyTorch, NumPy, SciPy | app framework | MIT / BSD | — | low |
| YouTube IFrame Player API | optional synced video playback (no download) | YouTube API ToS | — | allowed embed use |

Deliberately **not** used: madmom pretrained models (CC BY-NC-SA), Essentia (AGPL + NC models),
Chordino/NNLS-Chroma (GPL), BTC chord model (weights marked NC in redistributions), Rubber Band (GPL).
Slow-down uses the browser's built-in pitch-preserving `playbackRate`.

Apple Silicon: Demucs is forced to CPU (`demucs_device()`), because PyTorch MPS raises
`Output channels > 65536 not supported` on those convs. Beat This! / S-KEY can still use MPS
and fall back to CPU if an op is missing.
