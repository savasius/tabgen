import json
import logging
import shutil
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from tabgen_analysis import PIPELINE_VERSION, config, edits, pipeline
from tabgen_analysis.stages import guitar_parts
from tabgen_analysis.stages.separate import resolve_playback, stems_dir

STEM_NAMES = ("guitar", "vocals", "bass", "drums", "piano", "other", "harmonic")

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
            "pipeline_version": PIPELINE_VERSION,
            "audio_stems": ["mix", "original", "guitar"]}


class _Diag(BaseModel):
    lines: list[str]


@app.post("/v1/diag")
def client_diag(body: _Diag, request: Request):
    """Microphone / audio events from a phone or browser, appended to data/logs/client.log so a
    "the tuner doesn't work on my phone" report can be read instead of guessed (local only)."""
    ua = request.headers.get("user-agent", "")
    who = "iphone" if "iPhone" in ua else "ipad" if "iPad" in ua else "mac-app" if "TabGenMac" in ua else "browser"
    log_dir = config.DATA_DIR / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S")
    with open(log_dir / "client.log", "a", encoding="utf-8") as f:
        for line in body.lines[:200]:
            f.write(f"{stamp} {who} {line[:500]}\n")
    return {"ok": True}


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
    out = []
    for e in library.list_recent():
        found = pipeline.find_analysis(e["id"])
        if not found and not (config.track_dir(e["id"]) / "mix.wav").exists():
            continue
        summary_p = config.track_dir(e["id"]) / "summary.json"
        summary = json.loads(summary_p.read_text()) if summary_p.exists() else {}
        version = found.stem.split("@", 1)[-1] if found else None
        out.append({**e, "stale": bool(version and version != PIPELINE_VERSION),
                    "guitars": summary.get("guitars", 1) if summary.get("version") == version else 1,
                    "edited": edits.edits_path(e["id"]).exists()})
    return out


def _analysis_file(analysis_id: str) -> Path:
    if not analysis_id.isalnum():
        raise HTTPException(400, "Bad id")
    p = pipeline.find_analysis(analysis_id)
    if not p:
        raise HTTPException(404, "Analysis not found")
    return p


def _load_analysis(analysis_id: str) -> dict:
    """The stored analysis with the user's hand corrections (edits.json) applied."""
    data = json.loads(_analysis_file(analysis_id).read_text())
    data["meta"] = {**data.get("meta", {}), **(library.get(analysis_id) or {})}
    return edits.apply(data)


def _tab_of(data: dict, part: str) -> dict:
    if part == "all":
        if not data.get("tab"):
            raise HTTPException(404, "No tab yet — reanalyze this song")
        return data["tab"]
    for p in data.get("parts") or []:
        if p["id"] == part:
            return p["tab"]
    raise HTTPException(404, f"No guitar part {part!r}")


@app.get("/v1/analyses/{analysis_id}")
def get_analysis(analysis_id: str):
    data = _load_analysis(analysis_id)
    data.pop("raw_chords", None)
    data["stale"] = data.get("version") != PIPELINE_VERSION
    if data.get("tab"):
        data["tab"].pop("musicxml", None)
    data.setdefault("tab", None)
    stem_root = stems_dir(config.track_dir(analysis_id))
    data["stems"] = {name: (stem_root / f"{name}.wav").exists() for name in STEM_NAMES}
    return data


@app.post("/v1/analyses/{analysis_id}/reanalyze")
def reanalyze(analysis_id: str):
    if not analysis_id.isalnum():
        raise HTTPException(400, "Bad id")
    mix = config.track_dir(analysis_id) / "mix.wav"
    if not mix.exists():
        raise HTTPException(404, "Cached audio missing — upload the file again")
    return jobs.submit_reanalyze(analysis_id).to_dict()


@app.get("/v1/analyses/{analysis_id}/export/musicxml")
def export_musicxml(analysis_id: str, part: str = Query("all")):
    data = _load_analysis(analysis_id)
    tab = _tab_of(data, part)
    p = pipeline.tab_musicxml_path(analysis_id) if part == "all" else pipeline.part_musicxml_path(analysis_id, part)
    name = f"{analysis_id}{'' if part == 'all' else '-' + part}.musicxml"
    media = "application/vnd.recordare.musicxml+xml"
    if tab.get("edited") or not p.exists():
        return Response(edits.musicxml(data, tab), media_type=media,
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})
    return FileResponse(p, media_type=media, filename=name)


@app.get("/v1/analyses/{analysis_id}/export/alphatex")
def export_alphatex(analysis_id: str, part: str = Query("all")):
    tex = _tab_of(_load_analysis(analysis_id), part).get("alpha_tex")
    if not tex:
        raise HTTPException(404, "No tab yet — reanalyze this song")
    name = f"{analysis_id}{'' if part == 'all' else '-' + part}.alphatex"
    return Response(tex, media_type="text/plain", headers={"Content-Disposition": f'attachment; filename="{name}"'})


