"""Download all model weights once (so the first song isn't slow). python -m tabgen_analysis.prefetch"""

import logging


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    log = logging.getLogger("prefetch")

    from .stages.beats import ensure_checkpoint
    log.info("Beat This! -> %s", ensure_checkpoint())

    from demucs_infer.pretrained import get_model
    get_model("htdemucs_6s")
    log.info("Demucs htdemucs_6s ready")

    from allin1_infer.models import load_pretrained_model
    load_pretrained_model("harmonix-all", device="cpu")
    log.info("All-In-One harmonix-all ready")

    import lv_chordia  # noqa: F401  weights ship inside the wheel
    import skey  # noqa: F401  weights ship inside the package
    log.info("lv-chordia and S-KEY ready (bundled weights)")


if __name__ == "__main__":
    main()
