# Server Music Player

Reproductor de música, video y YouTube con interfaz web. Soporta archivos locales, Immich e Invidious.

## Docker (recomendado)

```bash
docker compose up -d
```

Incluye servidor de música (5000) + Invidious (3000) + PostgreSQL.

Servidor en http://localhost:5000

## Manual

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp config.example.json config.json
python app.py
```

**Requisitos:** Python 3.10+, FFmpeg (para compresión de video).

## Características

### Reproducción
- 🎵 **Música local** — mp3, flac, wav, ogg, m4a, wma, opus
- 🎬 **Video local** — mp4, webm, mkv, avi, mov, flv
- 📷 **Immich** — Navegar álbumes, subir videos, renombrar assets
- ▶ **YouTube (vía Invidious)** — Buscar, ver tendencias, suscribirse a canales, feed

### Subida de videos a Immich
- 📤 **Cola de subidas** — Subir múltiples videos en background sin bloquear la UI
- 🗜 **Compresión H.265** — Opcional para archivos >10GB, reduce tamaño ~50%
- 📊 **Progreso en tiempo real** — Tray muestra estado: comprimiendo / subiendo / completado
- ❌ **Cancelación** — Cancelar trabajos pendientes desde el tray

### Organización
- 📋 **Playlists** — Mix de archivos locales + Immich + YouTube
- 🖱 **Menú contextual** — Click derecho para reproducir, cola, propiedades
- 🎨 **Tema claro/oscuro**
- 📱 **Responsive"

### Atajos de teclado
- `←` `→` — Retroceder / adelantar 5s
- `Space` — Pausa / reproducir
- `↑` `↓` — Subir / bajar volumen
- `F` — Pantalla completa (video)
- `M` — Silenciar
- `Esc` — Cerrar overlay

## Configuración inicial

1. Copiar `config.example.json` a `config.json`
2. Agregar carpetas de música desde la UI (sidebar → Agregar carpeta)
3. **(Opcional) Immich** — Click en 📷 Immich en sidebar, configurar URL + API Key
4. **(Opcional) YouTube** — Click en ▶ YouTube en sidebar

### Invidious + YouTube

El `docker-compose.yml` incluye Invidious con PostgreSQL. Primera vez:

```bash
# Crear una cuenta en Invidious
# Ir a http://localhost:3000 → Register
# Volver al music server → YouTube → Iniciar sesión
```

## Seguridad

- Autenticación por sesión con rate limiting (SQLite)
- `config.json` y `playlists.json` están en `.gitignore`
- API keys de Immich encriptadas con Fernet

## Estructura del proyecto

```
app.py              — Flask server, rutas API
auth.py             — Autenticación y usuarios
cache.py            — Caché con TTL thread-safe
config.py           — Manejo de configuración
files.py            — Listado de archivos y file watcher
immich.py           — API Immich, compresión FFmpeg
invidious.py        — API Invidious
playlists.py        — Manejo de playlists
ratelimit.py        — Rate limiting SQLite
upload_queue.py     — Cola de subidas background
static/app.js       — Lógica del cliente
static/style.css    — Estilos
templates/index.html — HTML principal
```
