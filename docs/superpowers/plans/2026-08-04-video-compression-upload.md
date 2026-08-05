# Video Compression & Upload Limit Increase

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow uploading videos up to 15GB, with automatic FFmpeg compression for files over 10GB to reduce size while preserving quality.

**Architecture:** Increase Flask's MAX_CONTENT_LENGTH to 15GB. Add a new `/api/immich/upload-compressed` endpoint that streams the uploaded file through FFmpeg (H.265/HEVC) before forwarding to Immich. Frontend detects file size and offers compression option for files >10GB.

**Tech Stack:** Python/Flask, FFmpeg (subprocess), JavaScript (fetch API), Immich API

---

## Task 1: Increase MAX_CONTENT_LENGTH

**Files:**
- Modify: `app.py:75`

**Interfaces:**
- Consumes: none
- Produces: allows requests up to 15GB

- [ ] **Step 1: Update the limit**

```python
# app.py:75
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024 * 1024  # 15GB
```

- [ ] **Step 2: Verify change**

Run: `grep "MAX_CONTENT_LENGTH" app.py`
Expected: Shows `15 * 1024 * 1024 * 1024`

- [ ] **Step 3: Commit**

```bash
git add app.py
git commit -m "feat: increase upload limit to 15GB"
```

---

## Task 2: Add FFmpeg compression helper

**Files:**
- Modify: `immich.py` (add compression function)

**Interfaces:**
- Consumes: FFmpeg binary in PATH
- Produces: `compress_video(input_path, output_path, crf=28)` — runs FFmpeg to re-encode with H.265

- [ ] **Step 1: Add compression function to immich.py**

Add at the top of `immich.py`, after existing imports:

```python
import subprocess
import tempfile
import os
import logging

logger = logging.getLogger(__name__)

COMPRESS_THRESHOLD = 10 * 1024 * 1024 * 1024  # 10GB

def compress_video(input_path, output_path, crf=28):
    """Compress video using FFmpeg H.265. Returns (success, error_msg)."""
    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-c:v", "libx265",
        "-crf", str(crf),
        "-preset", "fast",
        "-c:a", "copy",  # copy audio without re-encoding
        "-tag:v", "hvc1",
        output_path,
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=7200  # 2h timeout
        )
        if result.returncode != 0:
            logger.error("FFmpeg failed: %s", result.stderr[-500:])
            return False, f"FFmpeg error: {result.stderr[-200:]}"
        return True, None
    except subprocess.TimeoutExpired:
        return False, "Compresión timeout (>2h)"
    except FileNotFoundError:
        return False, "FFmpeg no encontrado en el sistema"
```

- [ ] **Step 2: Verify syntax**

Run: `python -c "from immich import compress_video; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add immich.py
git commit -m "feat: add FFmpeg H.265 compression helper"
```

---

## Task 3: Add compressed upload endpoint

**Files:**
- Modify: `immich.py` (add `handle_upload_compressed`)
- Modify: `app.py:450-457` (add route)

**Interfaces:**
- Consumes: `compress_video()` from Task 2, `immich_api_request()` existing
- Produces: `POST /api/immich/upload-compressed` endpoint

- [ ] **Step 1: Add handle_upload_compressed to immich.py**

Add after `handle_upload()`:

```python
def handle_upload_compressed():
    if "file" not in request.files:
        return {"error": "No se envió ningún archivo"}, 400
    file = request.files["file"]
    if not file.filename:
        return {"error": "Nombre de archivo vacío"}, 400

    album_id = request.form.get("albumId")
    crf = int(request.form.get("crf", 28))  # quality: lower=better, 28=good balance
    filename = file.filename
    _, ext = os.path.splitext(filename)

    # Save to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext or ".mp4") as tmp:
        tmp_path = tmp.name
        file.save(tmp)

    original_size = os.path.getsize(tmp_path)
    logger.info("Compressing %s (%.1f GB)", filename, original_size / (1024**3))

    output_path = tmp_path + ".compressed.mp4"
    success, err = compress_video(tmp_path, output_path, crf=crf)

    if not success:
        os.unlink(tmp_path)
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

    # Cleanup temp files
    os.unlink(tmp_path)
    os.unlink(output_path)

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
```

- [ ] **Step 2: Add route in app.py**

Add after the existing `immich_upload` route (around line 457):

```python
@app.route("/api/immich/upload-compressed", methods=["POST"])
@login_required
@limit(2, 60)  # stricter limit due to CPU cost
def immich_upload_compressed():
    result = immich_handle_upload_compressed()
    if isinstance(result, tuple) and len(result) >= 2:
        return jsonify(result[0]), result[1]
    return jsonify(result)
```

