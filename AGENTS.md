# AGENTS.md

## Setup

### Docker (recommended)

```bash
docker compose up -d
```

Incluye servidor de música (puerto 5000) + Invidious (puerto 3000) + PostgreSQL.

### Manual

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp config.example.json config.json
python app.py
```

## Run

### Docker (todo incluido)

```bash
docker compose up -d
```

### Solo el servidor de música (sin Invidious)

```bash
docker compose up music-server -d
```

### Manual

```bash
python app.py
```

Server starts on http://localhost:5000 with debug mode enabled.

## Critical gotchas

- **Music dir**: Configurable from the UI. Stored as `music_dirs` array in `config.json`. Default is `./music`. Can add multiple directories.
- **File paths**: Now prefixed with `{key}/` (e.g., `main/song.opus`) to support multiple directories. `resolve_path()` in `app.py` parses the prefix.
- **Media serving**: Both audio and video served via `/media/<path>` (replaces old `/music/`).
- **Cover art**: Must be `.png` files with the exact same basename as the media file (e.g., `song.mp3` → `song.png`), placed in the same directory.
- **Config files**: `config.json` and `playlists.json` are created/modified at runtime. Don't commit secrets or sensitive data to these.
- **Immich integration**: URL + API key stored in `config.json` under `immich_url` / `immich_api_key`. Videos proxied via `/api/immich/media/<asset-id>` (handles Range requests for seeking). Playlist songs can be `{type: "immich", assetId, originalName}` — normalized on read.
- **Playlist model**: Songs are stored as either strings (local, backward compat) or objects `{type, assetId, originalName}` (Immich). API normalizes all responses so frontend always sees `{type, path/assetId, name}`.

## Testing

No test suite exists. Verify changes manually by running the server.

## Project structure

- `app.py` — Flask server, all API routes, file serving, Immich proxy
- `templates/index.html` — HTML skeleton with Immich config/browser modals
- `static/style.css` — All styles (CSS custom properties for theming)
- `static/app.js` — All client logic (player, queue, playlists, theme toggle, Immich browser)
- `static/index.html` — Static fallback (not used by the app)
- `music/` — Audio files (mp3, flac, wav, ogg, m4a, wma, opus)
- `add_music.sh` — Helper to create subdirectories in `music/`
- `config.json` — Runtime config (volume, shuffle, repeat)
- `playlists.json` — Runtime playlists data

## UI architecture

- **Theming**: CSS custom properties on `:root[data-theme="light"/"dark"]`. Toggle via button in topbar, persisted in `localStorage`.
- **Views**: List and Grid toggle buttons in topbar. Filter tracks via search box.
- **Queue**: Icon `☰` button in bottom-right of player bar. Drawer slides in from the right. Tracks added via "⬇ Cola" button on hover. Queue auto-plays next on track end or "next" button.
- **Player**: Uses `<audio>` element (HTML5). No mpv dependency in the frontend.
- **Cover art**: `.png` files with matching basename in same directory as audio.
- **Responsive**: Sidebar hidden ≤600px, single-column player bar ≤768px, grid collapses to 2 columns ≤400px.
