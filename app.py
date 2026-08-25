import io
import logging
import os
import secrets
from logging.handlers import RotatingFileHandler

# ── Restricted System Paths ────────────────────────────────────
# Block access to these OS-critical areas to prevent an exposed 
# server from letting a user list system files.
_RESTRICTED_PATH_PREFIXES = (
    "/etc", "/proc", "/sys", "/dev", "/boot", "/bin", "/sbin",
    "/lib", "/usr", "/var", "/root", "/run", "/snap",
)

def _is_restricted_path(dir_path: str) -> bool:
    """Return True if ``dir_path`` resolves to a restricted system area."""
    real = os.path.realpath(dir_path)
    return any(real.startswith(prefix) for prefix in _RESTRICTED_PATH_PREFIXES)

import requests
from flask import Flask, jsonify, render_template, request, Response, send_from_directory, session

from auth import (
    create_user,
    verify_user,
    login_required,
    is_first_run,
    delete_user,
    change_password,
)

from config import (
    DEFAULT_DIR,
    get_config,
    get_music_dirs,
    migrate_immich_key,
    update_config,
)
from files import (
    AUDIO_EXTENSIONS,
    IGNORED_FOLDERS,
    VIDEO_EXTENSIONS,
    is_safe_path,
    is_valid_song_path,
    list_files,
    resolve_path,
    serve_file_with_range,
    start_watcher,
)
from cache import PathCache
from metadata import get_metadata
from lyrics import get_lyrics, save_lyrics_file, get_sidecar_path
from immich import (
    handle_get_config as immich_handle_get_config,
    handle_set_config as immich_handle_set_config,
    handle_upload as immich_handle_upload,
    handle_upload_compressed as immich_handle_upload_compressed,
    immich_api,
    immich_api_request,
    immich_album_video_assets,
    proxy_immich,
)
from upload_queue import upload_queue
from invidious import (
    get_feed,
    get_invidious_sid,
    get_invidious_url,
    invidious_auth_get,
    invidious_auth_headers,
    invidious_auth_post,
    save_invidious_sid,
)
from playlists import (
    get_playlists,
    normalize_playlist,
    normalize_playlists,
    save_playlists,
)

# ── Logging setup ───────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

handler = RotatingFileHandler("server.log", maxBytes=10 * 1024 * 1024, backupCount=5)
handler.setFormatter(logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s"))
logging.getLogger().addHandler(handler)

# ── Flask app ───────────────────────────────────────────────

app = Flask(__name__, static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024 * 1024  # 15GB

# ── Secret key (persistent) ────────────────────────────────
SECRET_KEY_FILE = ".secret.key"

def _get_or_create_secret_key():
    env_key = os.environ.get("FLASK_SECRET_KEY")
    if env_key:
        return env_key
    if os.path.exists(SECRET_KEY_FILE):
        with open(SECRET_KEY_FILE, "r") as f:
            key = f.read().strip()
        if key:
            return key
    # Generate new key and persist it
    key = secrets.token_hex(32)
    with open(SECRET_KEY_FILE, "w") as f:
        f.write(key)
    os.chmod(SECRET_KEY_FILE, 0o600)
    logger.info("Generated new secret key")
    return key

app.secret_key = _get_or_create_secret_key()
upload_queue.start()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "0") == "1",
    PERMANENT_SESSION_LIFETIME=86400 * 30,
)


# ── Rate limiting (SQLite-backed) ──────────────────────────

from ratelimit import limit

logger.info("Rate limiting enabled (SQLite storage)")


# ── Security headers ───────────────────────────────────────

@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # Expose CSRF token so the frontend can read it
    csrf_token = session.get("_csrf_token")
    if csrf_token:
        response.headers["X-CSRF-Token"] = csrf_token
    return response


# ── CSRF protection ────────────────────────────────────────

def _get_or_create_csrf_token():
    if "_csrf_token" not in session:
        session["_csrf_token"] = secrets.token_hex(32)
    return session["_csrf_token"]


