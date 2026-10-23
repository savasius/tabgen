import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from typing import Callable, TypeVar

from .config import DEVICE, demucs_device

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


def run_on_device(stage: str, fn: Callable[[str], T], device: str | None = None) -> T:
    """Like run_with_fallback but a caller can pin the first device (e.g. Demucs→CPU on MPS)."""
    first = device if device is not None else DEVICE
    if first == "cpu":
        return fn("cpu")
    try:
        return fn(first)
    except Exception as e:
        log.warning("%s failed on %s (%s); retrying on cpu", stage, first, e)
        return fn("cpu")


def run_with_timeout(name: str, fn: Callable[[], T], timeout_s: float | None) -> T:
    """Best-effort timeout. The worker thread is not killed; the caller should treat it as failed."""
    if not timeout_s or timeout_s <= 0:
        return fn()
    ex = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"t-{name}")
    try:
        return ex.submit(fn).result(timeout=timeout_s)
    except FuturesTimeout as e:
        raise TimeoutError(f"{name} exceeded {timeout_s:.0f}s") from e
    finally:
        ex.shutdown(wait=False, cancel_futures=True)
