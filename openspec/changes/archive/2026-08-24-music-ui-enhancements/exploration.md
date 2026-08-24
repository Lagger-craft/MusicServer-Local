# Exploration: Music UI Enhancements (Lyrics, YouTube-Music-style Queue, Animation Optimization)

## Current State

**Backend (Flask monolith, `app.py` + helper modules)**
- No lyrics endpoint and no metadata/tag-extraction endpoint exist today.
- Outbound HTTP is already used (`requests`) for Invidious and Immich proxying, so a server-side lyrics proxy is a natural fit.
- A reusable in-memory `ThreadSafeCache(ttl, name)` (`cache.py`) exists and can back a lyrics cache; config is persisted to `config.json` via `config.py`.
- All routes are registered in `app.py`; auth is `@login_required`, rate limiting is `@limit(...)`.

**Track data model (`/api/files` → `list_files()` in `files.py`)**
- Each track is `{ name, path, cover, type, mtime }`. There is **no** `artist`, `title`, `album`, or `duration` field.
- `cleanName()` only strips the extension and turns `_` into spaces. `nowPlayingArtist` is literally set to `track.path` (the file path), not a real artist.
- Cover art is the `{basename}.png` convention next to the media file (see `getCoverUrl()`).

**Queue (frontend, `static/app.js`)**
- `playQueue` is an array of `{ path, track }`. `renderQueueDrawer()` builds a 380px right-side drawer; `renderQueueContent()` renders only an "A continuación" (up next) list.
- There is **no** current-track highlight and **no** playback history. The drawer background is a solid `var(--bg-overlay)` (no blur/transparency).
- Playback entry points that would feed a history array: `playTrack()`, `playTrackDirect()`, `playFromQueue()`, `playNextInSequence()`.

**Animations (`static/style.css`)**
- Many `transition: all 0.4s var(--animation-smooth)` on large containers (body L93, topbar L162, sidebar L281, player-bar L861) — `transition: all` triggers style/layout recalc on every property change and is the main jank source.
- Two perpetual animations: `pulse-glow` (box-shadow) on `.logo-icon` (L176) and `bounce` (L1089). `pulse-glow` animates `box-shadow`, which is **not GPU-composited** → continuous repaints.
- Multiple `backdrop-filter: blur()` (topbar L161, player-bar L860) are costly when stacked.
- No `will-change` hints and no `prefers-reduced-motion` guard exist.

## Affected Areas

- `app.py` — register new routes (`/api/lyrics`, `/api/metadata`) and `@limit`/`@login_required`.
- `static/app.js` — add lyrics panel + fetch logic; rebuild `renderQueueDrawer`/`renderQueueContent` for YT-Music layout; add `playHistory` array populated in playback functions; wire metadata fetch for now-playing/lyrics.
- `static/style.css` — YT-Music queue styles (current card + blurred backdrop), lyrics panel styles, animation refactor.
- `templates/index.html` — add lyrics button to player bar (near `queueBtn`); add lyrics panel container.
- `requirements.txt` — add `mutagen` for tag extraction.
- `new lyrics.py` — LRCLIB proxy + caching + optional provider fallback.
- `new metadata.py` — mutagen-based tag reader with filename fallback.
- `config.json` / `config.py` — optional `lyrics_enabled` / provider flags; Genius token only if that provider is ever used (encrypted).

## Approaches (lyrics integration)

1. **LRCLIB proxy (RECOMMENDED)** — `GET /api/lyrics?artist=&title=&album=&duration=`
   - Pros: Free, **no API key**, returns both `plainLyrics` and `syncedLyrics` (LRC) plus `artistName`/`trackName`/`albumName`/`duration`/`instrumental`. Open/free library explicitly built for music players. Server-side caching avoids rate-limit pressure (429 + Retry-After handled).
   - Cons: Requires reasonably correct `artist` + `title`; matching also benefits from `duration` (±2s), so real metadata helps hit rate.
   - Effort: Low (backend ~80–120 LOC + frontend panel ~150 LOC).

2. **Genius API + scraping (NOT recommended as primary)**
   - Pros: Huge catalog; good for metadata/cover-art enrichment.
   - Cons: API returns **only metadata + a song-page URL**; raw lyrics must be **scraped from HTML, which violates Genius ToS** (legal agreements with publishers; they litigated over lyrics reuse). High legal risk; brittle.
   - Effort: Medium, with unacceptable legal exposure for lyrics.