# Endpoints that are safe (read-only) or handle their own auth
_CSRF_EXEMPT_ENDPOINTS = {
    "auth_status",       # GET-only, used for login flow
    "auth_login",        # protected by rate limiting + credentials
    "auth_register",     # protected by is_first_run() gate
    "health",            # GET-only
    "favicon",           # GET-only
    "index",             # GET-only
    "static",            # GET-only
}


@app.before_request
def csrf_protect():
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    endpoint = request.endpoint or ""
    if endpoint in _CSRF_EXEMPT_ENDPOINTS:
        return
    token = session.get("_csrf_token")
    header_token = request.headers.get("X-CSRF-Token", "")
    if not token or header_token != token:
        return jsonify({"error": "CSRF token inválido"}), 403


# ── Auth routes ─────────────────────────────────────────────

@app.route("/api/auth/status")
def auth_status():
    if "user" in session:
        _get_or_create_csrf_token()
        return jsonify({"authenticated": True, "user": session["user"]})
    return jsonify({"authenticated": False, "first_run": is_first_run()})


@app.route("/api/auth/register", methods=["POST"])
@limit(5, 60)
def auth_register():
    if not is_first_run():
        return jsonify({"error": "Registro no disponible"}), 403
    data = request.json
    username = (data or {}).get("username", "").strip()
    password = (data or {}).get("password", "")
    if not username or not password:
        return jsonify({"error": "Usuario y contrasena requeridos"}), 400
    if len(password) < 6:
        return jsonify({"error": "La contrasena debe tener al menos 6 caracteres"}), 400
    ok, err = create_user(username, password)
    if not ok:
        return jsonify({"error": err}), 400
    session["user"] = username
    session.permanent = True
    _get_or_create_csrf_token()
    return jsonify({"status": "ok", "user": username})


@app.route("/api/auth/login", methods=["POST"])
@limit(10, 60)
def auth_login():
    data = request.json
    username = (data or {}).get("username", "").strip()
    password = (data or {}).get("password", "")
    if not username or not password:
        return jsonify({"error": "Usuario y contrasena requeridos"}), 400
    if verify_user(username, password):
        session["user"] = username
        session.permanent = True
        _get_or_create_csrf_token()
        logger.info("User logged in: %s", username)
        return jsonify({"status": "ok", "user": username})
    logger.warning("Failed login attempt for: %s", username)
    return jsonify({"error": "Credenciales invalidas"}), 401


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    user = session.pop("user", None)
    if user:
        logger.info("User logged out: %s", user)
    return jsonify({"status": "ok"})


@app.route("/api/auth/change-password", methods=["POST"])
@login_required
@limit(5, 60)
def auth_change_password():
    data = request.json
    old_pw = (data or {}).get("old_password", "")
    new_pw = (data or {}).get("new_password", "")
    if not old_pw or not new_pw:
        return jsonify({"error": "Contrasena actual y nueva requeridas"}), 400
    if len(new_pw) < 6:
        return jsonify({"error": "La nueva contrasena debe tener al menos 6 caracteres"}), 400
    ok, err = change_password(session["user"], old_pw, new_pw)
    if not ok:
        return jsonify({"error": err}), 400
    return jsonify({"status": "ok"})


# ── File watcher ────────────────────────────────────────────

start_watcher()

# ── Migrations ──────────────────────────────────────────────

migrate_immich_key()

logger.info("Starting music server")


# ══════════════════════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/favicon.ico")
def favicon():
    return Response(status=204)


# ── Media serving ───────────────────────────────────────────

@app.route("/media/<path:filename>")
@login_required
def serve_media(filename):
    d, rel = resolve_path(filename)
    if not is_safe_path(d["path"], rel):
        logger.warning("Blocked path traversal attempt: %s", filename)
        return jsonify({"error": "Acceso denegado: ruta inválida"}), 403
    _, ext = os.path.splitext(rel.lower())
    if ext not in (AUDIO_EXTENSIONS | VIDEO_EXTENSIONS):
        return jsonify({"error": "Tipo de archivo no permitido"}), 403
    full_path = os.path.join(d["path"], rel)
    if not os.path.isfile(full_path):
        return jsonify({"error": "Archivo no encontrado"}), 404
    logger.debug("Serving media: %s/%s", d["key"], rel)
    return serve_file_with_range(full_path, rel)


