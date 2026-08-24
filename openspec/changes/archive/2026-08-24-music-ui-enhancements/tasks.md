# Tasks: Music UI Enhancements

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1380 (PR1 350 / PR2 280 / PR3 380 / PR4 370) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 → PR3 → PR4 |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Metadata backend | PR1 | `python -c "from metadata import get_metadata; get_metadata('main/song.mp3')"` | `python app.py` + `curl 'localhost:5000/api/metadata?path=...'` | revert metadata.py/cache.py/app.py routes + drop mutagen |
| 2 | Lyrics backend | PR2 | `python -c "from lyrics import get_lyrics; get_lyrics('main/song.mp3', {...})"` | `python app.py` + `curl 'localhost:5000/api/lyrics?path=...'` | revert lyrics.py + routes |
| 3 | Queue frontend | PR3 | N/A (no suite) — manual: play → open drawer | `python app.py`, browser drawer check | revert app.js `renderQueueDrawer` + style.css queue blocks |
| 4 | Lyrics UI + anim | PR4 | N/A — manual: open lyrics panel | `python app.py`, browser sync check | revert app.js lyrics block + style.css anim |

## PR1 — Metadata backend (slice 1)

- [x] 1.1 `cache.py`: add `PathCache(ttl, max_entries)` with per-entry TTL + LRU eviction (mirror `ThreadSafeCache` lock style). [M]
- [x] 1.2 `metadata.py` (create): `get_metadata(path)` — mutagen tags (artist/title/album/duration) + embedded APIC/sidecar png → `cover:bool`; filename `Artist - Title (- Album)` fallback when tags absent. [L]
- [x] 1.3 RED `tests/test_metadata.py`: filename no-separator → title=name, artist=null; untagged returns 200 fallback (spec Filename Fallback / Lazy). [S]
- [x] 1.4 `app.py`: `GET /api/metadata?path=` using `resolve_path`+`is_safe_path` (4xx on invalid, mirror `/api/cover`), `login_required`, `limit`, serve from `PathCache` `metadata_cache` (TTL 24h/500); returns `{artist,title,album,duration,cover,path}`. [M]
- [x] 1.5 RED: `GET /api/metadata?path=../../etc/passwd` → 4xx (threat-matrix routing). [S]
- [x] 1.6 `config.py`: add `metadataEnabled` default true + PUT handler; `requirements.txt`: add `mutagen`. [S]
- [x] 1.7 `static/app.js`: `fetchMetadata(path)` updates `nowPlaying` + queue card cover; call inside `playTrack`. [M]

## PR2 — Lyrics backend (slice 2)

- [x] 2.1 `lyrics.py` (create): `get_lyrics(path, meta)` — LRCLIB GET (`track_name`/`artist_name`, `album_name`, `duration`), `Retry-After` cooldown backoff, timeout=15, returns `{plainLyrics,syncedLyrics,instrumental}`. [L]
- [x] 2.2 `app.py`: add `lyrics_cache` `PathCache` (TTL 7d/500) — mirrors `metadata_cache` placement. [S]
- [x] 2.3 RED `tests/test_lyrics.py`: mock LRCLIB 200 → both fields; 429+Retry-After → graceful backoff (cooldown), no client error; instrumental → flag no body; plus 404/no-match/network/non-JSON/5xx. [M]
- [x] 2.4 `app.py`: `GET /api/lyrics?path=` `resolve_path`+`is_safe_path` 4xx, `login_required`, `limit`, cache; empty 200 on no match. [M]
- [x] 2.5 RED: `GET /api/lyrics?path=../../etc/passwd` → 4xx (threat-matrix routing). [S]
- [x] 2.6 `config.py`/`templates/index.html`: `lyricsEnabled` default true + PUT; lyrics button wired. [S]
- [x] 2.7 `static/app.js`: `fetchLyrics(path, meta)` on play + `toggleLyrics()` from lyrics button. [M]

## PR3 — Queue frontend (slice 3)

- [x] 3.1 `static/app.js`: in-memory `playHistory=[]` MAX 50, push outgoing track before switch in `playTrack`/`playTrackDirect`/`playYouTubeDirect`. [M]
- [x] 3.2 `renderQueueDrawer()` rewrite: large-cover current card (160px), blurred backdrop from cover, "Próximo" vs "Historial" sections, upcoming thumbnails (`cover:true` → client URL). [L]
- [x] 3.3 Verify history isolation: `playHistory` never written to localStorage (empty on reload). [S]
- [x] 3.4 `static/style.css`: queue drawer card/blur/section/thumbnail styles. [M]

## PR4 — Lyrics UI + animations (slice 4)

- [x] 4.1 `static/app.js`: lyrics panel renders synced LRC; `audio.currentTime` `timeupdate` → active-line highlight; instrumental indicator. [L]
- [x] 4.2 `static/style.css` animation refactor: remove `transition: all` on large containers; remove infinite box-shadow pulse; explicit props + `will-change`; wrap motion in `@media (prefers-reduced-motion: reduce)`; limit `backdrop-filter` to queue + panel. [M]
- [x] 4.3 Manual verification: queue card/blur/history, lyrics active-line sync, reduced-motion honored. [S]
