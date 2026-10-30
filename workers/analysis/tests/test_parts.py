import numpy as np

from tabgen_analysis import parts


def _pan(y, p):
    th = (p + 1) * np.pi / 4
    return np.stack([np.cos(th) * y, np.sin(th) * y], axis=1)


def _tone(f, sr=22050, dur=3.0, seed=0):
    t = np.arange(int(sr * dur)) / sr
    rng = np.random.default_rng(seed)
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)
            + 0.01 * rng.standard_normal(len(t))).astype(np.float32)


def test_two_panned_guitars_are_split_left_to_right():
    left, right = _tone(196.0), _tone(523.0, seed=1)
    found = parts.stereo_parts(_pan(left, -0.8) + _pan(right, 0.8))
    assert len(found) == 2
    assert found[0].pan < -0.5 < 0.5 < found[1].pan
    # each output keeps mostly its own guitar
    spec = [np.abs(np.fft.rfft(p.audio)) for p in found]
    freqs = np.fft.rfftfreq(len(found[0].audio), 1 / 22050)
    near = lambda s, f: s[np.abs(freqs - f) < 5].sum()  # noqa: E731
    assert near(spec[0], 196) > 5 * near(spec[0], 523)
    assert near(spec[1], 523) > 5 * near(spec[1], 196)


def test_centred_stem_is_one_guitar():
    y = _tone(196.0) + _tone(330.0, seed=2)
    assert len(parts.stereo_parts(_pan(y, 0.0))) == 1
    assert len(parts.stereo_parts(y)) == 1  # mono input


def _strums(t0, n, every=0.5, root=40):
    return [{"start": t0 + i * every + d, "end": t0 + i * every + 0.45, "midi": root + iv, "velocity": 0.6}
            for i in range(n) for d, iv in ((0.0, 0), (0.005, 7), (0.01, 12), (0.015, 16))]


def _line(t0, n, every=0.25, start=69):
    shape = [0, 2, 3, 5, 7, 5, 3, 2]
    return [{"start": t0 + i * every, "end": t0 + i * every + 0.22, "midi": start + shape[i % 8],
             "velocity": 0.7} for i in range(n)]


def test_classify_part():
    assert parts.classify_part(_line(0, 40)) == "lead"
    assert parts.classify_part(_strums(0, 30)) == "rhythm"


def test_split_roles_puts_the_line_in_lead():
    # A lead line between the strums (the common case: fills over sustained chords).
    notes = _strums(0, 20, every=1.0) + _line(0.5, 40, every=0.5)
    lead, rhythm = parts.split_roles(notes)
    lead_line = sum(1 for n in lead if n["midi"] >= 69)
    assert lead_line >= 0.8 * 40
    assert all(n["midi"] < 69 for n in rhythm if n["start"] % 1.0 < 0.1)


def test_plain_comping_is_not_sent_to_the_role_split():
    # split_roles itself would peel the chord tops off; callers gate it with classify_part.
    assert parts.classify_part(_strums(0, 30)) != "mixed"
    assert parts.classify_part(_line(0, 40)) != "mixed"
    assert parts.classify_part(_strums(0, 20, every=1.0) + _line(0.5, 40, every=0.5)) == "mixed"


def test_dedupe_bleed_keeps_doubling_drops_leakage():
    loud = {"start": 1.0, "end": 1.5, "midi": 60, "velocity": 0.8}
    leak = {"start": 1.01, "end": 1.5, "midi": 60, "velocity": 0.2}
    double = {"start": 1.02, "end": 1.5, "midi": 60, "velocity": 0.7}
    a, b = parts.dedupe_bleed([[loud], [leak]])
    assert a == [loud] and b == []
    a, b = parts.dedupe_bleed([[loud], [double]])
    assert a == [loud] and b == [double]


def test_assign_roles_one_lead_at_most():
    rhythm, lead = _strums(0, 30), _line(0, 40)
    assert parts.assign_roles([rhythm, lead]) == ["rhythm", "lead"]
    assert parts.assign_roles([rhythm, _strums(0.2, 30, root=45)]) == ["rhythm", "rhythm"]
    # two equally lead-like lines: no clear lead, so neither is promoted
    assert parts.assign_roles([lead, _line(0.1, 40)]).count("lead") <= 1
