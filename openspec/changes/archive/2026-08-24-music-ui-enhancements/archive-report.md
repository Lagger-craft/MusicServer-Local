# Archive Report — music-ui-enhancements

**Archived**: 2026-08-24
**Mode**: hybrid (OpenSpec file + Engram)
**Change folder**: `openspec/changes/archive/2026-08-24-music-ui-enhancements/`
**Engram report key**: `sdd/music-ui-enhancements/archive-report`

## Gate Decisions

### Native Review Receipt Gate
- **Result: `disabled/unmanaged`** — No `reviews/` transaction, ledger, receipt, or gate-context exists for this change; no review ever governed it (kill switch off). No explicit review artifact failed validation.
- `verify-report` (`#73`) reports `critical_findings: 0`, `blockers: 0`. No CRITICAL blocker exists, so archive is permitted under the strict rule (CRITICAL issues always block — none present here).

### Task Completion Gate
- **Passed.** The filesystem `tasks.md` (the artifact that is moved into the archive) shows all **17/17** implementation tasks complete, including PR4 4.1–4.3 (`[x]`).
- The Engram `tasks` observation (`#71`) was **stale** — it showed PR4 4.1–4.3 unchecked. It is superseded by: (a) the filesystem `tasks.md` (authoritative, complete), (b) `apply-progress` (`#72`, 17/17 complete + source evidence), and (c) the orchestrator's final-state instruction ("All 4 PRs implemented, 17 tasks total"). The archived audit trail therefore contains no stale unchecked tasks.
- No exceptional archive-time checkbox reconciliation was required on the filesystem file.

### Final-State Authority
The `verify-report` (`#73`) is an **intermediate snapshot** taken before post-verify fixes. Per the Final-State Authority hierarchy, post-verify facts + the orchestrator's launch prompt outrank that snapshot:
- **R19 (MUST, No Universal Transitions)**: snapshot marked PARTIAL (`.sidebar` still `transition: all 0.4s`). **Final: FIXED** — `.sidebar` transition changed to `width 0.4s, transform 0.4s`.
- **R21 (SHOULD, Explicit Transitions)**: snapshot marked PARTIAL. **Final: accepted documented deviation** — `transition: all` retained only on small controls (large containers fixed); reduced-motion media query neutralizes them. No longer treated as a gap.
- **Test counts**: 27 backend tests passing (final, unchanged by post-verify fix — frontend-only CSS change).

## Final State Summary
All 4 chained PRs (stacked-to-main, ask-on-risk) are implemented and integrated. 23 requirements / 26 scenarios specified; all 23 implemented in source. 17 scenarios have runtime (pytest) evidence; 2 animation scenarios resolved post-verify; 7 frontend (queue/lyrics) scenarios require manual browser confirmation. 27 backend tests pass; `node --check` and `import app` clean. Zero CRITICAL findings.

## PRs Delivered

### PR1 — Metadata backend (slice 1)
- `PathCache(ttl, max_entries)` (per-entry TTL + LRU) added to `cache.py`.
- `metadata.py` (new): `get_metadata(path)` via mutagen + embedded APIC/sidecar png → `cover: bool`; filename `Artist - Title (- Album)` fallback.
- `app.py`: `GET /api/metadata?path=` with `resolve_path`+`is_safe_path` (4xx on invalid), `login_required`, `limit`, served from `metadata_cache` (TTL 24h / LRU 500); returns `{artist,title,album,duration,cover,path}`.
- `config.py`: `metadataEnabled` default true + PUT handler; `requirements.txt`: `mutagen`.
- `static/app.js`: `fetchMetadata(path)` updates `nowPlaying` + queue card cover, called in `playTrack`.
- Tests: `tests/test_metadata.py`, `tests/test_metadata_route.py`, `tests/test_cache.py`.

### PR2 — Lyrics backend (slice 2)
- `lyrics.py` (new): `get_lyrics(path, meta)` — LRCLIB GET (`artist_name`/`track_name`/`album_name`/`duration`), `Retry-After` cooldown backoff, timeout=15, returns `{plainLyrics,syncedLyrics,instrumental}`.
- `app.py`: `lyrics_cache` `PathCache` (TTL 7d / LRU 500); `GET /api/lyrics?path=` (safe-path 4xx, login, limit, cache, empty 200 on no match).
- `config.py` / `templates/index.html`: `lyricsEnabled` default true + PUT; lyrics button wired.
- `static/app.js`: `fetchLyrics(path, meta)` on play + `toggleLyrics()` (opens/closes panel — completes design intent).
- Tests: `tests/test_lyrics.py`, `tests/test_lyrics_route.py`.

### PR3 — Queue frontend (slice 3)
- `static/app.js`: in-memory `playHistory=[]` MAX 50, outgoing track pushed before switch (`playTrack`/`playTrackDirect`/`playYouTubeDirect`).
- `renderQueueDrawer()` rewrite: 160px large-cover current card, blurred backdrop from cover, "Próximo" vs "Historial" sections, upcoming thumbnails (`cover:true` → client URL).
- History isolation verified: `playHistory` never written to `localStorage` (empty on reload).
- `static/style.css`: queue drawer card/blur/section/thumbnail styles.