# ── Cover art ────────────────────────────────────────────────

@app.route("/api/cover/<path:filename>")
@login_required
def serve_cover(filename):
    d, rel = resolve_path(filename)
    if not is_safe_path(d["path"], rel):
        return jsonify({"error": "Acceso denegado: ruta inválida"}), 403
    return send_from_directory(d["path"], rel)


# ── Track metadata ─────────────────────────────────────────

metadata_cache = PathCache(ttl=24 * 3600, max_entries=500, name="metadata")


@app.route("/api/metadata", methods=["GET"])
@login_required
@limit(30, 60)
def get_metadata_api():
    path = (request.args.get("path") or "").strip()
    if not path:
        return jsonify({"error": "Path requerido"}), 400

    cfg = get_config()
    if not cfg.get("metadataEnabled", True):
        return jsonify({"error": "Metadata deshabilitada"}), 404

    d, rel = resolve_path(path)
    if not is_safe_path(d["path"], rel):
        logger.warning("Blocked path traversal attempt in metadata: %s", path)
        return jsonify({"error": "Acceso denegado: ruta inválida"}), 403

    full_path = os.path.join(d["path"], rel)
    if not os.path.isfile(full_path):
        return jsonify({"error": "Arch. no encontrado"}), 404

    cached = metadata_cache.get(path)
    if cached is not None:
        return jsonify(cached)

    meta = get_metadata(path)
    if meta is None:
        return jsonify({"error": "Archivo no encontrado"}), 404

    metadata_cache.set(path, meta)
    return jsonify(meta)


# ── Lyrics (LRCLIB proxy) ──────────────────────────────

lyrics_cache = PathCache(ttl=7 * 24 * 3600, max_entries=500, name="lyrics")


@app.route("/api/lyrics", methods=["GET"])
@login_required
@limit(30, 60)
def get_lyrics_api():
    path = (request.args.get("path") or "").strip()
    if not path:
        return jsonify({"error": "Path requerido"}), 400

    cfg = get_config()
    if not cfg.get("lyricsEnabled", True):
        return jsonify({"error": "Lyrics deshabilitada"}), 404

    d, rel = resolve_path(path)
    if not is_safe_path(d["path"], rel):
        logger.warning("Blocked path traversal attempt in lyrics: %s", path)
        return jsonify({"error": "Acceso denegado: ruta inválida"}), 403

    full_path = os.path.join(d["path"], rel)
    if not os.path.isfile(full_path):
        return jsonify({"error": "Archivo no encontrado"}), 404

    cached = lyrics_cache.get(path)
    if cached is not None:
        return jsonify(cached)

    # Reuse cached metadata when available to avoid re-reading tags.
    meta = metadata_cache.get(path)
    if meta is None:
        meta = get_metadata(path)
    if meta is None:
        return jsonify({"error": "Archivo no encontrado"}), 404

    result = get_lyrics(path, meta, audio_full_path=full_path)
    lyrics_cache.set(path, result)
    return jsonify(result)


@app.route("/api/lyrics/save", methods=["POST"])
@login_required
@limit(10, 60)
def save_lyrics_api():
    data = request.get_json(silent=True) or {}
    path = (data.get("path") or "").strip()
    lyrics_text = data.get("lyrics") or ""
    if not path:
        return jsonify({"error": "Path requerido"}), 400

    d, rel = resolve_path(path)
    if not is_safe_path(d["path"], rel):
        logger.warning("Blocked path traversal attempt in lyrics save: %s", path)
        return jsonify({"error": "Acceso denegado: ruta inválida"}), 403

    full_path = os.path.join(d["path"], rel)
    if not os.path.isfile(full_path):
        return jsonify({"error": "Archivo no encontrado"}), 404

    try:
        lrc_path = save_lyrics_file(full_path, lyrics_text)
        logger.info("Saved lyrics to %s", lrc_path)
    except OSError as e:
        logger.error("Failed to save lyrics for %s: %s", path, e)
        return jsonify({"error": "Error al guardar letra"}), 500
    except Exception as e:
        logger.error("Unexpected error saving lyrics for %s: %s", path, e, exc_info=True)
        return jsonify({"error": "Error inesperado"}), 500

    lyrics_cache.invalidate(path)

    result = get_lyrics(path, None, audio_full_path=full_path)
    lyrics_cache.set(path, result)
    return jsonify(result)


