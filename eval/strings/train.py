"""Train the string classifier (tabgen_analysis/string_model.py) on the Mac GPU and test it on notes
it never saw: the 12 Guitar-TECHS player-3 solos and GuitarSet player 05.

  PYTHONPATH=workers/analysis .venv/bin/python eval/strings/train.py [--epochs 30]

Reports per-note string accuracy (true pitch given) next to two baselines: the most common string
for that pitch in training, and "lowest fret" (what a beginner would write).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "workers" / "analysis"))

from tabgen_analysis import string_model as sm  # noqa: E402

DATA = REPO / "data" / "eval" / "strings"


def load(name):
    d = np.load(DATA / f"{name}.npz")
    return d["x"].astype(np.float32), d["midi"].astype(np.int64), d["string"].astype(np.int64), d["group"]


def masks(midi):
    return np.stack([sm.feasible(int(m)) for m in midi])


def accuracy(model, x, midi, y, device, batch=1024):
    import torch
    model.eval()
    hits = 0
    with torch.no_grad():
        for i in range(0, len(y), batch):
            xb = torch.from_numpy(x[i:i + batch]).to(device)
            mb = torch.from_numpy(midi[i:i + batch]).to(device)
            kb = torch.from_numpy(masks(midi[i:i + batch])).to(device)
            hits += int((model(xb, mb, kb).argmax(1).cpu().numpy() == y[i:i + batch]).sum())
    return hits / max(1, len(y))


def baselines(train_midi, train_y, midi, y):
    prior = {}
    for m, s in zip(train_midi, train_y):
        prior.setdefault(int(m), np.zeros(6))[s] += 1
    common = np.array([int(np.argmax(prior.get(int(m), np.ones(6)) * sm.feasible(int(m)))) for m in midi])
    lowest = np.array([max(s for s in range(6) if sm.feasible(int(m))[s]) for m in midi])  # thinnest string = lowest fret
    return float((common == y).mean()), float((lowest == y).mean())


def main():
    import torch
    from torch import nn
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    device = "mps" if torch.backends.mps.is_available() else "cpu"

    x, midi, y, g = load("train")
    groups = np.unique(g)
    val_g = set(rng.choice(groups, size=max(1, len(groups) // 7), replace=False).tolist())
    val = np.isin(g, list(val_g))
    xt, mt, yt = x[~val], midi[~val], y[~val]
    xv, mv, yv = x[val], midi[val], y[val]
    tests = {n: load(n) for n in ("test_p3", "test_gs05")}
    print(f"train {len(yt)} notes, val {len(yv)}, " + ", ".join(f"{n} {len(v[2])}" for n, v in tests.items()), flush=True)
    for n, (_, tm, ty, _) in tests.items():
        c, lo = baselines(mt, yt, tm, ty)
        print(f"baseline {n}: most common string {c:.3f}, lowest fret {lo:.3f}", flush=True)

    model = sm.build_model().to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=args.epochs * (len(yt) // 256 + 1))
    lossf = nn.CrossEntropyLoss()  # no label smoothing: it would push mass onto masked (impossible) strings
    mk = masks(mt)
    best, best_state = -1.0, None
    for ep in range(args.epochs):
        model.train()
        order = rng.permutation(len(yt))
        for i in range(0, len(order), 256):
            idx = order[i:i + 256]
            xb = xt[idx].copy()
            # augment: a frame of timing jitter, a quarter-tone of pitch jitter, a little noise
            xb = np.roll(xb, rng.integers(-1, 2), axis=2)
            xb = np.roll(xb, rng.integers(-1, 2), axis=1)
            xb = np.clip(xb + rng.normal(0, 0.03, xb.shape).astype(np.float32), 0, 1)
            out = model(torch.from_numpy(xb).to(device), torch.from_numpy(mt[idx]).to(device),
                        torch.from_numpy(mk[idx]).to(device))
            loss = lossf(out, torch.from_numpy(yt[idx]).to(device))
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
        va = accuracy(model, xv, mv, yv, device)
        msg = f"epoch {ep + 1:2d} loss {loss.item():.3f} val {va:.3f}"
        if va > best:
            best, best_state = va, {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            msg += " *"
        print(msg, flush=True)

    model.load_state_dict(best_state)
    for n, (tx, tm, ty, _) in tests.items():
        print(f"TEST {n}: string accuracy {accuracy(model, tx, tm, ty, device):.3f}", flush=True)
    out = sm.model_path()
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save(best_state, out)
    print("saved", out)


if __name__ == "__main__":
    main()