### PR4 — Lyrics UI + animations + queue color fixes (slice 4)
- `static/app.js`: lyrics panel renders synced LRC; `audio.currentTime` `timeupdate` → active-line highlight; instrumental indicator; click-to-seek.
- `static/style.css` animation refactor: removed `transition: all` from `.topbar`/`.player-bar`; removed `pulse-glow` keyframe + `.logo-icon` usage; explicit transitions; `will-change: transform`; reduced-motion media query; `backdrop-filter` limited to lyrics panel (removed from topbar/content-header/player-bar/modals/overlays).
- **Queue color fixes**: `.queue-header` z-index above blurred backdrop; theme-aware `--queue-scrim` + `--queue-filter`; fixed stray `}`; added `--bg-panel`. Fixed two real defects (header painted behind backdrop; hardcoded black scrim forcing dark drawer in light theme).

## Post-Verify Fixes (applied after `verify-report` snapshot)
- **R19 (MUST) — FIXED**: `.sidebar` transition changed from `all 0.4s` → `width 0.4s, transform 0.4s`. Resolves the only large-container universal-transition violation.
- **R21 (SHOULD) — accepted deviation**: explicit transition props not broadly adopted; `transition: all` retained only on small controls (large containers fixed); reduced-motion neutralizes them. Documented as an intentional, acceptable deviation.

## Spec Sync (OpenSpec main specs)
No prior main specs existed for these domains (only `.gitkeep`). Each delta spec is a full spec → copied directly to source-of-truth:
- `openspec/specs/track-metadata/spec.md` (6 requirements)
- `openspec/specs/lyrics/spec.md` (6 requirements)
- `openspec/specs/queue/spec.md` (6 requirements)
- `openspec/specs/player-animations/spec.md` (5 requirements)

Total 23 requirements now live in `openspec/specs/` as the source of truth.

## Files Changed (complete, across all PRs)
| File | PR(s) | Nature |
|------|-------|--------|
| `app.py` | 1, 2 | Metadata + lyrics routes, safe-path, caches |
| `cache.py` | 1 | `PathCache` (TTL + LRU) |
| `config.py` | 1, 2 | `metadataEnabled` / `lyricsEnabled` defaults + PUT |
| `lyrics.py` | 2 | LRCLIB proxy (new) |
| `metadata.py` | 1 | Mutagen metadata + fallback (new) |
| `requirements.txt` | 1 | `mutagen` |
| `requirements-dev.txt` | 1, 2 | test deps |
| `templates/index.html` | 2 | lyrics button |
| `static/app.js` | 1, 2, 3, 4 | fetchMetadata/fetchLyrics, playHistory, queue drawer, lyrics panel |
| `static/style.css` | 3, 4 | queue styles, animation refactor, color fixes |
| `tests/test_metadata.py` | 1 | filename fallback, untagged |
| `tests/test_metadata_route.py` | 1 | route + traversal + field contract |
| `tests/test_cache.py` | 1 | PathCache |
| `tests/test_lyrics.py` | 2 | LRCLIB mock, 429, instrumental |
| `tests/test_lyrics_route.py` | 2 | lyrics route + traversal |

## Verification Evidence (final)
- `.venv/bin/python -m pytest tests/ -q` → **27 passed** (exit 0).
- `node --check static/app.js` → JS OK.
- `python -c "import app"` → APP_IMPORT_OK.
- No coverage tool configured in repo.

## Remaining Manual Checks (user action)
PR3 and PR4 are **not yet rebuilt/verified in a browser**. The user must restart the server to load the new `static/app.js` / `static/style.css`, then confirm:
1. **Queue drawer**: 160px cover current card; blurred backdrop behind card; "Próximo" vs "Historial" sections; thumbnails for upcoming rows; history **empty** after page reload.
2. **Lyrics panel** (left side): synced LRC renders; active line highlights following `audio.currentTime`; click line seeks; instrumental indicator shown when flagged.
3. **Animations**: enable OS "reduce motion" → transitions/animations suppressed; no universal jank on sidebar/topbar/player-bar.
4. Confirm `.sidebar` no longer exhibits universal-transition jank (R19 fix).

## Recommendations for Future Work
1. **Lazy-eval regression test** (R3/S4): assert `list_files` does not invoke `get_metadata`/mutagen. Currently static-only verified.
2. **Frontend smoke tests** (jsdom/Playwright): convert the 7 MANUAL queue/lyrics scenarios to automated checks.
3. **Complete R21**: extend explicit transition props project-wide so `transition: all` is eliminated even on small controls (currently accepted deviation).
4. **Cover detection**: resolve the design open question — embedded APIC vs sidecar-only for `cover:true` (design assumed both).
5. **MAX_HISTORY=50**: confirm the cap is appropriate for real session lengths.

## Archive Traceability
- Engram spec `#69`, design `#70`, tasks `#71` (stale PR4 checkboxes), apply-progress `#72`, verify-report `#73`.
- OpenSpec archive: `openspec/changes/archive/2026-08-24-music-ui-enhancements/` (proposal, exploration, specs/, design, tasks, apply-progress, verify-report, archive-report).
- Source of truth specs: `openspec/specs/{track-metadata,lyrics,queue,player-animations}/spec.md`.

**SDD cycle complete.** Ready for the next change.
