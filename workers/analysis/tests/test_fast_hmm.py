"""The compiled Viterbi must decode exactly what madmom-infer's NumPy version decodes."""

import numpy as np
import pytest

hmm = pytest.importorskip("madmom_infer.ml.hmm")
_NUMPY_VITERBI = hmm.HiddenMarkovModel.viterbi


class _Obs(hmm.ObservationModel):
    def log_densities(self, observations):
        return observations


@pytest.mark.parametrize("seed", range(6))
def test_same_path_as_numpy_viterbi(seed):
    from tabgen_analysis import fast_hmm
    rng = np.random.default_rng(seed)
    n, frames, dens = 60, 300, 7
    dst, src, probs = [], [], []
    for s in range(n):  # every state goes somewhere; some states are never reached
        k = int(rng.integers(1, 4))
        to = rng.choice(n, size=k, replace=False)
        p = rng.random(k) + 1e-3
        dst += list(to); src += [s] * k; probs += list(p / p.sum())
    tm = hmm.TransitionModel.from_dense(np.array(dst), np.array(src), np.array(probs))
    om = _Obs(rng.integers(0, dens, n).astype(np.uint32))
    obs = np.log(rng.random((frames, dens)))
    if seed % 2:
        obs[rng.random(obs.shape) < 0.01] = np.nan  # the NaN rules must match too
    model = hmm.HiddenMarkovModel(tm, om)
    want_path, want_lp = _NUMPY_VITERBI(model, obs)
    got_path, got_lp = fast_hmm.viterbi(model, obs)
    assert np.array_equal(want_path, got_path)
    assert got_lp == pytest.approx(want_lp)
