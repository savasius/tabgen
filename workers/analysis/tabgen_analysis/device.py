import logging
from typing import Callable, TypeVar

from .config import DEVICE

log = logging.getLogger(__name__)
T = TypeVar("T")


def run_with_fallback(stage: str, fn: Callable[[str], T]) -> T:
    """Run fn(device); if a GPU backend (mps/cuda) fails, retry once on CPU."""
    if DEVICE == "cpu":
        return fn("cpu")
    try:
        return fn(DEVICE)
    except Exception as e:  # MPS lacks some ops; CPU is always correct, just slower
        log.warning("%s failed on %s (%s); retrying on cpu", stage, DEVICE, e)
        return fn("cpu")
