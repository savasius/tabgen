"""Compiled Viterbi for madmom-infer's HMM (All-In-One's beat/downbeat decoding).

madmom-infer replaces madmom's Cython Viterbi with NumPy that loops over frames in Python; on a
2:22 song All-In-One spent ~14 s of its 24 s there. This is the same algorithm as a Numba loop with
the same rules (first predecessor wins ties, a NaN never wins, a NaN result decodes to -inf), so
the decoded path is identical -- see tests/test_fast_hmm.py.
"""

from __future__ import annotations

import warnings

import numpy as np
from numba import njit


@njit(cache=True)
def _viterbi_kernel(prev, tm_states, tm_pointers, tm_logp, density, bt):
    n_obs, n_states = density.shape
    cur = np.empty(n_states)
    for f in range(n_obs):
        for s in range(n_states):
            best = -np.inf
            arg = -1
            for k in range(tm_pointers[s], tm_pointers[s + 1]):
                c = prev[tm_states[k]] + tm_logp[k]
                if c > best:  # strict: ties keep the first predecessor; NaN never wins
                    best = c
                    arg = k
            if arg >= 0:
                bt[f, s] = tm_states[arg]
            v = best + density[f, s]
            cur[s] = -np.inf if np.isnan(v) else v
        for s in range(n_states):
            prev[s] = cur[s]
    return prev


def viterbi(self, observations):
    """Drop-in for madmom_infer.ml.hmm.HiddenMarkovModel.viterbi."""
    tm = self.transition_model
    om = self.observation_model
    tm_states = np.asarray(tm.states, dtype=np.int64)
    tm_pointers = np.asarray(tm.pointers, dtype=np.int64)
    tm_logp = np.asarray(tm.log_probabilities, dtype=np.float64)
    om_pointers = np.asarray(om.pointers, dtype=np.int64)
    density = np.ascontiguousarray(np.asarray(om.log_densities(observations), dtype=np.float64)[:, om_pointers])
    n_obs, n_states = density.shape
    bt = np.zeros((n_obs, n_states), dtype=np.uint32)
    with np.errstate(divide="ignore"):
        prev = np.log(self.initial_distribution).astype(np.float64)
    last = _viterbi_kernel(prev, tm_states, tm_pointers, tm_logp, density, bt)

    state = int(np.argmax(last))
    log_probability = float(last[state])
    if np.isinf(log_probability):
        warnings.warn("-inf log probability during Viterbi decoding cannot find a valid path", RuntimeWarning)
        return np.empty(0, dtype=np.uint32), log_probability
    path = np.empty(n_obs, dtype=np.uint32)
    for frame in range(n_obs - 1, -1, -1):
        path[frame] = state
        state = int(bt[frame, state])
    return path, log_probability


_installed = False


def install() -> None:
    global _installed
    if _installed:
        return
    from madmom_infer.ml import hmm
    hmm.HiddenMarkovModel.viterbi = viterbi
    _installed = True
