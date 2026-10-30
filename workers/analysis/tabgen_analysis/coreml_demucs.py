"""htdemucs_6s on Core ML (Apple GPU): the same network, ~8x faster than PyTorch on the CPU.

PyTorch can't run Demucs on the Mac GPU (MPS: "Output channels > 65536 not supported"), so every
song paid ~2 s of CPU per 7.8 s segment. Here the network between the STFT and the inverse STFT
is converted once to a Core ML program (fp32, stored under the models dir) and swapped in as the
forward of the loaded model; the STFT, masking, inverse STFT and Demucs' own segment overlap-add
stay in PyTorch, so stems match the CPU path (guitar stem differs by about -120 dB).

Off with TABGEN_COREML=0; any failure falls back to PyTorch on the CPU.
"""

from __future__ import annotations

import logging
import os
import platform
from pathlib import Path

import torch
from einops import rearrange

from .config import models_dir

log = logging.getLogger(__name__)

VERSION = "v1"  # bump when the wrapper or conversion changes


def enabled() -> bool:
    if os.environ.get("TABGEN_COREML", "1") == "0" or platform.system() != "Darwin":
        return False
    try:
        import coremltools  # noqa: F401
    except ImportError:
        return False
    return True


class _Core(torch.nn.Module):
    """HTDemucs.forward between _magnitude() and _mask(); inputs: mix and its cac spectrogram."""

    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, mix, mag):
        m = self.m
        x = mag
        B, C, Fq, T = x.shape
        mean = x.mean(dim=(1, 2, 3), keepdim=True)
        std = x.std(dim=(1, 2, 3), keepdim=True)
        x = (x - mean) / (1e-5 + std)
        xt = mix
        meant = xt.mean(dim=(1, 2), keepdim=True)
        stdt = xt.std(dim=(1, 2), keepdim=True)
        xt = (xt - meant) / (1e-5 + stdt)
        saved, saved_t, lengths, lengths_t = [], [], [], []
        for idx, encode in enumerate(m.encoder):
            lengths.append(x.shape[-1])
            inject = None
            if idx < len(m.tencoder):
                lengths_t.append(xt.shape[-1])
                tenc = m.tencoder[idx]
                xt = tenc(xt)
                if not tenc.empty:
                    saved_t.append(xt)
                else:
                    inject = xt
            x = encode(x, inject)
            if idx == 0 and m.freq_emb is not None:
                frs = torch.arange(x.shape[-2], device=x.device)
                emb = m.freq_emb(frs).t()[None, :, :, None].expand_as(x)
                x = x + m.freq_emb_scale * emb
            saved.append(x)
        if m.crosstransformer:
            if m.bottom_channels:
                b, c, f, t = x.shape
                x = rearrange(x, "b c f t-> b c (f t)")
                x = m.channel_upsampler(x)
                x = rearrange(x, "b c (f t)-> b c f t", f=f)
                xt = m.channel_upsampler_t(xt)
            x, xt = m.crosstransformer(x, xt)
            if m.bottom_channels:
                x = rearrange(x, "b c f t-> b c (f t)")
                x = m.channel_downsampler(x)
                x = rearrange(x, "b c (f t)-> b c f t", f=f)
                xt = m.channel_downsampler_t(xt)
        for idx, decode in enumerate(m.decoder):
            skip = saved.pop(-1)
            x, pre = decode(x, skip, lengths.pop(-1))
            offset = m.depth - len(m.tdecoder)
            if idx >= offset:
                tdec = m.tdecoder[idx - offset]
                length_t = lengths_t.pop(-1)
                if tdec.empty:
                    pre = pre[:, :, 0]
                    xt, _ = tdec(pre, None, length_t)
                else:
                    xt, _ = tdec(xt, saved_t.pop(-1), length_t)
        S = len(m.sources)
        x = x.view(B, S, -1, Fq, T)
        x = x * std[:, None] + mean[:, None]
        xt = xt.view(B, S, -1, mix.shape[-1])
        xt = xt * stdt[:, None] + meant[:, None]
        return x, xt


