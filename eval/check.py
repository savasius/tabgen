"""Quick sanity eval against a song's known chord vocabulary (no time-aligned reference needed).

Usage: python eval/check.py data/tracks/<hash>/analysis@*.json --expect "B F# G#m E" --key "B major" [--capo 4]

Reports the share of chord-bearing beats whose simplified chord (basic level) is in the expected
set, root-only agreement (forgives major/minor confusions, e.g. on power chords), and the key.
This is a proxy, not a mir_eval frame score — add .lab references under eval/refs/ for that.
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "workers" / "analysis"))
from tabgen_analysis.chord_label import parse, pc  # noqa: E402


def sym(label: str) -> str:
    c = parse(parse(label).level("basic"))
    if c.is_none or c.root is None:
        return "N"
    if c.quality == "5":
        return c.root + "5"
    return c.root + ("m" if c.quality == "min" else "")


def norm(s: str) -> str:
    root = s[:2] if len(s) > 1 and s[1] in "#b" else s[:1]
    return parse(f"{root}:{'min' if s[len(root):].startswith('m') else 'maj'}").level("basic")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("analysis", type=Path)
    ap.add_argument("--expect", required=True, help='space-separated sounding chords, e.g. "F Bb Ab Db"')
    ap.add_argument("--key", help='e.g. "F minor"')
    args = ap.parse_args()

    a = json.loads(args.analysis.read_text())
    expected = {sym(norm(x)) for x in args.expect.split()}
    expected_roots = {parse(norm(x)).root for x in args.expect.split()}
    beats = [sym(g["chord"]) for g in a["grid"]]
    voiced = [b for b in beats if b != "N"]

    def family(s: str) -> str:
        return s[:-1] if s.endswith("5") else s.rstrip("m")

    in_vocab = sum(
        b in expected
        or (b.endswith("5") and (family(b) in expected or family(b) + "m" in expected))
        for b in voiced
    ) / max(1, len(voiced))
    root_ok = sum(family(b) in expected_roots for b in voiced) / max(1, len(voiced))

    print(f"title: {a['meta'].get('title')}  duration: {a['duration']:.0f}s  bpm: {a['tempo']['bpm']} "
          f"(allin1 {a['tempo'].get('bpm_allin1')})  {a['tempo']['time_signature']}")
    if args.key:
        tonic, mode = args.key.split()
        ok = pc(tonic) == pc(a["key"]["tonic"]) and mode == a["key"]["mode"]
        print(f"key: {a['key']['tonic']} {a['key']['mode']} ({a['key']['confidence']:.2f}) expected {args.key} -> "
              f"{'OK' if ok else 'MISS'}")
    print(f"beats: {len(beats)}  no-chord: {len(beats) - len(voiced)}")
    print(f"in expected vocabulary (basic level): {in_vocab:.1%}")
    print(f"root in expected roots:               {root_ok:.1%}")
    print("top chords:", Counter(voiced).most_common(8))
    print("sections:", ", ".join(f"{s['label']}@{s['start']:.0f}s" for s in a["sections"]))
    print("timings (s):", a.get("timings"))


if __name__ == "__main__":
    main()
