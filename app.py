import json
import os
import time

import requests

from flask import Flask, jsonify, render_template, request, Response, send_from_directory

app = Flask(__name__, static_folder="static")

CONFIG_FILE = "config.json"
PLAYLISTS_FILE = "playlists.json"

AUDIO_EXTENSIONS = {".mp3", ".flac", ".wav", ".ogg", ".m4a", ".wma", ".opus"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mkv", ".avi", ".mov", ".flv"}
ALL_EXTENSIONS = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS
IGNORED_FOLDERS = {".stfolder", ".stversions", "@eaDir", "thumbnails", ".thumbnails", "covers", ".cache"}

_list_cache = {"data": None, "updated": 0, "ttl": 10}

def get_list_cache():
    return _list_cache

def set_list_cache(data):
    c = get_list_cache()
    c["data"] = data
    c["updated"] = time.time()


DEFAULT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "music")


def get_config():
    cfg = {"volume": 100, "shuffle": False, "repeat": "none"}
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE) as f:
            stored = json.load(f)
            cfg.update(stored)
    # Backward compat: migrate single music_dir to music_dirs
    if "music_dirs" not in cfg or not isinstance(cfg["music_dirs"], list):
        old = cfg.get("music_dir", "")
        if old and os.path.isdir(old):
            cfg["music_dirs"] = [{"key": "main", "path": os.path.abspath(old)}]
        else:
            cfg["music_dirs"] = [{"key": "main", "path": DEFAULT_DIR}]
    return cfg


def get_music_dirs():
    cfg = get_config()
    dirs = []
    for d in cfg.get("music_dirs", []):
        p = d.get("path", "")
        if p and os.path.isdir(p):
            dirs.append({"key": d.get("key", "main"), "path": os.path.abspath(p)})
    if not dirs:
        dirs = [{"key": "main", "path": DEFAULT_DIR}]
    return dirs


def resolve_path(path):
    """Return (dir_info, relative_path) for a given file path.
    If path starts with {key}/, look up that dir. Otherwise use first dir."""
    dirs = get_music_dirs()
    if "/" in path:
        maybe_key, rest = path.split("/", 1)
        for d in dirs:
            if d["key"] == maybe_key:
                return d, rest
    return dirs[0], path


def get_file_type(filename):
    _, ext = os.path.splitext(filename.lower())
    if ext in VIDEO_EXTENSIONS:
        return "video"
    return "audio"


def list_files():
    c = get_list_cache()
    if c["data"] is not None and time.time() - c["updated"] < c["ttl"]:
        return c["data"]

    files = []
    for d in get_music_dirs():
        base = d["path"]
        key = d["key"]
        if not os.path.isdir(base):
            continue
        for root, _, filenames in os.walk(base):
            for filename in filenames:
                if any(filename.lower().endswith(ext) for ext in ALL_EXTENSIONS):
                    rel_path = os.path.relpath(os.path.join(root, filename), base)
                    full_path = os.path.join(key, rel_path)
                    cover_name = os.path.splitext(filename)[0] + ".png"
                    cover_path = os.path.join(root, cover_name)
                    files.append({
                        "name": filename,
                        "path": full_path,
                        "cover": os.path.join(key, cover_name) if os.path.exists(cover_path) else None,
                        "type": get_file_type(filename),
                    })

    files.sort(key=lambda x: x["name"].lower())
    set_list_cache(files)
    return files


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/media/<path:filename>")
def serve_media(filename):
    d, rel = resolve_path(filename)
    if not is_safe_path(d["path"], rel):
        return jsonify({"error": "Acceso denegado: ruta inválida"}), 403
    _, ext = os.path.splitext(rel.lower())
    if ext not in ALL_EXTENSIONS:
        return jsonify({"error": "Tipo de archivo no permitido"}), 403
    return send_from_directory(d["path"], rel)


@app.route("/api/folders", methods=["GET"])
def get_folders():
    folders = []
    for d in get_music_dirs():
        base = d["path"]
        key = d["key"]
        if not os.path.isdir(base):
            continue
        for entry in sorted(os.listdir(base), key=str.lower):
            full_path = os.path.join(base, entry)
            if os.path.isdir(full_path) and not entry.startswith(".") and entry not in IGNORED_FOLDERS:
                rel = os.path.join(key, entry)
                folders.append({"name": entry, "path": rel})
    return jsonify(folders)


