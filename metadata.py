"""Lazy per-track metadata extraction.

Reads tags via mutagen on demand (never during list_files) and falls back
to filename parsing when tags are absent. Results are cached by the caller
(e.g. ``metadata_cache`` in app.py).
"""
import logging
import os

from files import is_safe_path, resolve_path

logger = logging.getLogger(__name__)


def parse_filename(filename):
    """Parse ``Artist - Title`` or ``Artist - Title - Album`` from a filename.

    Returns ``{"artist", "title", "album"}``. When the basename contains no
    ``" - "`` separator, title is the basename (no extension) and artist/album
    are ``None``, matching the spec Filename Fallback requirement.
    """
    base = os.path.splitext(os.path.basename(filename))[0]
    parts = [p.strip() for p in base.split(" - ")]
    if len(parts) <= 1:
        return {"artist": None, "title": (parts[0] if parts else None), "album": None}
    if len(parts) == 2:
        return {"artist": parts[0] or None, "title": parts[1] or None, "album": None}
    return {
        "artist": parts[0] or None,
        "title": parts[1] or None,
        "album": " - ".join(parts[2:]) or None,
    }


def _get_tag(tags, names):
    """Return the first available tag value from a mutagen easy-tag mapping."""
    for name in names:
        if name in tags:
            value = tags[name]
            if isinstance(value, (list, tuple)) and value:
                return value[0] if isinstance(value[0], str) else None
            if isinstance(value, str):
                return value
    return None


def _has_embedded_cover(full_path):
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(full_path)
        if audio is None:
            return False
        for key in audio.keys():
            if key.upper().startswith("APIC"):
                return True
        pictures = getattr(audio, "pictures", None)
        if pictures:
            return True
        if "covr" in audio:  # MP4
            return True
    except Exception as e:  # pragma: no cover - defensive
        logger.debug("embedded cover check failed for %s: %s", full_path, e)
    return False


def get_metadata(path):
    """Return metadata dict for a prefixed media path, or None if invalid/missing.

    Contract: ``{artist, title, album, duration, cover, path}``.
    Tags are read lazily with mutagen; when absent, filename fallback applies.
    ``cover`` is True when an embedded APIC picture or a sidecar ``.png`` exists.
    """
    d, rel = resolve_path(path)
    if not is_safe_path(d["path"], rel):
        return None
    full_path = os.path.join(d["path"], rel)
    if not os.path.isfile(full_path):
        return None

    meta = {
        "artist": None,
        "title": None,
        "album": None,
        "duration": None,
        "cover": False,
        "path": path,
    }

    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(full_path, easy=True)
        if audio is not None:
            if audio.info is not None:
                try:
                    meta["duration"] = int(round(audio.info.length))
                except (TypeError, ValueError):  # pragma: no cover - defensive
                    pass
            tags = audio.tags
            if tags:
                meta["artist"] = _get_tag(tags, ["artist"])
                meta["title"] = _get_tag(tags, ["title"])
                meta["album"] = _get_tag(tags, ["album"])
    except Exception as e:  # pragma: no cover - defensive
        logger.debug("mutagen read failed for %s: %s", path, e)

    meta["cover"] = _has_embedded_cover(full_path) or os.path.isfile(
        os.path.splitext(full_path)[0] + ".png"
    )

    # Filename fallback only when no usable tags were found.
    if not (meta["artist"] or meta["title"] or meta["album"]):
        fb = parse_filename(rel)
        meta["artist"] = fb["artist"]
        meta["title"] = fb["title"]
        meta["album"] = fb["album"]

    return meta