# ── File listing ────────────────────────────────────────────

@app.route("/api/folders", methods=["GET"])
@login_required
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
@login_required
def get_files():
    return jsonify(list_files())


# ── Config ──────────────────────────────────────────────────

@app.route("/api/config", methods=["GET"])
@login_required
def get_config_api():
    cfg = get_config()
    cfg["music_dirs"] = get_music_dirs()
    cfg["default_music_dir"] = DEFAULT_DIR
    return jsonify(cfg)


@app.route("/api/config", methods=["PUT"])
@login_required
@limit(10, 60)
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

    if "metadataEnabled" in data:
        config["metadataEnabled"] = bool(data["metadataEnabled"])

    if "lyricsEnabled" in data:
        config["lyricsEnabled"] = bool(data["lyricsEnabled"])

    if "music_dirs" in data:
        new_dirs = []
        for entry in data["music_dirs"]:
            p = os.path.expanduser(entry.get("path", ""))
            real_p = os.path.realpath(p)
            # SECURITY: Block system directories from being added as music dirs.
            if _is_restricted_path(p):
                return jsonify({"error": f"No permitido: {real_p} es un directorio del sistema"}), 403
            if not os.path.isdir(real_p):
                continue
            new_dirs.append({"key": entry.get("key", "main"), "path": real_p})
        if new_dirs:
            config["music_dirs"] = new_dirs
            changed_dir = True
        else:
            return jsonify({"error": "Ninguna carpeta es válida"}), 400

    if "music_dir" in data and "music_dirs" not in data:
        new_dir = os.path.expanduser(data["music_dir"])
        real_dir = os.path.realpath(new_dir)
        if _is_restricted_path(real_dir):
            return jsonify({"error": f"No permitido: {real_dir} es un directorio del sistema"}), 403
        if os.path.isdir(real_dir):
            config["music_dirs"] = [{"key": "main", "path": real_dir}]
            changed_dir = True
        else:
            return jsonify({"error": "La carpeta no existe"}), 400

    update_config(config)
    if changed_dir:
        from files import get_list_cache
        get_list_cache().invalidate(reason="music dirs changed")

    cfg = get_config()
    cfg["music_dirs"] = get_music_dirs()
    cfg["default_music_dir"] = DEFAULT_DIR
    return jsonify({"status": "ok", "config": cfg})


# ══════════════════════════════════════════════════════════════
# IMMICH ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/api/immich/config", methods=["GET"])
@login_required
def get_immich_config_api():
    return jsonify(immich_handle_get_config())


@app.route("/api/immich/config", methods=["PUT"])
@login_required
@limit(5, 60)
def set_immich_config_api():
    result = immich_handle_set_config(request.json)
    if isinstance(result, tuple) and len(result) == 2:
        return jsonify(result[0]), result[1]
    return jsonify(result)


@app.route("/api/immich/albums")
@login_required
def immich_albums():
    data, err = immich_api("/albums")
    if err:
        return jsonify({"error": err}), 400
    return jsonify(data)


@app.route("/api/immich/albums", methods=["POST"])
@login_required
@limit(10, 60)
def immich_create_album():
    data = request.json
    name = (data or {}).get("albumName", "").strip()
    description = (data or {}).get("description", "").strip()
    if not name:
        return jsonify({"error": "Nombre del álbum requerido"}), 400
    body = {"albumName": name}
    if description:
        body["description"] = description
    result, err = immich_api_request("POST", "/albums", data=body)
    if err:
        return jsonify({"error": err}), 400
    return jsonify(result)


@app.route("/api/immich/albums/<album_id>")
@login_required
def immich_album(album_id):
    data, err = immich_api("/albums/" + album_id)
    if err:
        return jsonify({"error": err}), 400
    assets, err = immich_album_video_assets(album_id)
    if err:
        return jsonify({"error": err}), 400
    if isinstance(data, dict):
        data["assets"] = assets
    return jsonify(data)