@app.route("/api/files", methods=["GET"])
def get_files():
    return jsonify(list_files())


@app.route("/api/cover/<path:filename>")
def serve_cover(filename):
    d, rel = resolve_path(filename)
    if not is_safe_path(d["path"], rel):
        return jsonify({"error": "Acceso denegado: ruta inválida"}), 403
    return send_from_directory(d["path"], rel)


@app.route("/api/config", methods=["GET"])
def get_config_api():
    cfg = get_config()
    cfg["music_dirs"] = get_music_dirs()
    cfg["default_music_dir"] = DEFAULT_DIR
    return jsonify(cfg)


@app.route("/api/config", methods=["PUT"])
def set_config_api():
    data = request.json
    config = get_config()
    changed_dir = False

    if "volume" in data:
        config["volume"] = min(max(int(data["volume"]), 0), 100)
    if "shuffle" in data:
        config["shuffle"] = bool(data["shuffle"])
    if "repeat" in data:
        config["repeat"] = data.get("repeat", "none")

    if "music_dirs" in data:
        new_dirs = []
        for entry in data["music_dirs"]:
            p = os.path.expanduser(entry.get("path", ""))
            if os.path.isdir(p):
                new_dirs.append({"key": entry.get("key", "main"), "path": os.path.abspath(p)})
        if new_dirs:
            config["music_dirs"] = new_dirs
            changed_dir = True
        else:
            return jsonify({"error": "Ninguna carpeta es válida"}), 400

    # Backward compat: single music_dir
    if "music_dir" in data and "music_dirs" not in data:
        new_dir = os.path.expanduser(data["music_dir"])
        if os.path.isdir(new_dir):
            config["music_dirs"] = [{"key": "main", "path": os.path.abspath(new_dir)}]
            changed_dir = True
        else:
            return jsonify({"error": "La carpeta no existe"}), 400

    update_config(config)
    if changed_dir:
        set_list_cache(None)
    cfg = get_config()
    cfg["music_dirs"] = get_music_dirs()
    cfg["default_music_dir"] = DEFAULT_DIR
    return jsonify({"status": "ok", "config": cfg})


def is_safe_path(directory, path):
    if not isinstance(path, str) or ".." in path:
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


def get_playlists():
    if os.path.exists(PLAYLISTS_FILE):
        with open(PLAYLISTS_FILE) as f:
            return json.load(f)
    return []


def save_playlists(playlists):
    with open(PLAYLISTS_FILE, "w") as f:
        json.dump(playlists, f, indent=2)


def update_config(config):
    existing = get_config()
    existing.update(config)
    with open(CONFIG_FILE, "w") as f:
        json.dump(existing, f)


# ── Immich ──────────────────────────────────────────────────────

def get_immich_config():
    cfg = get_config()
    return {
        "url": cfg.get("immich_url", "").rstrip("/"),
        "apiKey": cfg.get("immich_api_key", ""),
    }


def immich_api(path):
    cfg = get_immich_config()
    if not cfg["url"] or not cfg["apiKey"]:
        return None, "Immich no configurado"
    url = cfg["url"] + "/api" + path
    try:
        resp = requests.get(url, headers={
            "x-api-key": cfg["apiKey"],
            "Accept": "application/json",
        }, timeout=15)
        if resp.status_code == 401:
            return None, "API key inválida"
        if resp.status_code == 404:
            return None, "Recurso no encontrado"
        resp.raise_for_status()
        return resp.json(), None
    except requests.ConnectionError:
        return None, "No se pudo conectar con Immich"
    except Exception as e:
        return None, str(e)


