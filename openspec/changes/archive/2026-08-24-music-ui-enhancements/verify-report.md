```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:a716d4ff6617021a90335d065c89e74526807ddc509bd4de13afbc68fbdf27bb
verdict: fail
blockers: 0
critical_findings: 0
requirements: 15/23
scenarios: 17/26
test_command: .venv/bin/python -m pytest tests/ -q
test_exit_code: 0
test_output_hash: sha256:938547f7dcf9287cc98c488140f33de93e751efa6f6ed37d0210701baa8c92c2
build_command: node --check static/app.js
build_exit_code: 0
build_output_hash: sha256:cb5bbc09ee6cfa19f42a617de658151521bb40c1007e252da3f72c2bf68e47f5
```

# Verification Report — music-ui-enhancements

## Change
`music-ui-enhancements` (4 chained PRs: PR1 metadata, PR2 lyrics, PR3 queue UI, PR4 lyrics UI + animations + queue color fixes)

## Mode / Context
- Persistence mode: **both** (OpenSpec file + Engram)
- Delivery: 4 chained PRs, stacked-to-main, ask-on-risk
- TDD mode: **Standard** (`apply.tdd=false`); pytest bootstrapped in PR1
- Verifier: `sdd-verify` executor (final independent verification)
- Artifacts read: specs (Engram #69), design (#70), tasks (#71), apply-progress (#72), plus source inspection of working tree

## Completeness
| Dimension | Status | Note |
|---|---|---|
| Tasks | **17/17 complete** | Per apply-progress (#72). NOTE: tasks.md (#71) is STALE — shows PR4 4.1–4.3 unchecked; superseded by apply-progress + source evidence. |
| Proposal | present | `openspec/changes/music-ui-enhancements/proposal.md` |
| Spec | present | 23 requirements, 26 scenarios (Engram #69) |
| Design | present | (#70) — 7 deviations documented |
| Apply-progress | present | (#72) — 17/17, evidence recorded |

## Build / Test / Coverage Evidence
| Command | Exit | Output hash (sha256) | Result |
|---|---|---|---|
| `.venv/bin/python -m pytest tests/ -q` | 0 | `938547f7dcf9287cc98c488140f33de93e751efa6f6ed37d0210701baa8c92c2` | **27 passed** |
| `node --check static/app.js` | 0 | `cb5bbc09ee6cfa19f42a617de658151521bb40c1007e252da3f72c2bf68e47f5` | JS_OK |
| `.venv/bin/python -c "import app"` | 0 | `5b420b4a29b0e092aad05aa1401f21e3b59d8fe2ae88c72526daf5ae30a4f76b` | APP_IMPORT_OK |

Coverage: no coverage tool configured in repo; 27 backend tests pass (14 scenario-backed + cache/route tests).

## Spec Compliance Matrix — Requirements (23)
| # | Domain | Requirement | Status | Evidence |
|---|---|---|---|---|
| 1 | track-metadata | Metadata Endpoint | PASS | `app.py:266` route; `test_metadata_route.py::test_untagged_returns_200_fallback` |
| 2 | track-metadata | Filename Fallback | PASS | `metadata.py:parse_filename`; `test_metadata.py::test_parse_filename_no_separator` |
| 3 | track-metadata | Lazy Evaluation (MUST NOT in list_files) | PASS (static) | grep: `get_metadata`/`mutagen` only at `app.py:291,332` (route handlers), never in `list_files`/`files.py`. **No automated regression test** — see SUGGESTION. |
| 4 | track-metadata | Server-Side Cache | PASS | `PathCache` `metadata_cache` `app.py:263`; `test_cache.py` + route repeat |
| 5 | track-metadata | Unknown Path (4xx) | PASS | `test_metadata_route.py::test_traversal_returns_403`, `::test_missing_returns_404` |
| 6 | track-metadata | Field Contract | PASS | `test_metadata_route.py` asserts keys ≥ {artist,title,album,duration,cover,path} |
| 7 | lyrics | Lyrics Endpoint | PASS | `test_lyrics.py::test_lyrics_success_returns_both_fields`, `test_lyrics_route.py::test_lyrics_success_mocked_lrclib` |
| 8 | lyrics | LRCLIB Proxy | PASS | `lyrics.py:76`; params `artist_name`/`track_name` asserted in `test_lyrics_success_returns_both_fields` |
| 9 | lyrics | Synced Support | PASS | `syncedLyrics` passed through unchanged (`test_lyrics_success_returns_both_fields`) |
| 10 | lyrics | Server Cache | PASS | `lyrics_cache` `app.py:301`; route repeat in `test_lyrics_route.py` |
| 11 | lyrics | Rate-Limit (Retry-After) | PASS | `test_lyrics.py::test_lyrics_429_retry_after_backoff` |
| 12 | lyrics | Instrumental | PASS | `test_lyrics.py::test_lyrics_instrumental_flag_no_body` |
| 13 | queue | Current Card | MANUAL | `renderQueueDrawer` `.queue-current-card`/`queue-current-cover` (`app.js:2675`). Needs browser. |
| 14 | queue | Blurred Backdrop | MANUAL | `.queue-backdrop{filter:var(--queue-filter)}` (`style.css:1586`). Needs browser. |
| 15 | queue | Session History (push before switch) | MANUAL | `pushHistory` `app.js:406`, called `app.js:417` before switch; `MAX_HISTORY=50` (`app.js:402`). |
| 16 | queue | History Isolation (not persisted) | PASS (static) | `playHistory` never written to `localStorage` (comment `app.js:399`; grep shows no history persist). |
| 17 | queue | Sectioned Queue (Próximo / Historial) | MANUAL | `app.js:2590` Próximo, `app.js:2612` Historial. Needs browser. |
| 18 | queue | Upcoming Thumbnails | MANUAL | `queue-item-thumb` bg url when cover (`app.js:2600,2618`). Needs browser. |
| 19 | player-animations | No Universal Transitions (MUST NOT on large containers) | **PARTIAL** | `.topbar`/`.player-bar` fixed (grep: NONE). BUT `.sidebar` still `transition: all 0.4s` (`style.css:280`) — a large container. Violates MUST NOT. |
| 20 | player-animations | Remove Perpetual Pulse | PASS | No `pulse-glow`/`@keyframes pulse`; only `bounce`/`spin` infinite (`style.css:1086,2342`). |
| 21 | player-animations | Explicit Transitions (SHOULD) | **PARTIAL** | `will-change: transform` only on `.lyrics-drawer` (`style.css:2679`). `transition: all` retained broadly (documented deviation: small controls). Explicit props not adopted. |
| 22 | player-animations | Reduced Motion (MUST) | PASS | `@media (prefers-reduced-motion: reduce)` neutralizes anim/transition (`style.css:2773`). |
| 23 | player-animations | Limit Backdrop (SHOULD) | PASS | `backdrop-filter` only at lyrics panel (`style.css:2672-2673`); queue uses `filter` not `backdrop-filter`. |

**Summary**: PASS=15, PARTIAL=2 (req 19, 21), MANUAL=6 (req 13–18).

## Spec Compliance Matrix — Scenarios (26)
| Domain | Scenarios | Status |
|---|---|---|
| track-metadata (7) | tagged→200; untagged→200 fallback; filename no-sep; listing no mutagen; cached; 4xx unknown; field keys | 7 PASS (lazy-eval static-verified) |
| lyrics (7) | both fields; no-match 200 empty; LRCLIB fields; synced passthrough; cached; 429 backoff; instrumental | 7 PASS |
| queue (7) | current card; blur; push-before-switch; first-switch one; isolation; sectioned; thumbnails | 7 MANUAL (code present, browser pending) |
| player-animations (5) | no universal transition; no pulse; explicit; reduced-motion; limit backdrop | 3 PASS, 2 PARTIAL (S22, S24) |

**Summary**: PASS=17, PARTIAL=2, MANUAL=7.

## Correctness / Design Coherence
| Design decision | Implemented | Coherence |
|---|---|---|
| `PathCache` (TTL+LRU) for per-path caches | Yes (`cache.py`) | Aligned |
| `cover:bool` (client builds URL) | Yes | Aligned |
| Config flags default ON | Yes (`config.py`) | Aligned |
| `playHistory` in-memory MAX 50, session-only | Yes (`app.js:402,406`) | Aligned |
| LRCLIB cache TTL 7d / metadata 24h, LRU 500 | Yes | Aligned |
| resolve_path + is_safe_path, 4xx (mirrors /api/cover) | Yes (403/404 tests) | Aligned |
| Deviation: `toggleLyrics` opens panel | Yes | Completes design intent |
| Deviation: `backdrop-filter` removed from topbar/content/player/modals; only lyrics panel | Yes (grep confirms) | Stricter than "queue+panel" but matches "limit to intentional surfaces" |
| Deviation: `transition: all` kept on small controls | Partial — `.sidebar` (large) still has it | **See req 19** |
| Deviation: queue color fixes (z-index, theme-aware scrim, stray `}`) | Yes | Fixes real defects |

## Issues
### CRITICAL
- None.

### WARNING
1. **R19 No Universal Transitions (MUST)**: `.sidebar` (`style.css:280`) still uses `transition: all 0.4s`. A large container with universal transition re-introduces the exact jank the requirement forbids (only `.topbar`/`.player-bar` were fixed). Recommend scoping to explicit properties or removing.
2. **Stale tasks artifact (#71)**: PR4 tasks 4.1–4.3 marked `[ ]` though apply-progress (#72) and source confirm completion. Update `tasks.md` to avoid confusion at archive.
3. **R21 Explicit Transitions (SHOULD)**: explicit transition properties not broadly adopted; `will-change` only on lyrics panel. Acceptable per documented deviation but noted.

### SUGGESTION
1. Add a regression test for Lazy Evaluation (R3/S4): assert file listing does not invoke `get_metadata`/mutagen. Currently static-only.
2. Add a lightweight DOM smoke test (jsdom/Playwright) for the 7 queue/lyrics scenarios to convert MANUAL→automated.
3. Extend animation refactor to `.sidebar` and adopt explicit transition props project-wide to fully satisfy R19/R21.

## Manual Checks (browser, after rebuild)
PR3/PR4 are not yet rebuilt — user must restart the server (`docker compose up music-server` or `python app.py`) to load the new `app.js`/`style.css`.
- **Queue drawer**: large 160px cover current card; blurred backdrop behind card; "Próximo" vs "Historial" sections; thumbnails for upcoming rows; history EMPTY after page reload.
- **Lyrics panel** (left side): synced LRC renders; active line highlights following `audio.currentTime` (timeupdate); click line seeks; instrumental indicator shows when flagged.
- **Animations**: enable OS "reduce motion" → transitions/animations suppressed; no universal jank on sidebar/topbar/player-bar.

## Final Verdict
**PASS WITH WARNINGS** (maps to user enum: **PARTIAL** — 2 requirements partial + 6 require pending browser verification).

All 27 backend tests pass; all 23 requirements are implemented in source; 17 scenarios have runtime test evidence, 2 animation scenarios are partial, 7 frontend scenarios need manual browser confirmation. No CRITICAL blockers.
