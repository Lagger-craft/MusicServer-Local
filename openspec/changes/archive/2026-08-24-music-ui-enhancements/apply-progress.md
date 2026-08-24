# Apply Progress — PR1 + PR2 + PR3 + PR4 (Music UI Enhancements)

**Change**: music-ui-enhancements
**Work unit**: PR4 — Lyrics UI + animations + queue color fixes (slice 4)
**Mode**: Standard (openspec `apply.tdd: false`; pytest bootstrapped in PR1; frontend verified manually)
**Chain strategy**: stacked-to-main (user chose chained PRs at ask-on-risk)

## Completed Tasks (1.1–1.7 [PR1], 2.1–2.7 [PR2], 3.1–3.4 [PR3], 4.1–4.3 [PR4] + color-fixes)

PR1 (complete — carried from prior batch):
- [x] 1.1 `cache.py`: `PathCache(ttl, max_entries)` with per-entry TTL + LRU eviction.
- [x] 1.2 `metadata.py` (created): `get_metadata(path)` — mutagen tags + embedded APIC/sidecar png → `cover:bool`; filename `Artist - Title (- Album)` fallback.
- [x] 1.3 RED `tests/test_metadata.py`: filename no-separator → title=name, artist=null; untagged → 200 fallback.
- [x] 1.4 `app.py`: `GET /api/metadata?path=` with `resolve_path`+`is_safe_path` (4xx), `login_required`, `limit`, `metadata_cache` (TTL 24h/500); returns `{artist,title,album,duration,cover,path}`.
- [x] 1.5 RED: `GET /api/metadata?path=../../etc/passwd` → 4xx (threat-matrix routing).
- [x] 1.6 `config.py`: `metadataEnabled` default `true` + PUT handler; `requirements.txt`: add `mutagen`.
- [x] 1.7 `static/app.js`: `fetchMetadata(path)` updates `nowPlaying` + stores `track.meta`; called inside `playTrack`.

PR2 (complete — carried from prior batch):
- [x] 2.1 `lyrics.py` (created): `get_lyrics(path, meta)` — LRCLIB GET (`track_name`/`artist_name`, `album_name`, `duration`), `Retry-After` cooldown backoff, timeout=15, returns `{plainLyrics,syncedLyrics,instrumental}`.
- [x] 2.2 `app.py`: added `lyrics_cache` `PathCache` (TTL 7d/500).
- [x] 2.3 RED `tests/test_lyrics.py`: mock LRCLIB 200 → both fields; 429+Retry-After → graceful backoff; instrumental → flag; plus 404/no-match/network/non-JSON/5xx.
- [x] 2.4 `app.py`: `GET /api/lyrics?path=` `resolve_path`+`is_safe_path` 4xx, `login_required`, `limit`, cache; empty 200 on no match.
- [x] 2.5 RED: `GET /api/lyrics?path=../../etc/passwd` → 4xx (threat-matrix routing).
- [x] 2.6 `config.py`/`templates/index.html`: `lyricsEnabled` default true + PUT; lyrics button wired.
- [x] 2.7 `static/app.js`: `fetchLyrics(path, meta)` on play + `toggleLyrics()` from lyrics button.

PR3 (complete — verified in source; merged into this progress from `tasks.md`):
- [x] 3.1 `static/app.js`: in-memory `playHistory=[]` MAX 50, push outgoing track before switch in `playTrack`/`playTrackDirect`/`playYouTubeDirect`.
- [x] 3.2 `renderQueueDrawer()` rewrite: large-cover current card (160px), blurred backdrop from cover, "Próximo" vs "Historial" sections, upcoming thumbnails (`cover:true` → client URL).
- [x] 3.3 Verify history isolation: `playHistory` NEVER written to localStorage (empty on reload).
- [x] 3.4 `static/style.css`: queue drawer card/blur/section/thumbnail styles.

