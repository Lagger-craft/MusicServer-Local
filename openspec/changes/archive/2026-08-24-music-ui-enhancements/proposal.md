# Proposal: Music UI Enhancements (Lyrics, Metadata, YT-Music Queue, Animations)

## Intent
Player shows filenames only (no artist/title/album/duration) and lacks lyrics + modern queue UX. Add lazy metadata (mutagen), LRCLIB lyrics proxy, YT-Music queue, animation fixes. No scraping/keys.

## Scope
### In Scope
- `GET /api/metadata?path=` — mutagen tags, lazy, filename fallback
- `GET /api/lyrics?path=` — LRCLIB proxy (plain + synced LRC), cache, Retry-After
- YT-Music queue: current card, blur backdrop, history, thumbnails
- Lyrics panel rendering synced LRC with active-line highlight
- Animation refactor: explicit transitions, no box-shadow pulse, `will-change`, reduced-motion
- `requirements.txt` + mutagen; `config.json` flags

### Out of Scope
- Scan-time metadata enrichment (kept lazy)
- Non-LRCLIB lyrics providers; persisted history; backend tests

## Capabilities
### New Capabilities
- `track-metadata`: lazy metadata via mutagen + fallback
- `lyrics`: synced/plain lyrics via LRCLIB proxy + cache
- `queue`: YT-Music-style queue — current card, blur, history, thumbnails
- `player-animations`: performant animations, reduced-motion

### Modified Capabilities
- None (no existing specs)

## Approach
New `metadata.py` + `lyrics.py`; routes in `app.py` using `ThreadSafeCache` + `requests`. `app.js` rebuilds `renderQueueDrawer`, adds `playHistory` + lyrics panel; `style.css` redesigns + refactors. Metadata on play/lyrics-open feeds queue + lyrics.

## Data Flow
1. Play → `GET /api/metadata` → tags/fallback → updates nowPlaying + cards.
2. Lyrics → `GET /api/lyrics` → LRCLIB (from metadata) → cache → LRC → active-line highlight by `currentTime`.
3. Queue switch → push to `playHistory` → blur backdrop from cover.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `app.py` | Modified | New routes |
| `metadata.py`, `lyrics.py` | New | Helpers |
| `cache.py` | Reused | ThreadSafeCache |
| `static/app.js` | Modified | Queue, history, lyrics |
| `static/style.css` | Modified | Queue/lyrics, animations |
| `templates/index.html` | Modified | Lyrics button |
| `requirements.txt` | Modified | mutagen |

## Risks
| Risk | Likelihood | Mitigation |
| LRCLIB limits | Med | Cache + empty state |
| Low hit rate | Med | Metadata + filename fallback |
| >400-line budget | High | Chained PRs (ask-on-risk) |
| mutagen dep | Low | Lazy pure-read |

## Rollback Plan
Remove routes + helpers; revert `app.js`, `style.css`, `index.html`; drop mutagen. Additive, no DB — file checkout reverts.

## Dependencies
LRCLIB (no key); mutagen; existing `requests`, `ThreadSafeCache`.

## Success Criteria
- [ ] `/api/metadata` returns tags or fallback per path
- [ ] `/api/lyrics` returns cached synced+plain LRC, degrades gracefully
- [ ] Queue shows current card + blur + history + thumbnails
- [ ] Lyrics panel highlights active synced line
- [ ] No `transition: all`; pulse removed; reduced-motion honored
- [ ] Split into chained PRs ≤400 lines each
