# Server Music Player 🎵

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

## Características

- 🎵 **Música local** — mp3, flac, wav, ogg, m4a, wma, opus
- 🎬 **Video local** — mp4, webm, mkv, avi, mov, flv
- 📷 **Immich** — Navegar álbumes, reproducir videos con proxy
- ▶ **YouTube (vía Invidious)** — Buscar, ver tendencias, subscribirse a canales, feed de suscripciones
- 📋 **Playlists** — Mix de archivos locales + Immich + YouTube
- 🖱 **Menú contextual** — Click derecho en cualquier track para reproducir, cola, propiedades
- 🎨 **Tema claro/oscuro**
- 📱 **Responsive**
- ⌨ **Atajos de teclado**:
  - `←` `→` — Retroceder / adelantar 5s
  - `Space` — Pausa / reproducir
  - `↑` `↓` — Subir / bajar volumen
  - `F` — Pantalla completa (video)
  - `M` — Silenciar
  - `Esc` — Cerrar overlay de YouTube

## Configuración inicial

1. Copiar `config.example.json` a `config.json`
2. Agregar carpetas de música desde la UI (sidebar → Agregar carpeta)
3. **(Opcional) Immich** — Click en 📷 Immich en sidebar, configurar URL + API Key
4. **(Opcional) YouTube** — Click en ▶ YouTube en sidebar. Buscar videos o iniciar sesión en Invidious para suscripciones

### Invidious + YouTube

El `docker-compose.yml` incluye Invidious con PostgreSQL. Primera vez:

```bash
# Crear una cuenta en Invidious
# Ir a http://localhost:3000 → Register
# Volver al music server → YouTube → Iniciar sesión
```

## Seguridad

`config.json` y `playlists.json` contienen datos locales (rutas, API keys de Immich, sesión de Invidious). Están en `.gitignore` — no se suben al repositorio. Usar `config.example.json` como plantilla.
