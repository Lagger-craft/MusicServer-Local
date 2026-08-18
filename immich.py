import logging
import os
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone

import requests
from flask import Response, jsonify, request

from config import decrypt_value, get_config, update_config, encrypt_value

COMPRESS_THRESHOLD = 10 * 1024 * 1024 * 1024  # 10GB

logger = logging.getLogger(__name__)


def get_immich_config():
    cfg = get_config()
    return {
        "url": cfg.get("immich_url", "").rstrip("/"),
        "apiKey": decrypt_value(cfg.get("immich_api_key", "")),
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


def immich_api_request(method, path, data=None, files=None):
    cfg = get_immich_config()
    if not cfg["url"] or not cfg["apiKey"]:
        return None, "Immich no configurado"
    url = cfg["url"] + "/api" + path
    headers = {"x-api-key": cfg["apiKey"]}
    timeout = 600 if files else 15
    try:
        if files:
            resp = requests.request(method, url, headers=headers,
                                    data=data, files=files, timeout=timeout)
        else:
            headers["Content-Type"] = "application/json"
            resp = requests.request(method, url, headers=headers,
                                    json=data, timeout=timeout)
        if resp.status_code == 400:
            body = resp.text[:500] if resp.text else "sin detalles"
            return None, f"Solicitud inválida a Immich: {body}"
        if resp.status_code == 401:
            return None, "API key inválida"
        if resp.status_code == 403:
            body = resp.text[:500] if resp.text else ""
            msg = "La API key no tiene permisos de escritura"
            if body:
                msg += f" ({body})"
            msg += ". Creá una nueva en Immich → Settings → API Keys con todos los scopes."
            return None, msg
        if resp.status_code == 404:
            return None, "Recurso no encontrado en Immich"
        resp.raise_for_status()
        if resp.status_code in (200, 201) and resp.content:
            return resp.json(), None
        return {"status": "ok"}, None
    except requests.ConnectionError:
        return None, "No se pudo conectar con Immich"
    except Exception as e:
        return None, str(e)


def immich_album_video_assets(album_id):
    """Load all video assets in an album through Immich metadata search."""
    assets = []
    page = 1
    page_size = 1000

    while True:
        result, err = immich_api_request(
            "POST",
            "/search/metadata",
            data={
                "albumIds": [album_id],
                "type": "VIDEO",
                "page": page,
                "size": page_size,
            },
        )
        if err:
            return None, err

        asset_results = result.get("assets", []) if isinstance(result, dict) else []
        if isinstance(asset_results, dict):
            # Current Immich returns SearchAssetResponseDto: {items, nextPage}.
            batch = asset_results.get("items", [])
        else:
            # Keep compatibility with older responses that returned a list.
            batch = asset_results
        assets.extend(batch)
        next_page = None
        if isinstance(asset_results, dict):
            next_page = asset_results.get("nextPage")
        if next_page is None and isinstance(result, dict):
            next_page = result.get("nextPage")
        if not next_page:
            break
        try:
            page = int(next_page)
        except (TypeError, ValueError):
            page += 1

    return assets, None


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


# ── Config routes ───────────────────────────────────────────

def handle_get_config():
    cfg = get_immich_config()
    return {"url": cfg["url"], "connected": bool(cfg["url"] and cfg["apiKey"])}


def handle_set_config(data):
    url = (data.get("url") or "").rstrip("/")
    api_key = data.get("apiKey") or ""
    if not url or not api_key:
        return {"error": "URL y API key requeridas"}, 400
    try:
        # Validate the credential itself instead of using an albums endpoint,
        # whose response can depend on the Immich version and user permissions.
        r = requests.get(url + "/api/api-keys/me", headers={"x-api-key": api_key}, timeout=10)
        if r.status_code == 401:
            return {"error": "API key inválida"}, 400
        if r.status_code == 403:
            return {"error": "La API key no tiene permiso para validarse en Immich"}, 400
        r.raise_for_status()
    except requests.ConnectionError:
        return {"error": "No se pudo conectar con Immich"}, 400
    except Exception as e:
        logger.warning("Immich credential validation failed: status=%s url=%s error=%s",
                       getattr(r, "status_code", "unknown"), url, e)
        return {"error": str(e)}, 400
    cfg = get_config()
    cfg["immich_url"] = url
    cfg["immich_api_key"] = encrypt_value(api_key)
    update_config(cfg)
    return {"status": "ok", "url": url, "connected": True}


def compress_video(input_path, output_path, crf=28, job=None):
    """Compress video using FFmpeg H.265. Returns (success, error_msg).
    
    If job is provided, updates job.progress with FFmpeg output.
    """
    import re
    
    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-c:v", "libx265",
        "-crf", str(crf),
        "-preset", "fast",
        "-c:a", "copy",
        "-tag:v", "hvc1",
        "-stats",
        output_path,
    ]
    try:
        proc = subprocess.Popen(
            cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True
        )
        
        # Parse FFmpeg progress from stderr
        time_re = re.compile(r"time=(\d+):(\d+):(\d+)")
        speed_re = re.compile(r"speed=\s*([\d.]+)x")
        
        while True:
            line = proc.stderr.readline()
            if not line and proc.poll() is not None:
                break
            if not line:
                continue
            
            # Parse time and speed
            time_match = time_re.search(line)
            speed_match = speed_re.search(line)
            
            if time_match and job:
                h, m, s = int(time_match.group(1)), int(time_match.group(2)), int(time_match.group(3))
                elapsed = f"{h:02d}:{m:02d}:{s:02d}"
                speed = f"{speed_match.group(1)}x" if speed_match else ""
                job.progress = f"Comprimiendo... {elapsed} {speed}".strip()
            
            logger.debug("FFmpeg: %s", line.strip())
        
        if proc.returncode != 0:
            stderr_output = proc.stderr.read() if proc.stderr else ""
            logger.error("FFmpeg failed: %s", stderr_output[-500:])
            return False, f"FFmpeg error: {stderr_output[-200:]}"
        
        return True, None
    except FileNotFoundError:
        return False, "FFmpeg no encontrado en el sistema"
    except Exception as e:
        return False, f"Error inesperado: {e}"


