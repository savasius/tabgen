"""Link input via yt-dlp — personal/local mode only (TABGEN_URL_INGEST=1).

YouTube's ToS forbids downloading; keep this off for any public deployment.
"""

import re
from pathlib import Path

_YT_ID = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})")


def youtube_id(url: str) -> str | None:
    m = _YT_ID.search(url)
    return m.group(1) if m else None


def download(url: str, out_dir: Path) -> tuple[Path, dict]:
    try:
        import yt_dlp
    except ImportError as e:
        raise RuntimeError("yt-dlp is not installed (pip install yt-dlp)") from e

    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(out_dir / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "max_filesize": 200 * 1024 * 1024,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        path = Path(ydl.prepare_filename(info))
    if not path.exists():
        candidates = sorted(out_dir.glob("source.*"))
        if not candidates:
            raise RuntimeError("Download produced no audio file")
        path = candidates[0]
    meta = {
        "title": info.get("track") or info.get("title"),
        "artist": info.get("artist") or info.get("uploader"),
        "thumbnail": info.get("thumbnail"),
    }
    return path, meta
