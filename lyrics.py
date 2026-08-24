"""LRCLIB lyrics provider with .lrc sidecar support.

Lookup priority: .lrc sidecar file > LRCLIB cache > LRCLIB fetch > empty.

Public contract of :func:`get_lyrics`:
    ``{"plainLyrics": str, "syncedLyrics": str, "instrumental": bool, "source": str}``

It NEVER raises; on any failure it returns an empty result so the route can
respond 200 with no lyrics body.
"""
import logging
import os
import re
import time

import requests

logger = logging.getLogger(__name__)

LRCLIB_BASE = "https://lrclib.net/api"
REQUEST_TIMEOUT = 15
USER_AGENT = "MusicServer-Local/1.0 (+https://github.com/local/music-server)"

# Directory for .lrc sidecar files (separate from music for security).
# In Docker: /lyrics (mounted as ./lyrics:rw)
# Local dev: ./lyrics (relative to app root)
LYRICS_DIR = os.environ.get("LYRICS_DIR", "./lyrics")

# Honor LRCLIB rate limits (429) by pausing outbound calls for the duration
# advertised in the Retry-After header. This is a server-side backoff: while the
# cooldown is active we skip the network entirely and return empty lyrics, so a
# single rate-limited client never blocks a Flask worker or hammers LRCLIB
# (the LRCLIB docs explicitly require honoring Retry-After to avoid a ban).
_rate_limited_until = 0.0

LRC_LINE_RE = re.compile(r"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]")


def _is_rate_limited():
    return time.time() < _rate_limited_until


def _record_rate_limit(retry_after):
    global _rate_limited_until
    try:
        seconds = float(retry_after)
    except (TypeError, ValueError):
        seconds = 60.0
    if seconds < 0:
        seconds = 60.0
    _rate_limited_until = max(_rate_limited_until, time.time() + seconds)


def _has_synced_tags(text):
    return bool(LRC_LINE_RE.search(text))


def _read_sidecar(audio_full_path):
    lrc_path = get_sidecar_path(audio_full_path)
    if not os.path.isfile(lrc_path):
        return None
    try:
        with open(lrc_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError as e:
        logger.warning("Failed to read sidecar %s: %s", lrc_path, e)
        return None


def _sidecar_result(text):
    if _has_synced_tags(text):
        return {"plainLyrics": "", "syncedLyrics": text, "instrumental": False, "source": "sidecar"}
    return {"plainLyrics": text, "syncedLyrics": "", "instrumental": False, "source": "sidecar"}


def get_sidecar_path(audio_full_path):
    """Return the .lrc path in LYRICS_DIR, mirroring the audio's relative structure.
    
    Example:
        audio_full_path = "/music/main/cancion.mp3"
        returns "/lyrics/main/cancion.lrc"
    """
    # Extract relative path after the music directory prefix
    # audio_full_path comes from resolve_path which gives us the full path
    # We need to find which music_dir it's under and get the relative part
    from config import get_music_dirs
    
    for music_dir in get_music_dirs():
        if audio_full_path.startswith(music_dir["path"]):
            rel_path = os.path.relpath(audio_full_path, music_dir["path"])
            # Build lyrics path: LYRICS_DIR/relative_without_ext.lrc
            lrc_rel = os.path.splitext(rel_path)[0] + ".lrc"
            return os.path.join(LYRICS_DIR, lrc_rel)
    
    # Fallback: if not under any music_dir, use the filename only
    base, _ = os.path.splitext(os.path.basename(audio_full_path))
    return os.path.join(LYRICS_DIR, base + ".lrc")


def save_lyrics_file(audio_full_path, lyrics_text):
    lrc_path = get_sidecar_path(audio_full_path)
    # Ensure directory exists
    os.makedirs(os.path.dirname(lrc_path), exist_ok=True)
    with open(lrc_path, "w", encoding="utf-8") as f:
        f.write(lyrics_text)
    return lrc_path


def get_lyrics(path, meta, audio_full_path=None):
    """Return lyrics for a track, or an empty result on any failure.

    Priority: .lrc sidecar > LRCLIB network fetch.

    Args:
        path: prefixed media path (used for logging / cache-key context).
        meta: metadata dict with at least ``artist`` and ``title``.
        audio_full_path: absolute filesystem path to the audio file (for sidecar lookup).

    Returns:
        dict with keys ``plainLyrics``, ``syncedLyrics``, ``instrumental``, ``source``.
    """
    empty = {"plainLyrics": "", "syncedLyrics": "", "instrumental": False, "source": "none"}

    if audio_full_path:
        sidecar_text = _read_sidecar(audio_full_path)
        if sidecar_text is not None:
            return _sidecar_result(sidecar_text)

    if _is_rate_limited():
        return empty

    if not meta:
        return empty

    artist = (meta.get("artist") or "").strip()
    title = (meta.get("title") or "").strip()
    if not artist or not title:
        return empty

    params = {"artist_name": artist, "track_name": title}
    album = (meta.get("album") or "").strip()
    if album:
        params["album_name"] = album
    duration = meta.get("duration")
    if isinstance(duration, int) and duration > 0:
        params["duration"] = duration

    try:
        resp = requests.get(
            LRCLIB_BASE + "/get",
            params=params,
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": USER_AGENT},
        )
    except requests.RequestException as e:
        logger.warning("LRCLIB request failed for %s: %s", path, e)
        return empty

    if resp.status_code == 429:
        retry_after = resp.headers.get("Retry-After")
        logger.warning(
            "LRCLIB rate-limited (429) for %s; Retry-After=%s", path, retry_after
        )
        _record_rate_limit(retry_after)
        return empty

    if resp.status_code == 404:
        return empty

    if not resp.ok:
        logger.warning("LRCLIB unexpected status %s for %s", resp.status_code, path)
        return empty

    try:
        data = resp.json() or {}
    except ValueError:
        logger.warning("LRCLIB returned non-JSON for %s", path)
        return empty

    if data.get("instrumental"):
        return {"plainLyrics": "", "syncedLyrics": "", "instrumental": True, "source": "lrclib"}

    return {
        "plainLyrics": data.get("plainLyrics") or "",
        "syncedLyrics": data.get("syncedLyrics") or "",
        "instrumental": False,
        "source": "lrclib",
    }
