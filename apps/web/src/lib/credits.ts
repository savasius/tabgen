/**
 * Third-party components the app runs, with the credit their licenses ask for (shown in
 * Settings → About). Keep in step with THIRD_PARTY_LICENSES.md.
 */
export interface Credit {
  name: string
  role: 'separation' | 'notes' | 'strings' | 'beats' | 'sections' | 'chords' | 'render' | 'diagrams' | 'app'
  license: string
  url: string
  /** attribution text the license requires, when it requires one */
  notice?: string
}

export const CREDITS: Credit[] = [
  { name: 'Demucs (htdemucs_6s)', role: 'separation', license: 'MIT (code); weights: see note', url: 'https://github.com/adefossez/demucs' },
  { name: 'Basic Pitch', role: 'notes', license: 'Apache-2.0', url: 'https://github.com/spotify/basic-pitch', notice: 'Copyright 2022 Spotify AB' },
  {
    name: 'TabCNN-GPFX', role: 'strings', license: 'CC BY 4.0', url: 'https://huggingface.co/cstr/tabcnn-onnx',
    notice: 'Trained on GuitarSet (Xi et al., 2018) and the guitar-FX data of Pedroza et al. (DAFx-24).',
  },
  { name: 'Beat This!', role: 'beats', license: 'MIT', url: 'https://github.com/CPJKU/beat_this', notice: 'Foscarin, Schlüter & Widmer, ISMIR 2024' },
  { name: 'All-In-One', role: 'sections', license: 'MIT', url: 'https://github.com/mir-aidj/all-in-one', notice: 'Kim & Nam, WASPAA 2023' },
  { name: 'lv-chordia', role: 'chords', license: 'MIT', url: 'https://github.com/openmirlab/lv-chordia', notice: 'Jiang, Chen, Li & Xia, ISMIR 2019' },
  { name: 'alphaTab', role: 'render', license: 'MPL-2.0', url: 'https://alphatab.net', notice: 'Source of alphaTab: github.com/CoderLine/alphaTab' },
  { name: 'SVGuitar · chords-db', role: 'diagrams', license: 'MIT', url: 'https://github.com/omnibrain/svguitar' },
  { name: 'React · Vite · FastAPI · PyTorch · librosa · onnxruntime', role: 'app', license: 'MIT / BSD / ISC', url: 'https://github.com/savasius/tabgen/blob/main/THIRD_PARTY_LICENSES.md' },
]
