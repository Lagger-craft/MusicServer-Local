# Upload Queue (Background Processing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to queue multiple video uploads that process in the background, with a tray UI showing progress so they can continue browsing.

**Architecture:** A Python `threading.Thread`-based worker processes uploads from a `queue.Queue`. Jobs are tracked in an in-memory dict with status/progress. Frontend polls `/api/immich/queue` and shows a slide-in tray.

**Tech Stack:** Python threading, Flask, vanilla JavaScript (polling), CSS custom properties

## Global Constraints

- No external dependencies (no Celery, no Redis) — single-user server
- Must follow existing patterns (ThreadSafeCache, daemon threads)
- CSS must use existing theme variables
- Existing upload endpoints must remain (backward compat)

---

## Task 1: Create upload_queue.py module

**Files:** Create `upload_queue.py`

- [ ] Create `upload_queue.py` with:
  - `JobStatus` enum (pending, compressing, uploading, done, error, cancelled)
  - `UploadJob` dataclass (id, filename, album_id, crf, compress, status, progress, sizes, asset_id, error, created_at)
  - `UploadQueue` class with thread-safe job tracking and worker thread
  - Methods: `start()`, `add_job()`, `get_jobs()`, `get_job()`, `cancel_job()`
  - Singleton: `upload_queue = UploadQueue()`

- [ ] Verify: `python -c "from upload_queue import upload_queue; print('OK')"`

---

## Task 2: Refactor immich.py for queue integration

**Files:** Modify `immich.py`

- [ ] Add `do_upload(job)` — executes upload using job.data_stream
- [ ] Add `do_upload_compressed(job)` — compress + upload using job.data_stream
- [ ] Verify: `python -c "from immich import do_upload, do_upload_compressed; print('OK')"`

---

## Task 3: Add queue API routes to app.py

**Files:** Modify `app.py`

- [ ] Import upload_queue, start worker after app init
- [ ] Add `POST /api/immich/queue` — add file to queue
- [ ] Add `GET /api/immich/queue` — list all jobs
- [ ] Add `GET /api/immich/queue/<id>` — get job status
- [ ] Add `DELETE /api/immich/queue/<id>` — cancel job
- [ ] Verify: `python -c "from app import app; print('OK')"`

---

## Task 4: Frontend queue tray HTML + CSS

**Files:** Modify `templates/index.html`, `static/style.css`

- [ ] Add queue tray HTML (`.queue-tray`, header, list, toggle button)
- [ ] Add queue tray CSS (slide-up animation, themed with existing variables)
- [ ] Verify: `node -c static/app.js` (no JS errors)

---

## Task 5: Frontend queue tray JavaScript

**Files:** Modify `static/app.js`

- [ ] Add `toggleQueueTray()` — show/hide tray
- [ ] Add `renderQueueTray(jobs)` — render job list with status/cancel
- [ ] Add `pollQueue()` — fetch `/api/immich/queue` every 3s
- [ ] Update `startImmichUpload()` to POST to `/api/immich/queue` instead
- [ ] Show tray toggle button when queue has items
- [ ] Verify: `node -c static/app.js`

---

## Summary

| File | Change |
|------|--------|
| `upload_queue.py` (new) | Background worker, job tracking |
| `immich.py` | `do_upload()`, `do_upload_compressed()` |
| `app.py` | Queue routes, start worker |
| `templates/index.html` | Queue tray HTML |
| `static/style.css` | Queue tray styles |
| `static/app.js` | Queue tray JS, polling, cancel |