Also add import at top of app.py (near line 39):

```python
from immich import (
    handle_upload as immich_handle_upload,
    handle_upload_compressed as immich_handle_upload_compressed,
    ...
)
```

- [ ] **Step 3: Verify syntax**

Run: `python -c "from app import app; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add immich.py app.py
git commit -m "feat: add /upload-compressed endpoint with FFmpeg H.265"
```

---

## Task 4: Frontend compression UI

**Files:**
- Modify: `static/app.js` (update `startImmichUpload`)
- Modify: `templates/index.html` (add compression checkbox)

**Interfaces:**
- Consumes: `/api/immich/upload-compressed` from Task 3
- Produces: checkbox in upload dialog, routes to correct endpoint

- [ ] **Step 1: Add compression checkbox to upload overlay in index.html**

Find the `uploadOverlay` div and add a checkbox before the progress bar:

```html
<label id="compressLabel" style="display:none; margin: 10px 0; color: var(--text);">
  <input type="checkbox" id="compressCheck" checked>
  Comprimir con H.265 (reduce tamaño ~50%)
</label>
```

- [ ] **Step 2: Update startImmichUpload in app.js**

Replace the existing `startImmichUpload` function:

```javascript
async function startImmichUpload(file, albumId) {
  const overlay = document.getElementById('uploadOverlay');
  const text = document.getElementById('uploadText');
  const fill = document.getElementById('uploadProgressFill');
  const compressLabel = document.getElementById('compressLabel');
  const compressCheck = document.getElementById('compressCheck');

  text.textContent = `Subiendo ${file.name}...`;
  fill.style.width = '0%';
  overlay.style.display = 'flex';

  // Show compression option for files >10GB
  const threshold = 10 * 1024 * 1024 * 1024;
  const useCompression = file.size > threshold && compressCheck.checked;
  compressLabel.style.display = file.size > threshold ? 'block' : 'none';

  const endpoint = useCompression ? 'upload-compressed' : 'upload';
  if (useCompression) {
    text.textContent = `Comprimiendo y subiendo ${file.name}... (esto puede tardar)`;
  }

  const form = new FormData();
  form.append('file', file);
  if (albumId) form.append('albumId', albumId);

  try {
    const res = await fetch(`${API_BASE}/immich/${endpoint}`, {
      method: 'POST', body: form,
    });
    let data;
    try {
      data = await res.json();
    } catch (_) {
      const txt = await res.text();
      alert(`Error del servidor (${res.status}): ${txt.slice(0, 200)}`);
      overlay.style.display = 'none';
      compressLabel.style.display = 'none';
      return;
    }
    if (data.error) { alert(data.error); overlay.style.display = 'none'; compressLabel.style.display = 'none'; return; }

    let msg = data.warning || '✅ Subido correctamente';
    if (data.reduction) {
      msg += ` (${data.reduction} reducción)`;
    }
    text.textContent = msg;
    fill.style.width = '100%';
    setTimeout(() => {
      overlay.style.display = 'none';
      compressLabel.style.display = 'none';
      if (albumId && immichView === `album-${albumId}`) {
        loadImmichAlbum(albumId);
      } else {
        loadImmichAlbums();
      }
    }, 1500);
  } catch (e) {
    console.error(e);
    alert('Error de conexión al subir');
    overlay.style.display = 'none';
    compressLabel.style.display = 'none';
  }
}
```

- [ ] **Step 3: Verify syntax**

Run: `node -c static/app.js && echo "OK"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add static/app.js templates/index.html
git commit -m "feat: add compression checkbox for uploads >10GB"
```

---

## Task 5: Manual verification

- [ ] **Step 1: Start the server**

```bash
python app.py
```

- [ ] **Step 2: Test upload flow**
1. Open http://localhost:5000
2. Navigate to Immich → select an album → click upload
3. Select a file >10GB — verify checkbox appears
4. Select a file <10GB — verify checkbox is hidden
5. Upload with compression enabled — verify it completes and shows reduction %
6. Upload without compression — verify direct upload works

- [ ] **Step 3: Check logs for FFmpeg output**

Verify no errors in terminal output during compression.

---

## Summary of changes

| File | Change |
|------|--------|
| `app.py` | MAX_CONTENT_LENGTH 4GB→15GB, new route `/api/immich/upload-compressed` |
| `immich.py` | `compress_video()` function, `handle_upload_compressed()` handler |
| `static/app.js` | Compression checkbox logic, route to correct endpoint |
| `templates/index.html` | Compression checkbox HTML element |