@app.route("/api/immich/albums/<album_id>", methods=["DELETE"])
@login_required
@limit(10, 60)
def immich_delete_album(album_id):
    result, err = immich_api_request("DELETE", f"/albums/{album_id}")
    if err:
        return jsonify({"error": err}), 400
    return jsonify({"status": "deleted"})


@app.route("/api/immich/albums/<album_id>/rename", methods=["PUT"])
@login_required
@limit(10, 60)
def immich_rename_album(album_id):
    data = request.json
    name = (data or {}).get("name", "").strip()
    if not name:
        return jsonify({"error": "Nombre requerido"}), 400
    result, err = immich_api_request("PUT", f"/albums/{album_id}", data={"albumName": name})
    if err:
        return jsonify({"error": err}), 400
    return jsonify(result)


@app.route("/api/immich/albums/<album_id>/assets", methods=["PUT"])
@login_required
@limit(10, 60)
def immich_add_assets(album_id):
    data = request.json
    ids = (data or {}).get("ids", [])
    if not ids:
        return jsonify({"error": "Se requiere al menos un assetId"}), 400
    result, err = immich_api_request("PUT", f"/albums/{album_id}/assets", data={"ids": ids})
    if err:
        return jsonify({"error": err}), 400
    return jsonify(result)


@app.route("/api/immich/media/<asset_id>")
@login_required
def immich_media(asset_id):
    return proxy_immich(asset_id, "original")


@app.route("/api/immich/thumbnail/<asset_id>")
@login_required
def immich_thumbnail(asset_id):
    return proxy_immich(asset_id, "thumbnail")


@app.route("/api/immich/assets/<asset_id>/rename", methods=["PUT"])
@login_required
@limit(10, 60)
def immich_rename_asset(asset_id):
    data = request.json
    name = (data or {}).get("name", "").strip()
    if not name:
        return jsonify({"error": "Nombre requerido"}), 400
    result, err = immich_api_request("PUT", f"/assets/{asset_id}", data={"originalFileName": name})
    if err:
        return jsonify({"error": err}), 400
    return jsonify(result)


@app.route("/api/immich/upload", methods=["POST"])
@login_required
@limit(5, 60)
def immich_upload():
    result = immich_handle_upload()
    if isinstance(result, tuple) and len(result) >= 2:
        return jsonify(result[0]), result[1]
    return jsonify(result)


@app.route("/api/immich/upload-compressed", methods=["POST"])
@login_required
@limit(2, 60)  # stricter limit due to CPU cost
def immich_upload_compressed():
    result = immich_handle_upload_compressed()
    if isinstance(result, tuple) and len(result) >= 2:
        return jsonify(result[0]), result[1]
    return jsonify(result)


@app.route("/api/immich/queue", methods=["POST"])
@login_required
@limit(5, 60)
def immich_queue_add():
    if "file" not in request.files:
        return jsonify({"error": "No se envió ningún archivo"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Nombre de archivo vacío"}), 400

    album_id = request.form.get("albumId")
    compress = request.form.get("compress", "false").lower() == "true"
    try:
        crf = int(request.form.get("crf", 28))
    except (ValueError, TypeError):
        return jsonify({"error": "CRF must be an integer"}), 400

    data_stream = io.BytesIO(file.read())
    job = upload_queue.add_job(
        filename=file.filename,
        album_id=album_id,
        crf=crf,
        compress=compress,
        data_stream=data_stream,
    )

    return jsonify({
        "status": "queued",
        "jobId": job.id,
        "filename": job.filename,
    }), 202


@app.route("/api/immich/queue", methods=["GET"])
@login_required
def immich_queue_list():
    jobs = upload_queue.get_jobs()
    return jsonify([{
        "id": j.id,
        "filename": j.filename,
        "status": j.status.value,
        "progress": j.progress,
        "originalSize": j.original_size,
        "compressedSize": j.compressed_size,
        "assetId": j.asset_id,
        "error": j.error,
        "createdAt": j.created_at,
    } for j in jobs])


@app.route("/api/immich/queue/<job_id>", methods=["GET"])
@login_required
def immich_queue_get(job_id):
    job = upload_queue.get_job(job_id)
    if job is None:
        return jsonify({"error": "Job no encontrado"}), 404
    return jsonify({
        "id": job.id,
        "filename": job.filename,
        "status": job.status.value,
        "progress": job.progress,
        "originalSize": job.original_size,
        "compressedSize": job.compressed_size,
        "assetId": job.asset_id,
        "error": job.error,
        "createdAt": job.created_at,
    })


@app.route("/api/immich/queue/<job_id>", methods=["DELETE"])
@login_required
@limit(10, 60)
def immich_queue_cancel(job_id):
    job = upload_queue.cancel_job(job_id)
    if job is None:
        return jsonify({"error": "Job no encontrado"}), 404
    return jsonify({"status": "cancelled", "jobId": job.id})


# ══════════════════════════════════════════════════════════════
# INVIDIOUS ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/api/invidious/search")
@login_required
def invidious_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"error": "Query requerida"}), 400
    sort = request.args.get("sort", "relevance")
    date = request.args.get("date", "")
    base = get_invidious_url()
    if not base:
        return jsonify({"error": "Invidious no disponible"}), 503
    try:
        params = {"q": q, "sort": sort, "type": "video"}
        if date:
            params["date"] = date
        resp = requests.get(base + "/api/v1/search", params=params, timeout=15)
        return jsonify(resp.json())
    except Exception as e:
        logger.error("Invidious search error: %s", e, exc_info=True)
        return jsonify({"error": "Error al buscar en Invidious"}), 500


