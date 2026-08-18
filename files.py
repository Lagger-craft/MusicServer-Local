import logging
import os
import re
import threading

from cache import ThreadSafeCache
from config import get_music_dirs

logger = logging.getLogger(__name__)

AUDIO_EXTENSIONS = {".mp3", ".flac", ".wav", ".ogg", ".m4a", ".wma", ".opus"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mkv", ".avi", ".mov", ".flv"}
ALL_EXTENSIONS = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS
IGNORED_FOLDERS = {
    ".stfolder", ".stversions", "@eaDir",
    "thumbnails", ".thumbnails", "covers", ".cache",
}

MIME_TYPES = {
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".wma": "audio/x-ms-wma",
    ".opus": "audio/ogg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".mov": "video/quicktime",
    ".flv": "video/x-flv",
    ".png": "image/png",
}

_list_cache = ThreadSafeCache(ttl=300, name="file_list")
_list_refreshing = False
_list_refresh_lock = threading.Lock()


def resolve_path(path):
    dirs = get_music_dirs()
    if "/" in path:
        maybe_key, rest = path.split("/", 1)
        for d in dirs:
            if d["key"] == maybe_key:
                return d, rest
    return dirs[0], path


def is_safe_path(directory, path):
    if not isinstance(path, str):
        return False
    # Reject actual traversal segments ("."/"..") but allow them inside
    # filenames, e.g. an ellipsis "..." or "Letra..". The realpath guard
    # below still blocks genuine traversal like ../../etc/passwd.
    if any(part in (".", "..") for part in path.split("/")):
        return False
    resolved = os.path.realpath(os.path.join(directory, path))
    allowed = os.path.realpath(directory)
    return resolved.startswith(allowed + os.sep) or resolved == allowed


def is_valid_song_path(path):
    try:
        d, rel = resolve_path(path)
        return is_safe_path(d["path"], rel)
    except Exception:
        return False


def get_file_type(filename):
    _, ext = os.path.splitext(filename.lower())
    if ext in VIDEO_EXTENSIONS:
        return "video"
    return "audio"


def get_mime_type(filename):
    _, ext = os.path.splitext(filename.lower())
    return MIME_TYPES.get(ext, "application/octet-stream")


# ── File serving with Range support ─────────────────────────

def serve_file_with_range(full_path, filename):
    """Serve a file with proper Range header support (206 Partial Content).
    Returns a Flask Response object."""
    from flask import Response, request

    file_size = os.path.getsize(full_path)
    mime = get_mime_type(filename)
    range_header = request.headers.get("Range")

    if range_header:
        m = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if m:
            start = int(m.group(1))
            end_str = m.group(2)
            end = int(end_str) if end_str else file_size - 1
            end = min(end, file_size - 1)
            length = end - start + 1

            if start >= file_size or length <= 0:
                return Response(status=416, headers={
                    "Content-Range": f"bytes */{file_size}",
                    "Accept-Ranges": "bytes",
                })

            def gen_range():
                with open(full_path, "rb") as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = f.read(min(65536, remaining))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk

            resp = Response(
                gen_range(),
                status=206,
                mimetype=mime,
                direct_passthrough=True,
            )
            resp.headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
            resp.headers["Content-Length"] = str(length)
            resp.headers["Accept-Ranges"] = "bytes"
            return resp

    def gen_full():
        with open(full_path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                yield chunk

    resp = Response(gen_full(), mimetype=mime, direct_passthrough=True)
    resp.headers["Content-Length"] = str(file_size)
    resp.headers["Accept-Ranges"] = "bytes"
    return resp


# ── File listing with stale-while-revalidate ────────────────

def _refresh_file_list():
    files = []
    for d in get_music_dirs():
        base = d["path"]
        key = d["key"]
        if not os.path.isdir(base):
            logger.warning("Music directory not found: %s (%s)", base, key)
            continue
        for root, _, filenames in os.walk(base):
            for filename in filenames:
                if any(filename.lower().endswith(ext) for ext in ALL_EXTENSIONS):
                    abs_path = os.path.join(root, filename)
                    rel_path = os.path.relpath(abs_path, base)
                    full_path = os.path.join(key, rel_path)
                    cover_name = os.path.splitext(filename)[0] + ".png"
                    cover_path = os.path.join(root, cover_name)
                    files.append({
                        "name": filename,
                        "path": full_path,
                        "cover": os.path.join(key, cover_name) if os.path.exists(cover_path) else None,
                        "type": get_file_type(filename),
                        "mtime": os.path.getmtime(abs_path),
                    })
    files.sort(key=lambda x: x["name"].lower())
    _list_cache.set(files)
    logger.info("Refreshed file list: %d files from %d directories", len(files), len(get_music_dirs()))
    return files


def list_files():
    cached = _list_cache.get()
    if cached is not None:
        return cached

    stale_data, _ = _list_cache.get_all()
    if stale_data is not None:
        _trigger_background_refresh()
        return stale_data

    return _refresh_file_list()


def _trigger_background_refresh():
    global _list_refreshing
    if not _list_refresh_lock.acquire(blocking=False):
        return
    try:
        if _list_refreshing:
            return
        _list_refreshing = True
        t = threading.Thread(target=_background_refresh, daemon=True)
        t.start()
    finally:
        _list_refresh_lock.release()


def _background_refresh():
    try:
        _refresh_file_list()
    except Exception as e:
        logger.error("Background file list refresh failed: %s", e)
    finally:
        global _list_refreshing
        _list_refreshing = False


def get_list_cache():
    return _list_cache


# ── File watcher ────────────────────────────────────────────

_observer = None
_watch_lock = threading.Lock()


def start_watcher():
    global _observer
    with _watch_lock:
        if _observer is not None:
            return

    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler

        class MusicFileHandler(FileSystemEventHandler):
            def on_any_event(self, event):
                if event.is_directory:
                    return
                ext = os.path.splitext(event.src_path.lower())[1]
                if ext in ALL_EXTENSIONS:
                    _list_cache.invalidate(
                        reason=f"fs change: {event.event_type} {os.path.basename(event.src_path)}"
                    )

        _observer = Observer()
        dirs = get_music_dirs()
        handler = MusicFileHandler()
        for d in dirs:
            if os.path.isdir(d["path"]):
                _observer.schedule(handler, d["path"], recursive=True)
                logger.info("Watching directory: %s (%s)", d["path"], d["key"])
        _observer.start()
        logger.info("File watcher started")
    except ImportError:
        logger.warning("watchdog not installed, file watcher disabled")
    except Exception as e:
        logger.error("Failed to start file watcher: %s", e)
        _observer = None


def stop_watcher():
    global _observer
    with _watch_lock:
        if _observer is None:
            return
        try:
            _observer.stop()
            _observer.join()
            logger.info("File watcher stopped")
        except Exception as e:
            logger.error("Failed to stop file watcher: %s", e)
        finally:
            _observer = None