def proxy_immich(asset_id, endpoint):
    cfg = get_immich_config()
    if not cfg["url"] or not cfg["apiKey"]:
        return jsonify({"error": "Immich no configurado"}), 400
    url = cfg["url"] + "/api/assets/" + asset_id + "/" + endpoint
    headers = {"x-api-key": cfg["apiKey"]}
    range_h = request.headers.get("Range")
    if range_h:
        headers["Range"] = range_h
    try:
        resp = requests.get(url, headers=headers, stream=True, timeout=30)
        if resp.status_code in (401, 403):
            return jsonify({"error": "Sin permisos para acceder al archivo en Immich"}), resp.status_code
        if resp.status_code == 404:
            return jsonify({"error": "Archivo no encontrado en Immich"}), 404
        out_headers = {}
        for k, v in resp.headers.items():
            lk = k.lower()
            if lk in ("content-type", "content-length", "content-range",
                      "accept-ranges", "content-disposition", "cache-control",
                      "etag", "last-modified"):
                out_headers[k] = v
        def gen():
            for chunk in resp.iter_content(65536):
                if chunk:
                    yield chunk
        return Response(gen(), status=resp.status_code,
                        headers=out_headers, direct_passthrough=True)
    except requests.Timeout:
        return jsonify({"error": "Timeout al conectar con Immich"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Invidious ───────────────────────────────────────────────────

INVIDIOUS_URLS = ["http://invidious:3000", "http://localhost:3000"]

def get_invidious_url():
    for url in INVIDIOUS_URLS:
        try:
            r = requests.get(url + "/api/v1/stats", timeout=3)
            if r.ok:
                return url
        except Exception:
            continue
    return None


@app.route("/api/invidious/search")
def invidious_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"error": "Query requerida"}), 400
    base = get_invidious_url()
    if not base:
        return jsonify({"error": "Invidious no disponible"}), 503
    try:
        resp = requests.get(base + "/api/v1/search", params={"q": q}, timeout=15)
        return jsonify(resp.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/invidious/<path:subpath>")
def invidious_proxy(subpath):
    base = get_invidious_url()
    if not base:
        return jsonify({"error": "Invidious no disponible"}), 503
    try:
        resp = requests.get(base + "/" + subpath, stream=True, timeout=30)
        out = {}
        for k, v in resp.headers.items():
            lk = k.lower()
            if lk in ("content-type", "content-length", "cache-control"):
                out[k] = v
        return Response(resp.iter_content(65536), status=resp.status_code,
                        headers=out, direct_passthrough=True)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/immich/config", methods=["GET"])
def get_immich_config_api():
    cfg = get_immich_config()
    return jsonify({"url": cfg["url"], "connected": bool(cfg["url"] and cfg["apiKey"])})


@app.route("/api/immich/config", methods=["PUT"])
def set_immich_config_api():
    data = request.json
    url = (data.get("url") or "").rstrip("/")
    api_key = data.get("apiKey") or ""
    if not url or not api_key:
        return jsonify({"error": "URL y API key requeridas"}), 400
    try:
        r = requests.get(url + "/api/albums", headers={"x-api-key": api_key}, timeout=10)
        if r.status_code == 401:
            return jsonify({"error": "API key inválida"}), 400
        r.raise_for_status()
    except requests.ConnectionError:
        return jsonify({"error": "No se pudo conectar con Immich"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    cfg = get_config()
    cfg["immich_url"] = url
    cfg["immich_api_key"] = api_key
    update_config(cfg)
    return jsonify({"status": "ok", "url": url, "connected": True})


@app.route("/api/immich/albums")
def immich_albums():
    data, err = immich_api("/albums")
    if err:
        return jsonify({"error": err}), 400
    return jsonify(data)


@app.route("/api/immich/albums/<album_id>")
def immich_album(album_id):
    data, err = immich_api("/albums/" + album_id)
    if err:
        return jsonify({"error": err}), 400
    return jsonify(data)


@app.route("/api/immich/media/<asset_id>")
def immich_media(asset_id):
    return proxy_immich(asset_id, "original")


@app.route("/api/immich/thumbnail/<asset_id>")
def immich_thumbnail(asset_id):
    return proxy_immich(asset_id, "thumbnail")


# ── Playlist helpers ────────────────────────────────────────────

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


# Playlist endpoints
@app.route("/api/playlists", methods=["GET"])
def list_playlists():
    return jsonify([normalize_playlist(p) for p in get_playlists()])


@app.route("/api/playlists", methods=["POST"])
def create_playlist():
    data = request.json
    name = data.get("name", "").strip()
    raw_songs = data.get("songs", [])
    if not name:
        return jsonify({"error": "Nombre requerido"}), 400
    songs = []
    for s in raw_songs:
        if isinstance(s, str):
            if is_valid_song_path(s):
                songs.append(s)
        elif isinstance(s, dict):
            if s.get("type") == "immich" and s.get("assetId"):
                songs.append({"type": "immich", "assetId": s["assetId"],
                              "originalName": s.get("originalName", "Video")})
            elif s.get("type") == "youtube" and s.get("videoId"):
                songs.append({"type": "youtube", "videoId": s["videoId"],
                              "originalName": s.get("originalName", "Video")})
    playlists = get_playlists()
    nid = max([p["id"] for p in playlists], default=0) + 1
    playlist = {"id": nid, "name": name, "songs": songs}
    playlists.append(playlist)
    save_playlists(playlists)
    return jsonify(normalize_playlist(playlist))


@app.route("/api/playlists/<int:pid>", methods=["PUT"])
def rename_playlist(pid):
    data = request.json
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Nombre requerido"}), 400
    playlists = get_playlists()
    for p in playlists:
        if p["id"] == pid:
            p["name"] = name
            save_playlists(playlists)
            return jsonify(normalize_playlist(p))
    return jsonify({"error": "Playlist no encontrada"}), 404


@app.route("/api/playlists/<int:pid>", methods=["DELETE"])
def delete_playlist(pid):
    playlists = get_playlists()
    playlists = [p for p in playlists if p["id"] != pid]
    save_playlists(playlists)
    return jsonify({"status": "deleted"})


@app.route("/api/playlists/<int:pid>/songs", methods=["POST"])
def add_to_playlist(pid):
    data = request.json
    # Immich entry
    if data.get("type") == "immich":
        asset_id = data.get("assetId")
        if not asset_id:
            return jsonify({"error": "assetId requerido"}), 400
        entry = {"type": "immich", "assetId": asset_id,
                 "originalName": data.get("originalName", "Video")}
        playlists = get_playlists()
        for p in playlists:
            if p["id"] == pid:
                p["songs"].append(entry)
                save_playlists(playlists)
                return jsonify(normalize_playlist(p))
        return jsonify({"error": "Playlist no encontrada"}), 404
    # YouTube entry
    if data.get("type") == "youtube":
        video_id = data.get("videoId")
        if not video_id:
            return jsonify({"error": "videoId requerido"}), 400
        entry = {"type": "youtube", "videoId": video_id,
                 "originalName": data.get("originalName", "Video")}
        playlists = get_playlists()
        for p in playlists:
            if p["id"] == pid:
                p["songs"].append(entry)
                save_playlists(playlists)
                return jsonify(normalize_playlist(p))
        return jsonify({"error": "Playlist no encontrada"}), 404
    # Local entry
    song_path = data.get("path")
    if not song_path:
        return jsonify({"error": "Path requerido"}), 400
    if not is_valid_song_path(song_path):
        return jsonify({"error": "Acceso denegado: ruta inválida"}), 403
    playlists = get_playlists()
    for p in playlists:
        if p["id"] == pid:
            if song_path not in p["songs"]:
                p["songs"].append(song_path)
                save_playlists(playlists)
            return jsonify(normalize_playlist(p))
    return jsonify({"error": "Playlist no encontrada"}), 404


@app.route("/api/playlists/<int:pid>/songs/<path:song_path>", methods=["DELETE"])
def remove_from_playlist(pid, song_path):
    if not is_valid_song_path(song_path):
        return jsonify({"error": "Acceso denegado: ruta inválida"}), 403
    playlists = get_playlists()
    for p in playlists:
        if p["id"] == pid:
            p["songs"] = [s for s in p["songs"] if s != song_path]
            save_playlists(playlists)
            return jsonify(normalize_playlist(p))
    return jsonify({"error": "Playlist no encontrada"}), 404


@app.route("/api/playlists/<int:pid>/songs", methods=["DELETE"])
def remove_song_from_playlist(pid):
    data = request.json
    if not data:
        return jsonify({"error": "Datos requeridos"}), 400
    playlists = get_playlists()
    for p in playlists:
        if p["id"] == pid:
            if data.get("type") == "immich":
                aid = data.get("assetId")
                p["songs"] = [s for s in p["songs"]
                              if not (isinstance(s, dict)
                                      and s.get("type") == "immich"
                                      and s.get("assetId") == aid)]
            elif data.get("type") == "youtube":
                vid = data.get("videoId")
                p["songs"] = [s for s in p["songs"]
                              if not (isinstance(s, dict)
                                      and s.get("type") == "youtube"
                                      and s.get("videoId") == vid)]
            else:
                path = data.get("path", "")
                if not is_valid_song_path(path):
                    return jsonify({"error": "Acceso denegado"}), 403
                p["songs"] = [s for s in p["songs"] if s != path]
            save_playlists(playlists)
            return jsonify(normalize_playlist(p))
    return jsonify({"error": "Playlist no encontrada"}), 404


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
