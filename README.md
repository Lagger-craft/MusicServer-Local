# Server Music Player

Reproductor de música, video y YouTube con interfaz web. Soporta archivos locales, Immich e Invidious.

## Docker (recomendado)

```bash
# 1. Crear archivo .env con las credenciales
cp .env.example .env
# Editar .env y generar keys nuevas:
#   openssl rand -hex 16

# 2. Levantar servicios
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
- 🎨 **Temas personalizables** — Claro, oscuro, Dracula, Catppuccin, y temas custom
- 📱 **Responsive**

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

### Autenticación y sesiones
- Contraseñas hasheadas con scrypt (werkzeug)
- Sesiones con timeout de inactividad (48h)
- Bloqueo de cuenta tras 5 intentos fallidos (15 min)
- Rate limiting en endpoints sensibles (SQLite-backed)
- `SESSION_COOKIE_SECURE` configurable via env var

### Protección de datos
- API keys de Immich y SID de Invidious encriptados con Fernet (AES-128-CBC)
- `config.json`, `playlists.json`, `.secret.key` en `.gitignore`
- Credenciales de Docker en `.env` (gitignored)

### Headers de seguridad
- `Content-Security-Policy` — Restricción de recursos externos
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — Camera, micrófono, geolocalización deshabilitados

### Protección CSRF
- Token CSRF generado por sesión
- Validado en todos los endpoints POST/PUT/DELETE
- Token inyectado automáticamente via header `X-CSRF-Token`

### Docker
- Contenedor corre como usuario no-root (`appuser`)
- `.dockerignore` excluye secretos y artefactos del build
- Entrypoint con gosu para permisos de volumen

### Endpoints
- SSRF guard en URL de Immich (bloquea metadata cloud)
- Directorios del sistema bloqueados como music dirs
- Errores sanitizados (detalles en logs, mensajes genéricos al cliente)

## Estructura del proyecto

```
app.py              — Flask server, rutas API, CSRF, security headers
auth.py             — Autenticación, usuarios, account lockout
cache.py            — Caché con TTL thread-safe
config.py           — Configuración, encriptación Fernet, migraciones
files.py            — Listado de archivos, file watcher, range requests
immich.py           — API Immich, compresión FFmpeg, SSRF guard
invidious.py        — API Invidious, feed, suscripciones
lyrics.py           — Letras sincronizadas (LRC), proxy LRCLIB
metadata.py         — Metadata de audio (mutagen)
playlists.py        — Manejo de playlists
ratelimit.py        — Rate limiting SQLite (fail-closed)
upload_queue.py     — Cola de subidas background
wsgi.py             — Entry point para gunicorn
entrypoint.sh       — Docker entrypoint (gosu, permisos de volumen)
Dockerfile          — Build del contenedor (non-root, gosu)
docker-compose.yml  — Servicios: music-server, invidious, postgres, companion
.env.example        — Template para credenciales de Docker
.dockerignore       — Exclusiones del build
static/app.js       — Lógica del cliente, CSRF interceptor
static/style.css    — Estilos (Firefox-compatible scrollbars)
templates/index.html — HTML principal
```
