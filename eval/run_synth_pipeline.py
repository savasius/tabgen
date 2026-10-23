"""Run the Phase 2 pipeline on synth eval clips.

TABGEN_SKIP_SEPARATE=1 is correct here: the clip already IS isolated guitar, not a mix.
Real user uploads never set this; they always run Demucs.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import numpy as np

os.environ.setdefault("TABGEN_SKIP_SEPARATE", "1")
os.environ.setdefault("TABGEN_DATA_DIR", str(Path(__file__).resolve().parents[1] / "data"))

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(REPO / "workers" / "analysis"))
sys.path.insert(0, str(HERE))

from score import score_file  # noqa: E402
from synth import render_one, songs  # noqa: E402
from tabgen_analysis import config, pipeline  # noqa: E402
from tabgen_analysis.cache import write_json_atomic  # noqa: E402


def main() -> None:
    np.random.seed(0)
    out_dir = REPO / "data" / "eval"
    lib_path = config.DATA_DIR / "library.json"
    lib = json.loads(lib_path.read_text()) if lib_path.exists() else {}
    results = []
    for spec in songs():
        ref = render_one(spec, out_dir)
        print(f"==> {spec['id']}", flush=True)
        res = pipeline.run(Path(ref["wav"]), meta={"title": spec["title"], "source": "eval", "artist": "TabGen eval"},
                           force=True)
        ap = pipeline.analysis_path(res["id"])
        scored = score_file(ap, ref)
        results.append(scored)
        lib[res["id"]] = {
            "id": res["id"],
            "title": spec["title"],
            "artist": "TabGen eval",
            "source": "eval",
            "updated_at": time.time(),
        }
        print(json.dumps(scored, default=str), flush=True)
    write_json_atomic(lib_path, lib)
    summary_path = REPO / "data" / "eval" / "summary.json"
    summary_path.write_text(json.dumps(results, indent=2, default=str))
    print("summary →", summary_path)


if __name__ == "__main__":
    main()
