import argparse
import json
import logging
import sys
from pathlib import Path

from . import pipeline


def main() -> None:
    p = argparse.ArgumentParser(description="Analyze a song: beats, sections, chords, key")
    p.add_argument("audio", type=Path)
    p.add_argument("-o", "--out", type=Path, help="write analysis JSON here (default: stdout summary)")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO)

    res = pipeline.run(args.audio, meta={"title": args.audio.stem, "source": "file"},
                       progress=lambda s, pct: print(f"[{pct:3d}%] {s}", file=sys.stderr))
    if args.out:
        args.out.write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(json.dumps({k: res[k] for k in ("id", "duration", "tempo", "key", "tuning", "timings")}, indent=1))
    print("sections:", [(s["label"], s["start"]) for s in res["sections"]])
    print("chords:", " ".join(c["normal"] for c in res["chords"][:40]))
    tab = res.get("tab") or {}
    stats = tab.get("stats") or {}
    print("tab:", stats.get("n_notes"), "notes", stats.get("fallback") or "", tab.get("error") or "")


if __name__ == "__main__":
    main()
