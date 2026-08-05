import json
import logging
import os

from files import is_valid_song_path

logger = logging.getLogger(__name__)

PLAYLISTS_FILE = "playlists.json"


def get_playlists():
    if os.path.exists(PLAYLISTS_FILE):
        try:
            with open(PLAYLISTS_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.error("Failed to read playlists file: %s", e)
            return []
    return []


def save_playlists(playlists):
    try:
        with open(PLAYLISTS_FILE, "w") as f:
            json.dump(playlists, f, indent=2)
        logger.debug("Saved %d playlists", len(playlists))
    except OSError as e:
        logger.error("Failed to write playlists file: %s", e)


def normalize_song(s):
    if isinstance(s, str):
        return {"type": "local", "path": s,
                "name": os.path.basename(s) if "/" in s else s}
    if isinstance(s, dict) and s.get("type") == "immich":
        return {"type": "immich", "assetId": s["assetId"],
                "name": s.get("originalName", "Video")}
    if isinstance(s, dict) and s.get("type") == "youtube":
        return {"type": "youtube", "videoId": s["videoId"],
                "name": s.get("originalName", "Video")}
    return s


def normalize_playlist(p):
    p["songs"] = [normalize_song(s) for s in p["songs"]]
    return p


def normalize_playlists(playlists):
    return [normalize_playlist(p) for p in playlists]