class TabEdit(BaseModel):
    part: str = "all"
    notes: list[dict]


class ChordEdit(BaseModel):
    part: str = "all"
    beats: dict[str, str]


@app.put("/v1/analyses/{analysis_id}/edits/tab")
def put_tab_edit(analysis_id: str, body: TabEdit):
    """Replace one guitar's notes with the user's corrected version; returns the analysis."""
    data = _load_analysis(analysis_id)
    tab = _tab_of(data, body.part)
    try:
        notes = edits.clean_notes(body.notes, tab.get("tuning") or [], int(tab.get("capo") or 0), data["duration"])
    except (KeyError, ValueError, TypeError) as e:
        raise HTTPException(400, f"Bad note: {e}") from e
    edits.set_tab(analysis_id, body.part, notes)
    return get_analysis(analysis_id)


@app.delete("/v1/analyses/{analysis_id}/edits/tab")
def revert_tab_edit(analysis_id: str, part: str = Query("all")):
    _analysis_file(analysis_id)
    edits.set_tab(analysis_id, part, None)
    return get_analysis(analysis_id)


@app.put("/v1/analyses/{analysis_id}/edits/chords")
def put_chord_edit(analysis_id: str, body: ChordEdit):
    """Set chord labels on beats (merged into earlier corrections); returns the analysis."""
    _analysis_file(analysis_id)
    prev = (edits.load(analysis_id).get("chords") or {}).get(body.part, {})
    try:
        edits.set_chords(analysis_id, body.part, {**prev, **body.beats})
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return get_analysis(analysis_id)


@app.delete("/v1/analyses/{analysis_id}/edits/chords")
def revert_chord_edit(analysis_id: str, part: str = Query("all")):
    _analysis_file(analysis_id)
    edits.set_chords(analysis_id, part, None)
    return get_analysis(analysis_id)


@app.patch("/v1/analyses/{analysis_id}")
def patch_analysis(analysis_id: str, body: LibraryPatch):
    _analysis_file(analysis_id)
    fields = body.model_dump(exclude_unset=True)
    if "youtube_id" in fields and fields["youtube_id"]:
        fields["youtube_id"] = sources.youtube_id(fields["youtube_id"]) or fields["youtube_id"]
    return library.update(analysis_id, **fields) or library.upsert(analysis_id, fields) or library.get(analysis_id)


@app.api_route("/v1/analyses/{analysis_id}/stems/{name}", methods=["GET", "HEAD"])
def get_stem(analysis_id: str, name: str):
    """Alias for isolated Demucs stems. Guitar matches `audio?stem=guitar`."""
    _analysis_file(analysis_id)
    kind = name.lower().strip()
    if kind in ("guitar", "gitar", "mix", "original"):
        try:
            path, media = resolve_playback(config.track_dir(analysis_id), kind)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        except FileNotFoundError as e:
            raise HTTPException(404, str(e)) from e
        return FileResponse(path, media_type=media, filename=f"{analysis_id}-{kind}.wav")
    if kind not in STEM_NAMES:
        raise HTTPException(400, f"Unknown stem: {name}")
    p = stems_dir(config.track_dir(analysis_id)) / f"{kind}.wav"
    if not p.exists():
        raise HTTPException(404, f"No {name} stem")
    return FileResponse(p, media_type="audio/wav", filename=f"{analysis_id}-{kind}.wav")


@app.api_route("/v1/analyses/{analysis_id}/audio", methods=["GET", "HEAD"])
def get_audio(analysis_id: str, stem: str = Query("mix", description="mix | original | guitar"),
              part: str | None = Query(None, description="one guitar of the stem, e.g. s1")):
    """Full mix, or `?stem=guitar` for the isolated Demucs guitar stem (PR #3).

    `&part=s1` plays one guitar split out of that stem by stereo position (analysis.parts)."""
    _analysis_file(analysis_id)
    if part is not None:
        if not part.isalnum():
            raise HTTPException(400, "Bad part id")
        p = guitar_parts.part_audio_path(analysis_id, part)
        if not p.exists():
            raise HTTPException(404, "No such guitar part — reanalyze this song")
        return FileResponse(p, media_type="audio/wav")
    try:
        path, media = resolve_playback(config.track_dir(analysis_id), stem)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    return FileResponse(path, media_type=media)


class _WebFiles(StaticFiles):
    """The built web app. index.html is always revalidated, so a phone or the Mac app picks up a
    new build instead of a cached page pointing at old (hashed) scripts."""

    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        if path in ("", ".", "index.html") or path.endswith(".webmanifest"):
            resp.headers["Cache-Control"] = "no-cache"
        return resp


_WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
if _WEB_DIST.exists():
    app.mount("/", _WebFiles(directory=_WEB_DIST, html=True), name="web")