3. **AZLyrics / similar scraping (NOT recommended)**
   - Pros: Simple HTML parse.
   - Cons: ToS violation, structure changes break scrapers, no synced lyrics, copyright risk.
   - Effort: Low but legally unsound.

**Recommendation:** LRCLIB as the sole lyrics source. If the user specifically wants "Genius", use the Genius *metadata* API only (search/lookup to improve artist/title normalization and cover art) — never scrape its lyrics.

## Metadata extraction (task #4) — decision

Real tag extraction is **recommended and should be done**, because:
- Lyrics lookup quality depends almost entirely on correct `artist` + `title`.
- It improves the whole UI (now-playing shows a real artist, queue shows artist, search/sort improve).
- It can surface embedded cover art as an alternative to the `{basename}.png` convention.

Approach: add `mutagen` (ID3 for mp3, Vorbis comments for flac/ogg/opus, MP4 for m4a). Expose `GET /api/metadata?path=` that reads tags lazily (on play / on lyrics open) with filename fallback (`"Artist - Title"`). **Do NOT** enrich `list_files()` at scan time (per-file tag reads are expensive and would slow the existing cached listing); keep listing lean and fetch metadata on demand. Duration is obtainable cheaply via mutagen without full decode.

## Queue redesign (YouTube-Music style)

- **Current track card:** large cover (160–200px), title, artist; the cover image is also rendered as a blurred, low-opacity backdrop behind the panel (absolutely-positioned `<img>` + `backdrop-filter: blur()`), replacing the solid `var(--bg-overlay)`.
- **"Próximo" (up next):** reuse existing `playQueue`.
- **"Historial" (history):** new frontend `playHistory` array, populated by pushing the *current* track before each switch in `playTrack`/`playTrackDirect`/`playFromQueue`/`playNextInSequence`. Clicking a history item replays it. History is session-only (not persisted).
- This is **frontend-only**; no backend change required for the queue UI itself, but its quality depends on metadata (#4) for artist display and on cover availability.

## Animation optimizations (task #2)

- Replace `transition: all` with explicit properties (`background-color`, `color`, `transform`, `border-color`, `box-shadow`) on body/topbar/sidebar/player-bar.
- Convert `pulse-glow` away from perpetual `box-shadow` animation (use a static glow + hover `transform`, or `opacity` pulse) to avoid per-frame repaints.
- Add `will-change: transform` to `.queue-drawer`, `.queue-item`, modals; add a `@media (prefers-reduced-motion: reduce)` block disabling non-essential animations.
- Limit `backdrop-filter` to a single element where possible.
- Risk: Low (CSS-only, mostly). Effort: Low–Medium.

## Recommendation

Proceed as **three linked changes** sharing one metadata foundation:
1. **Metadata extraction** (`mutagen` + `/api/metadata`) — foundation for the other two.
2. **Lyrics panel** via LRCLIB proxy (depends on #1 for artist/title)
3. **YouTube-Music queue** + **animation optimization** (can be one UI change; depends on #1 for artist display)

## Risks

- **Legal:** Lyrics are copyrighted. LRCLIB is the lowest-risk source (free/open, intended for players) but caching/serving should stay personal/authenticated. Avoid Genius/AZLyrics scraping. *(Low–Medium risk, mitigable.)*
- **Lyrics hit rate:** Without correct artist/title, LRCLIB returns 404. Mitigated by metadata extraction (#4) + filename fallback + fuzzy search endpoint (`/api/search`).
- **External dependency / rate limits:** LRCLIB is rate-limited (429 + Retry-After). Mitigated by server-side caching (prefer a small **disk-backed** cache so restarts don't refetch) and respecting Retry-After.
- **Performance:** Per-file tag reading at scan time would slow `list_files()`; keep metadata lazy/on-demand (mitigated by design above).
- **Review budget:** This bundle will almost certainly exceed the **400-line** review budget (backend + ~300 LOC frontend + CSS). Plan **chained PRs** (metadata → lyrics → queue/animations) under `ask-on-risk`.
- **mutagen dependency:** New third-party dep; adds to Docker image. Low risk, well-maintained.

## Ready for Proposal

**Yes** — exploration is sufficient to write a proposal. Before proposing, the orchestrator should confirm with the user:
1. Lyrics source preference — default **LRCLIB**; is "Genius" only wanted for metadata/cover enrichment (not lyrics scraping)?
2. Should metadata extraction be enabled by default (adds `mutagen` dep)? Recommend **yes**.
3. Queue history: session-only (recommended) vs persisted to `config.json`?