def handle_upload():
    if "file" not in request.files:
        return {"error": "No se envió ningún archivo"}, 400
    file = request.files["file"]
    if not file.filename:
        return {"error": "Nombre de archivo vacío"}, 400

    album_id = request.form.get("albumId")
    filename = file.filename
    _, ext = os.path.splitext(filename)

    device_asset_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
          f"{datetime.now(timezone.utc).microsecond:06d}Z"

    files = {
        "assetData": (filename, file.stream, "application/octet-stream")
    }
    data = {
        "deviceAssetId": device_asset_id,
        "deviceId": "server-music",
        "fileCreatedAt": now,
        "fileModifiedAt": now,
        "fileExtension": ext or ".mp4",
    }

    result, err = immich_api_request("POST", "/assets", data=data, files=files)
    if err:
        return {"error": err}, 400

    asset_id = result.get("id")

    if album_id and asset_id:
        _, err = immich_api_request("PUT", f"/albums/{album_id}/assets",
                                    data={"ids": [asset_id]})
        if err:
            return {
                "warning": f"Subido pero no se pudo agregar al álbum: {err}",
                "assetId": asset_id,
                "filename": filename,
            }, 200

    return {
        "status": "ok",
        "assetId": asset_id,
        "filename": filename,
    }, 200


def handle_upload_compressed():
    if "file" not in request.files:
        return {"error": "No se envió ningún archivo"}, 400
    file = request.files["file"]
    if not file.filename:
        return {"error": "Nombre de archivo vacío"}, 400

    album_id = request.form.get("albumId")
    try:
        crf = int(request.form.get("crf", 28))
    except (ValueError, TypeError):
        return {"error": "CRF must be an integer"}, 400
    if not (0 <= crf <= 51):
        return {"error": "CRF must be between 0 and 51"}, 400
    filename = file.filename
    _, ext = os.path.splitext(filename)

    # Save to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext or ".mp4") as tmp:
        tmp_path = tmp.name
        file.save(tmp)

    output_path = tmp_path + ".compressed.mp4"
    try:
        original_size = os.path.getsize(tmp_path)
        logger.info("Compressing %s (%.1f GB)", filename, original_size / (1024**3))

        success, err = compress_video(tmp_path, output_path, crf=crf)

        if not success:
            return {"error": err}, 400

        compressed_size = os.path.getsize(output_path)
        ratio = (1 - compressed_size / original_size) * 100

        # Upload to Immich
        device_asset_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
              f"{datetime.now(timezone.utc).microsecond:06d}Z"

        with open(output_path, "rb") as f:
            files = {"assetData": (filename, f, "application/octet-stream")}
            data = {
                "deviceAssetId": device_asset_id,
                "deviceId": "server-music",
                "fileCreatedAt": now,
                "fileModifiedAt": now,
                "fileExtension": ext or ".mp4",
            }
            result, err = immich_api_request("POST", "/assets", data=data, files=files)
    finally:
        for p in (tmp_path, output_path):
            if os.path.exists(p):
                os.unlink(p)

    if err:
        return {"error": err}, 400

    asset_id = result.get("id")

    if album_id and asset_id:
        _, err = immich_api_request("PUT", f"/albums/{album_id}/assets",
                                    data={"ids": [asset_id]})
        if err:
            return {
                "warning": f"Subido pero no se pudo agregar al álbum: {err}",
                "assetId": asset_id,
                "filename": filename,
                "originalSize": original_size,
                "compressedSize": compressed_size,
                "reduction": f"{ratio:.1f}%",
            }, 200

    return {
        "status": "ok",
        "assetId": asset_id,
        "filename": filename,
        "originalSize": original_size,
        "compressedSize": compressed_size,
        "reduction": f"{ratio:.1f}%",
    }, 200


