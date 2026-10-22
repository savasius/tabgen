import json
import logging
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from tabgen_analysis import PIPELINE_VERSION, config, pipeline

from . import jobs, library, sources

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="TabGen API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ALLOWED_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".webm", ".mp4", ".aiff", ".aif"}


class UrlJob(BaseModel):
    url: str


class LibraryPatch(BaseModel):
    title: str | None = None
    artist: str | None = None
    youtube_id: str | None = None
    youtube_offset: float | None = None


@app.get("/v1/config")
def get_config():
    return {"url_ingest_enabled": config.URL_INGEST_ENABLED, "device": config.DEVICE,
            "pipeline_version": PIPELINE_VERSION}


@app.post("/v1/jobs/upload")
async def create_upload_job(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Unsupported file type: {ext or 'unknown'}")
    uploads = config.DATA_DIR / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(suffix=ext, dir=uploads)
    with open(fd, "wb") as out:
        shutil.copyfileobj(file.file, out)
    job = jobs.submit_upload(Path(tmp), file.filename or "upload")
    return job.to_dict()


@app.post("/v1/jobs/url")
def create_url_job(body: UrlJob):
    if not config.URL_INGEST_ENABLED:
        raise HTTPException(403, "Link input is disabled (TABGEN_URL_INGEST=0)")
    if not body.url.startswith(("http://", "https://")):
        raise HTTPException(400, "Invalid URL")
    return jobs.submit_url(body.url).to_dict()


@app.get("/v1/jobs/{job_id}")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job.to_dict()


@app.get("/v1/analyses")
def list_analyses():
    return [e for e in library.list_recent() if pipeline.analysis_path(e["id"]).exists()]


def _analysis_file(analysis_id: str) -> Path:
    if not analysis_id.isalnum():
        raise HTTPException(400, "Bad id")
    p = pipeline.analysis_path(analysis_id)
    if not p.exists():
        raise HTTPException(404, "Analysis not found")
    return p


@app.get("/v1/analyses/{analysis_id}")
def get_analysis(analysis_id: str):
    data = json.loads(_analysis_file(analysis_id).read_text())
    data["meta"] = {**data.get("meta", {}), **(library.get(analysis_id) or {})}
    data.pop("raw_chords", None)
    return data


@app.patch("/v1/analyses/{analysis_id}")
def patch_analysis(analysis_id: str, body: LibraryPatch):
    _analysis_file(analysis_id)
    fields = body.model_dump(exclude_unset=True)
    if "youtube_id" in fields and fields["youtube_id"]:
        fields["youtube_id"] = sources.youtube_id(fields["youtube_id"]) or fields["youtube_id"]
    return library.update(analysis_id, **fields) or library.upsert(analysis_id, fields) or library.get(analysis_id)


@app.get("/v1/analyses/{analysis_id}/audio")
def get_audio(analysis_id: str):
    _analysis_file(analysis_id)
    return FileResponse(config.track_dir(analysis_id) / "playback.mp3", media_type="audio/mpeg")


_WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
if _WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=_WEB_DIST, html=True), name="web")
