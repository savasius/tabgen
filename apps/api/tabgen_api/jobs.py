"""In-process job queue. One worker thread: the models are CPU/GPU heavy and share memory.

Swappable later for Redis + arq (see docs/design.md §3.3) without changing the HTTP API.
"""

import logging
import shutil
import tempfile
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path

from tabgen_analysis import config, pipeline
from tabgen_analysis.stages.decode import decode, probe_tags

from . import library, sources

log = logging.getLogger(__name__)


@dataclass
class Job:
    id: str
    status: str = "queued"  # queued | running | done | failed
    stage: str = "queued"
    progress: int = 0
    analysis_id: str | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return asdict(self)


_jobs: dict[str, Job] = {}
_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="analysis")


def get(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def _new_job() -> Job:
    job = Job(id=uuid.uuid4().hex[:12])
    with _lock:
        _jobs[job.id] = job
    return job


def _set(job: Job, **kw) -> None:
    with _lock:
        for k, v in kw.items():
            setattr(job, k, v)


def _run(job: Job, fetch, meta: dict) -> None:
    tmpdir = Path(tempfile.mkdtemp(prefix="tabgen-"))
    try:
        _set(job, status="running", stage="fetching" if meta.get("source") == "url" else "decoding", progress=1)
        audio_path, fetched_meta = fetch(tmpdir)
        meta = {**meta, **{k: v for k, v in fetched_meta.items() if v}}
        _set(job, stage="decoding", progress=3)
        audio_hash, _ = decode(audio_path)
        _set(job, analysis_id=audio_hash)
        pipeline.run(audio_path, meta=meta, audio_hash=audio_hash,
                     progress=lambda stage, pct: _set(job, stage=stage, progress=pct))
        library.upsert(audio_hash, meta)
        _set(job, status="done", stage="done", progress=100)
    except Exception as e:
        log.error("job %s failed: %s", job.id, traceback.format_exc())
        _set(job, status="failed", error=str(e) or e.__class__.__name__)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def submit_upload(upload_path: Path, filename: str) -> Job:
    job = _new_job()
    meta = {"title": Path(filename).stem, "source": "upload", "filename": filename}

    def fetch(tmp: Path):
        moved = tmp / upload_path.name
        shutil.move(str(upload_path), moved)  # removed with tmpdir after the job
        return moved, probe_tags(moved)

    _executor.submit(_run, job, fetch, meta)
    return job


def submit_url(url: str) -> Job:
    job = _new_job()
    meta = {"source": "url", "url": url, "youtube_id": sources.youtube_id(url)}
    _executor.submit(_run, job, lambda tmp: sources.download(url, tmp), meta)
    return job


def submit_reanalyze(audio_hash: str) -> Job:
    """Re-run the current pipeline on cached mix/stems.

    Real Demucs stems are reused. Mix-copy stems from older engines are discarded so
    Demucs runs again; chords/tabs always listen to the guitar stem.
    """
    job = _new_job()

    def work():
        try:
            mix = config.track_dir(audio_hash) / "mix.wav"
            if not mix.exists():
                raise FileNotFoundError("Cached audio missing — please upload the file again")
            _set(job, status="running", analysis_id=audio_hash, stage="transcribe", progress=5)
            meta = library.get(audio_hash) or {}
            pipeline.run(mix, meta=meta, audio_hash=audio_hash, force=True,
                         progress=lambda stage, pct: _set(job, stage=stage, progress=pct))
            library.upsert(audio_hash, meta)
            _set(job, status="done", stage="done", progress=100)
        except Exception as e:
            log.error("reanalyze %s failed: %s", job.id, traceback.format_exc())
            _set(job, status="failed", error=str(e) or e.__class__.__name__)

    _executor.submit(work)
    return job