# ── Queue upload functions ───────────────────────────────────


def do_upload(job):
    """Direct upload from job.data_stream to Immich."""
    stream = job.data_stream
    filename = job.filename
    _, ext = os.path.splitext(filename)

    device_asset_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
          f"{datetime.now(timezone.utc).microsecond:06d}Z"

    files = {
        "assetData": (filename, stream, "application/octet-stream")
    }
    data = {
        "deviceAssetId": device_asset_id,
        "deviceId": "server-music",
        "fileCreatedAt": now,
        "fileModifiedAt": now,
        "fileExtension": ext or ".mp4",
    }

    result, err = immich_api_request("POST", "/assets", data=data, files=files)
    if err:
        raise RuntimeError(err)

    asset_id = result.get("id")
    job.asset_id = asset_id

    if job.album_id and asset_id:
        _, err = immich_api_request("PUT", f"/albums/{job.album_id}/assets",
                                    data={"ids": [asset_id]})
        if err:
            logger.warning("Upload OK but album add failed for %s: %s", job.id, err)

    job.original_size = getattr(stream, 'seek', None) and stream.seek(0, 2) or 0
    if hasattr(stream, 'seek'):
        stream.seek(0)

    logger.info("Upload completed: %s — asset %s", job.id, asset_id)


def do_upload_compressed(job):
    """Compress job.data_stream with FFmpeg then upload to Immich."""
    crf = job.crf
    if not (0 <= crf <= 51):
        raise ValueError(f"CRF must be between 0 and 51, got {crf}")

    stream = job.data_stream
    filename = job.filename
    _, ext = os.path.splitext(filename)

    tmp_path = None
    output_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext or ".mp4") as tmp:
            tmp_path = tmp.name
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                tmp.write(chunk)

        job.original_size = os.path.getsize(tmp_path)

        output_path = tmp_path + ".compressed.mp4"
        logger.info("Compressing %s (%.1f GB) [CRF %d]", filename,
                     job.original_size / (1024**3), crf)

        success, err = compress_video(tmp_path, output_path, crf=crf, job=job)
        if not success:
            raise RuntimeError(f"Compresión falló: {err}")

        job.compressed_size = os.path.getsize(output_path)
        ratio = (1 - job.compressed_size / job.original_size) * 100
        logger.info("Compressed %s: %.1f%% reduction", filename, ratio)

        device_asset_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
              f"{datetime.now(timezone.utc).microsecond:06d}Z"

        with open(output_path, "rb") as f:
            files = {"assetData": (filename, f, "application/octet-stream")}
            data = {
                "deviceAssetId": device_asset_id,
                "deviceId": "server-music",
                "fileCreatedAt": now,
                "fileModifiedAt": now,
                "fileExtension": ext or ".mp4",
            }
            result, err = immich_api_request("POST", "/assets", data=data, files=files)

        if err:
            raise RuntimeError(f"Upload falló: {err}")

        asset_id = result.get("id")
        job.asset_id = asset_id

        if job.album_id and asset_id:
            _, err = immich_api_request("PUT", f"/albums/{job.album_id}/assets",
                                        data={"ids": [asset_id]})
            if err:
                logger.warning("Compressed upload OK but album add failed for %s: %s",
                               job.id, err)

        logger.info("Compressed upload completed: %s — asset %s", job.id, asset_id)
    finally:
        for p in (tmp_path, output_path):
            if p and os.path.exists(p):
                os.unlink(p)