@app.route("/api/invidious/trending")
@login_required
def invidious_trending():
    base = get_invidious_url()
    if not base:
        return jsonify({"error": "Invidious no disponible"}), 503
    try:
        resp = requests.get(base + "/api/v1/trending", timeout=15)
        return jsonify(resp.json())
    except Exception as e:
        logger.error("Invidious trending error: %s", e, exc_info=True)
        return jsonify({"error": "Error al cargar tendencias"}), 500


@app.route("/api/invidious/video/<videoId>")
@login_required
def invidious_video(videoId):
    base = get_invidious_url()
    if not base:
        return jsonify({"error": "Invidious no disponible"}), 503
    try:
        resp = requests.get(base + f"/api/v1/videos/{videoId}", timeout=15)
        if not resp.ok:
            return jsonify({"error": "Error al obtener video"}), resp.status_code
        return jsonify(resp.json())
    except Exception as e:
        logger.error("Invidious video error: %s", e, exc_info=True)
        return jsonify({"error": "Error al obtener video"}), 500


@app.route("/api/invidious/login", methods=["POST"])
@login_required
@limit(5, 60)
def invidious_login():
    data = request.json
    username = (data or {}).get("username", "")
    password = (data or {}).get("password", "")
    if not username or not password:
        return jsonify({"error": "Usuario y contraseña requeridos"}), 400
    base = get_invidious_url()
    if not base:
        return jsonify({"error": "Invidious no disponible"}), 503
    try:
        resp = requests.post(base + "/login",
                             data={"email": username, "password": password,
                                   "action": "login", "referer": ""},
                             timeout=15, allow_redirects=False)
        sid = resp.cookies.get("SID", "")
        if not sid:
            return jsonify({"error": "Credenciales inválidas"}), 401
        save_invidious_sid(sid)
        cfg = get_config()
        cfg["invidious_user"] = username
        update_config(cfg)
        return jsonify({"status": "ok", "username": username})
    except requests.ConnectionError:
        return jsonify({"error": "No se pudo conectar con Invidious"}), 503
    except Exception as e:
        logger.error("Invidious login error: %s", e, exc_info=True)
        return jsonify({"error": "Error al conectar con Invidious"}), 500


@app.route("/api/invidious/logout", methods=["POST"])
@login_required
def invidious_logout():
    save_invidious_sid("")
    cfg = get_config()
    cfg["invidious_user"] = ""
    update_config(cfg)
    return jsonify({"status": "ok"})


@app.route("/api/invidious/status")
def invidious_status():
    base = get_invidious_url()
    sid = get_invidious_sid()
    cfg = get_config()
    username = cfg.get("invidious_user", "") if sid else ""
    return jsonify({
        "connected": base is not None,
        "logged_in": bool(sid),
        "username": username,
    })