PR4 (this batch):
- [x] 4.1 `static/app.js`: lyrics panel renders synced LRC; `audio.currentTime` `timeupdate` → active-line highlight; instrumental indicator; click-to-seek on a synced line.
- [x] 4.2 `static/style.css` animation refactor: removed `transition: all` from large containers (`.topbar`, `.player-bar`); removed perpetual `pulse-glow` keyframe + `.logo-icon` usage; explicit transitions; `will-change: transform` on `.queue-drawer`/`.lyrics-drawer`; reduced-motion media query already present and global; limited `backdrop-filter` to the lyrics panel only.
- [x] 4.3 Manual verification: queue card/blur/history, lyrics active-line sync, reduced-motion honored.
- [x] **color-fixes** (new user requirement): queue drawer theming consistency — raised `.queue-header` above the blurred backdrop (`position:relative; z-index:1`), replaced hardcoded black scrim with theme-aware `--queue-scrim`, replaced fixed `brightness(0.5)` with theme-aware `--queue-filter`, fixed a stray `}` CSS bug; added `--bg-panel` for the new lyrics panel.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `cache.py` | Modified (PR1) | Added `PathCache` class (per-path TTL + LRU). |
| `metadata.py` | Created (PR1) | `parse_filename`, `get_metadata` (mutagen + cover + filename fallback). |
| `lyrics.py` | Created (PR2) | `get_lyrics(path, meta)`: LRCLIB proxy, Retry-After cooldown, graceful empty result, `instrumental` flag. |
| `app.py` | Modified | `lyrics_cache`; `GET /api/lyrics` route; `lyricsEnabled` PUT; `metadata_cache`; `GET /api/metadata` route; `metadataEnabled` PUT. |
| `config.py` | Modified | `lyricsEnabled` default true (PR2); `metadataEnabled` default true (PR1). |
| `requirements.txt` | Modified (PR1) | Added `mutagen>=1.47.0`. |
| `requirements-dev.txt` | Created (PR1) | `pytest>=8.0.0`. |
| `templates/index.html` | Modified (PR2) | Lyrics button (`#lyricsBtn`) wired to `toggleLyrics()`. |
| `static/app.js` | Modified | PR1: `fetchMetadata`/`currentMeta`. PR2: `fetchLyrics`/`toggleLyrics`/globals/`playTrack` wiring. **PR3: `playHistory`, `pushHistory`, `recordTrackSwitch`, `renderQueueDrawer` rewrite, `renderQueueCurrentCard`, `renderQueueContent`. PR4: `parseLRC`, `openLyrics`, `closeLyrics`, `isLyricsOpen`, `renderLyrics`, `seekToLyric`, `updateLyricsHighlight`; `toggleLyrics` now opens/closes the panel; `onTimeUpdate` drives `updateLyricsHighlight`.** |
| `static/style.css` | Modified | PR3: queue drawer/card/blur/section/thumbnail styles. **PR4: removed `pulse-glow` keyframe + usage; removed `transition: all` from `.topbar`/`.player-bar`; explicit transitions; `will-change: transform` on drawers; removed `backdrop-filter` from persistent/transient chrome (`.topbar`, `.content-header`, `.player-bar`, `.modal-overlay`, `.youtube-overlay`, `.upload-overlay`); added `--bg-panel`/`--queue-scrim`/`--queue-filter` theme vars; fixed stray `}`; added `.queue-header` z-index; theme-aware `.queue-backdrop` scrim/filter; added lyrics panel styles (`.lyrics-overlay`/`.lyrics-drawer`/`.lyrics-line.active` etc., with `backdrop-filter`).** |
| `tests/conftest.py` | Created (PR1) | Flask `client` fixture + patched writable temp music dir. |
| `tests/test_cache.py` | Created (PR1) | PathCache TTL + LRU + invalidate. |
| `tests/test_metadata.py` | Created (PR1) | `parse_filename` variants + `get_metadata` fallback/missing/traversal. |
| `tests/test_metadata_route.py` | Created (PR1) | `/api/metadata` traversal→403, missing→404, untagged→200 + cache. |
| `tests/test_lyrics.py` | Created (PR2) | 10 unit tests mocking LRCLIB. |
| `tests/test_lyrics_route.py` | Created (PR2) | `/api/lyrics` traversal→403, missing→404, untagged→200 empty, success + cache. |

## Work Unit Evidence (PR4)

| Evidence | Required value |
|----------|----------------|
| Focused test command + result | `.venv/bin/python -m pytest tests/ -q` → **27 passed** (unchanged from PR2; PR4 is frontend-only). Backend route/contract regression verified green. |
| Runtime harness command/scenario + result | `python -c "import app"` boots clean (file watcher + server start OK, no syntax/import errors). Frontend JS validated with `node --check static/app.js` → **JS OK**. Core `parseLRC` + active-line index algorithm unit-checked in Node against a multi-timestamp LRC sample → correct ordering and highlight index. |
| Rollback boundary | Frontend-only change. Revert the PR4 hunks in `static/app.js` (lyrics block + `onTimeUpdate` hook) and `static/style.css` (animation/color/lyrics-panel hunks). No backend/runtime behavior affected; backend tests remain green. `tasks.md`/`apply-progress.md` are documentation. |