def _patch_int_cast() -> None:
    """coremltools 9 + recent PyTorch: aten::Int on a 1-element constant arrives as an array."""
    import numpy as np
    from coremltools.converters.mil import Builder as mb
    from coremltools.converters.mil.frontend.torch import ops
    orig = ops._cast

    def _cast(context, node, dtype, dtype_name):
        x = ops._get_inputs(context, node, expected=1)[0]
        if x.can_be_folded_to_const() and not isinstance(x.val, dtype) and np.size(x.val) == 1:
            context.add(mb.const(val=dtype(np.asarray(x.val).reshape(-1)[0]), name=node.name))
            return
        orig(context, node, dtype, dtype_name)
    ops._cast = _cast


def model_path(name: str) -> Path:
    return models_dir() / f"{name}-core-{VERSION}.mlpackage"


def _convert(m, path: Path) -> None:
    import coremltools as ct
    _patch_int_cast()
    torch.backends.mha.set_fastpath_enabled(False)  # fused attention has no Core ML converter
    L = int(m.segment * m.samplerate)
    mix = torch.zeros(1, m.audio_channels, L)
    mag = m._magnitude(m._spec(mix))
    with torch.no_grad():
        traced = torch.jit.trace(_Core(m).eval(), (mix, mag), check_trace=False)
    ml = ct.convert(traced, inputs=[ct.TensorType("mix", shape=mix.shape), ct.TensorType("mag", shape=mag.shape)],
                    outputs=[ct.TensorType("spec_out"), ct.TensorType("wave_out")],
                    compute_precision=ct.precision.FLOAT32, minimum_deployment_target=ct.target.macOS14,
                    convert_to="mlprogram")
    tmp = path.with_suffix(".tmp.mlpackage")
    ml.save(str(tmp))
    tmp.rename(path)


def accelerate(model, name: str) -> bool:
    """Swap Core ML in for the forward of every HTDemucs in `model` (a model or a bag)."""
    import coremltools as ct
    subs = list(getattr(model, "models", [model]))
    for i, m in enumerate(subs):
        if not hasattr(m, "crosstransformer"):
            return False  # not an HTDemucs: leave it to PyTorch
        path = model_path(f"{name}-{i}")
        if not path.exists():
            log.info("Converting %s to Core ML (once, ~1 min)", name)
            path.parent.mkdir(parents=True, exist_ok=True)
            _convert(m.eval(), path)
        m.forward = _make_forward(m, _load(path))
    return True


def _load(path: Path):
    """Load the program, keeping the compiled form next to it (0.25 s instead of 1.7 s per song)."""
    import shutil

    import coremltools as ct
    units = ct.ComputeUnit.CPU_AND_GPU
    compiled = path.with_suffix(".mlmodelc")
    if compiled.exists():
        try:
            return ct.models.CompiledMLModel(str(compiled), compute_units=units)
        except Exception as e:  # noqa: BLE001 -- e.g. compiled by an older macOS: rebuild it
            log.info("recompiling %s (%s)", path.name, e)
            shutil.rmtree(compiled, ignore_errors=True)
    ml = ct.models.MLModel(str(path), compute_units=units)
    try:
        shutil.copytree(ml.get_compiled_model_path(), compiled)
    except OSError as e:
        log.info("could not keep compiled model: %s", e)
    return ml


def _make_forward(m, ml):
    L = int(m.segment * m.samplerate)

    def forward(mix: torch.Tensor) -> torch.Tensor:
        length = mix.shape[-1]
        if length < L:
            mix = torch.nn.functional.pad(mix, (0, L - length))
        outs = []
        for b in range(mix.shape[0]):
            one = mix[b:b + 1].float().cpu()
            z = m._spec(one)
            mag = m._magnitude(z)
            r = ml.predict({"mix": one.numpy(), "mag": mag.numpy()})
            x = torch.from_numpy(r["spec_out"])
            xt = torch.from_numpy(r["wave_out"])
            outs.append(xt + m._ispec(m._mask(z, x), L))
        out = torch.cat(outs, 0)
        return out[..., :length]
    return forward