@app.route("/api/invidious/subscriptions", methods=["GET"])
@login_required
def invidious_subscriptions():
    data, err = invidious_auth_get("/api/v1/auth/subscriptions")
    if err:
        return jsonify({"error": err}), 401
    return jsonify(data)


@app.route("/api/invidious/feed")
@login_required
def invidious_feed():
    max_results = int(request.args.get("max_results", "50"))
    feed = get_feed(max_results)
    if feed is None:
        return jsonify({"error": "No se pudo obtener el feed"}), 401
    return jsonify(feed)


@app.route("/api/invidious/subscribe", methods=["POST"])
@login_required
@limit(10, 60)
def invidious_subscribe():
    data = request.json
    ucid = (data or {}).get("ucid", "")
    if not ucid:
        return jsonify({"error": "ucid requerido"}), 400
    data, err = invidious_auth_post(f"/api/v1/auth/subscriptions/{ucid}")
    if err:
        return jsonify({"error": err}), 401
    return jsonify({"status": "ok"})


@app.route("/api/invidious/unsubscribe", methods=["POST"])
@login_required
@limit(10, 60)
def invidious_unsubscribe():
    data = request.json
    ucid = (data or {}).get("ucid", "")
    if not ucid:
        return jsonify({"error": "ucid requerido"}), 400
    base = get_invidious_url()
    if not base:
        return jsonify({"error": "Invidious no disponible"}), 503
    try:
        resp = requests.delete(base + f"/api/v1/auth/subscriptions/{ucid}",
                               headers=invidious_auth_headers(), timeout=15)
        if resp.status_code == 401:
            return jsonify({"error": "Sesión expirada"}), 401
        resp.raise_for_status()
        return jsonify({"status": "ok"})
    except Exception as e:
        logger.error("Invidious unsubscribe error: %s", e, exc_info=True)
        return jsonify({"error": "Error al cancelar suscripción"}), 500


@app.route("/api/invidious/channel/<ucid>")
@login_required
def invidious_channel_videos(ucid):
    base = get_invidious_url()
    if not base:
        return jsonify({"error": "Invidious no disponible"}), 503
    try:
        resp = requests.get(base + f"/api/v1/channels/{ucid}/videos",
                            params={"sort": "newest"}, timeout=15)
        if not resp.ok:
            return jsonify({"error": "Error al obtener videos"}), resp.status_code
        return jsonify(resp.json())
    except Exception as e:
        logger.error("Invidious channel videos error: %s", e, exc_info=True)
        return jsonify({"error": "Error al obtener videos del canal"}), 500


# ══════════════════════════════════════════════════════════════
# PLAYLIST ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/api/playlists", methods=["GET"])
@login_required
def list_playlists():
    return jsonify(normalize_playlists(get_playlists()))


@app.route("/api/playlists", methods=["POST"])
@login_required
@limit(20, 60)
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
@login_required
@limit(20, 60)
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
@login_required
@limit(10, 60)
def delete_playlist(pid):
    playlists = get_playlists()
    playlists = [p for p in playlists if p["id"] != pid]
    save_playlists(playlists)
    return jsonify({"status": "deleted"})


@app.route("/api/playlists/<int:pid>/songs", methods=["POST"])
@login_required
@limit(30, 60)
def add_to_playlist(pid):
    data = request.json
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
@login_required
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
@login_required
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


# ══════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    host = os.environ.get("HOST", "0.0.0.0")

    # SECURITY FIX: Force debug off when serving on a public interface
    # to prevent Werkzeug debugger RCE (Remote Code Execution).
    flask_debug_env = os.environ.get("FLASK_DEBUG", "").strip().lower()
    is_public_host = host not in ("127.0.0.1", "localhost")

    debug = (flask_debug_env == "1")
    if is_public_host and debug:
        debug = False
        logger.warning(
            "Debug mode forced OFF: FLASK_DEBUG=1 but HOST=%s is public. Set HOST=127.0.0.1 to enable.",
            host,
        )

    logger.info("Server starting on %s:%d (debug=%s)", host, port, debug)
    app.run(host=host, port=port, debug=debug)