## Deviations from Design / Spec

### PR4
1. **`toggleLyrics()` now opens a panel, not just fetches.** Design.md described the panel as "rendered by the PR4 lyrics panel" and the PR2 task noted `toggleLyrics()` only fetched. PR4 implements the full toggle (open/close overlay + render). This completes the design intent rather than deviating.
2. **`backdrop-filter` limited to the lyrics panel only.** Task 4.2 says "limit `backdrop-filter` to queue + panel". The queue drawer uses `filter: blur()` on its cover backdrop (not `backdrop-filter`), so the only `backdrop-filter` declarations now live on `.lyrics-drawer`. I additionally removed `backdrop-filter` from `.topbar`, `.content-header`, `.player-bar`, `.modal-overlay`, `.youtube-overlay`, and `.upload-overlay` (all use the `--bg-overlay` dim without blur) to honor the "no overuse" intent. This is stricter than the literal "queue + panel" wording but matches the spec's "limit to intentional surfaces" goal.
3. **`transition: all` retained on small controls/items.** The spec scenario for "No Universal Transitions" scopes the audit to "containers larger than a control" and the requirement to "large containers or frequently repainted elements". I removed `transition: all` from the two large containers that had it (`.topbar`, `.player-bar`) and confirmed the frequently repainted fills (`.progress-fill`, `.volume-fill`) already use explicit `width` transitions. Small controls (buttons, inputs, cards, list items) keep `transition: all` intentionally — they are "controls", not large containers, and the global reduced-motion media query neutralizes them for accessibility.
4. **Queue color fixes went beyond the original PR4 plan.** The user's new requirement ("ajustar los colores según el tema ... para la cola de reproducción") revealed two real defects: (a) `.queue-header` had no stacking context and was painted *behind* the blurred `.queue-backdrop` (z-index:0), making the title/buttons unreadable; (b) the backdrop scrim was a hardcoded black gradient + fixed `brightness(0.5)`, forcing a dark drawer in light theme. Fixed via theme-aware `--queue-scrim`/`--queue-filter` and a z-index fix. Also fixed a stray `}` that followed `.queue-item:hover` (harmless but invalid).
5. **Lyrics panel positioned on the LEFT** (opposite the right-side queue drawer) to avoid overlap and match the "open from either edge" pattern. Slide-in uses a new `lyrics-in` keyframe (translateX -100%→0).

### PR1 / PR2 / PR3 (carried)
- See prior-batch notes: LRCLIB param names corrected; `lyrics_cache` instantiated in `app.py` (mirrors `metadata_cache`); Retry-After as server-side cooldown; tests include extra robustness cases; history isolation confirmed session-only.

## Issues Found
- **Queue header hidden behind blurred backdrop** (pre-existing PR3 defect, surfaced by the color-review requirement) — fixed via `z-index`/stacking context (see Deviation 4).
- **Stray `}` after `.queue-item:hover`** (pre-existing CSS bug) — fixed.
- No backend/runtime issues. Note: real `music/` dir is root-owned; tests use temp-dir patch (does not affect runtime).

## Remaining Tasks (this change)
- **PR1**: none — all 1.1–1.7 complete.
- **PR2**: none — all 2.1–2.7 complete.
- **PR3**: none — all 3.1–3.4 complete.
- **PR4**: none — all 4.1–4.3 + color-fixes complete.

## Workload / PR Boundary
- **Mode**: stacked PR slice (PR4 of 4).
- **Current work unit**: PR4 — Lyrics UI + animations + queue color fixes.
- **Boundary**: starts from PR3 base; ends with `parseLRC`/`renderLyrics`/`updateLyricsHighlight` + lyrics panel DOM/CSS, animation refactor (pulse-glow removal, explicit transitions, will-change, backdrop-filter limit, reduced-motion already present), and queue color/contrast fixes. Isolated from backend (PR1/PR2) and queue structure (PR3).
- **Estimated review budget impact**: ~PR4 ≈ 330 changed lines (frontend only), within the 400-line per-PR budget. Backend tests untouched (27 still passing).

## Status
17/17 cumulative tasks complete (PR1 7/7 + PR2 7/7 + PR3 4/4 + PR4 3/3 + color-fixes). **Ready for final verify (sdd-verify) then archive.**
