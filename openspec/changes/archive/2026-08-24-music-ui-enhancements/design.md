# Design: Music UI Enhancements (Lyrics, Metadata, YT-Music Queue, Animations)

## Technical Approach

Add two backend helpers (`metadata.py`, `lyrics.py`) exposing lazy, cached routes in `app.py`, and rebuild the queue drawer + lyrics panel on the frontend. Metadata/lyrics are fetched on play/lyrics-open and feed `nowPlaying` + the YT-Music queue card (large cover, blur backdrop, session `playHistory`, thumbnails). Lyrics render synced LRC with active-line highlight driven by `audio.currentTime`. Delivered as 4 chained PRs ≤400 lines.

## Architecture Decisions

| Decision | Option | Tradeoff | Choice |
|---|---|---|---|
| Cache for per-path data | Reuse `ThreadSafeCache` (single value) | Cannot key by path | **New `PathCache`** (dict + lock + per-entry TTL + LRU cap) in `cache.py` |
| Cover field shape | URL / path / boolean | URL duplicates `/api/cover`; path redundant | **Boolean** (`cover:true`); URL built client-side as today |
| Config flags default | off / on | off hides features needlessly | **On** (`metadataEnabled`,`lyricsEnabled=true`) |
| playHistory | persist / session array / Map | persist violates spec isolation | **In-memory array, MAX 50, session-only** |
| LRCLIB cache | no cache / TTL+cap | no cache hits rate-limit | **TTL 7d, LRU 500**; metadata **TTL 24h, LRU 500** |
| Path safety | trust param / validate | traversal risk | **resolve_path + is_safe_path**, 4xx on fail (mirrors `/api/cover`) |

## Data Flow

```
playTrack() ──GET /api/metadata?path=──► app.py ──► metadata.py ──► mutagen + filename parse
      │                                        └─► PathCache(metadata_cache)
      ├─► updates nowPlaying (title/artist/cover) + queue card
      │
lyricsOpen/play ──GET /api/lyrics?path=──► app.py ──► lyrics.py ──► LRCLIB (requests, Retry-After)
      │                                          └─► PathCache(lyrics_cache)
      └─► lyrics panel: parse LRC ──timeupdate──► highlight active line
queueSwitch ──► outgoing track unshifted to playHistory ──► blur backdrop from cover
```

## File Changes

| File | Action | Description |
|---|---|---|
| `metadata.py` | Create | `get_metadata(path)` → mutagen tags (artist/title/album/duration), embedded APIC or sidecar `.png` → `cover:bool`, filename fallback `Artist - Title (- Album)` |
| `lyrics.py` | Create | `get_lyrics(path,meta)` → LRCLIB GET, honor `Retry-After`, return `{plainLyrics,syncedLyrics,instrumental}` |
| `cache.py` | Modify | Add `PathCache(ttl,max_entries)`: `get(key)/set(key,val)/invalidate` with LRU eviction |
| `app.py` | Modify | Routes `/api/metadata`, `/api/lyrics` (login_required, limit, resolve_path+is_safe_path) |
| `config.py` | Modify | Add `metadataEnabled`,`lyricsEnabled` defaults; PUT handler accepts them |
| `requirements.txt` | Modify | Add `mutagen` |
| `static/app.js` | Modify | `fetchMetadata`, `fetchLyrics`, `renderQueueDrawer` rewrite, `playHistory`, lyrics panel + LRC highlight |
| `static/style.css` | Modify | Queue card/blur/thumbnails, lyrics panel, animation refactor |
| `templates/index.html` | Modify | Lyrics toggle button |

## Interfaces / Contracts

```python
# GET /api/metadata?path=<enc>  -> 200 {artist,title,album,duration,cover,path}
#                                   4xx on unknown/invalid path
# GET /api/lyrics?path=<enc>    -> 200 {plainLyrics, syncedLyrics, instrumental}
#                                   empty strings on no match; 4xx on invalid path

# cache.py
class PathCache:
    def __init__(self, ttl=86400, max_entries=500): ...
    def get(self, key): ...        # returns val if fresh else None
    def set(self, key, val): ...   # evicts LRU beyond max_entries
```

Frontend LRC highlight (non-obvious):
```js
function renderLyricsLRC(synced) {
  const lines = parseLRC(synced); // [{t:sec, text}]
  audio.ontimeupdate = () => {
    const i = lines.filter(l => l.t <= audio.currentTime).length - 1;
    highlightLine(i);
  };
}
```

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | `parseLRC`, filename fallback regex, `PathCache` TTL/LRU | Pure functions, no server |
| Integration | `/api/metadata` tagged+untagged, `/api/lyrics` mock LRCLIB (responses + 429 Retry-After) | `requests` mock; assert contract + graceful empty |
| E2E | Queue card+blur+history render, lyrics active-line sync | Manual via running server (no suite exists) |

## Threat Matrix

- **Routing (user path param)**: Applicable. Every `/api/metadata`,`/api/lyrics` request MUST pass `resolve_path()` + `is_safe_path()`; invalid → 4xx (spec R:Unknown Path). RED: `?path=../../etc/passwd` → 4xx.
- **Shell / Subprocess / Executable-classification / VCS-PR / Process-integration**: N/A — mutagen is pure-Python read; LRCLIB is outbound HTTP via `requests` (same pattern as Invidious routes), governed by timeout=15 + Retry-After, no process spawn.

## Migration / Rollout

Additive, no DB. New config keys default on; absent key → treated as enabled. Rollback = file revert + drop mutagen.

## Open Questions

- [ ] Embedded-cover (mutagen APIC) vs sidecar-only for `cover:true` — design assumes both; confirm with user.
- [ ] `MAX_HISTORY=50` acceptable cap?
