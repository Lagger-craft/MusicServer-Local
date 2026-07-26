# Server Music Player 🎵

Reproductor de música y video con interfaz web. Soporta archivos locales e integración con Immich.

## Docker (recomendado)

```bash
docker compose up -d
```

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

- 🎵 Reproduce audio (mp3, flac, wav, ogg, m4a, wma, opus)
- 🎬 Reproduce video (mp4, webm, mkv, avi, mov, flv)
- 📷 Integración con Immich (navegar álbumes, reproducir videos)
- 📋 Playlists con mix de archivos locales + videos de Immich
- 🎨 Tema claro/oscuro
- 📱 Responsive
- ⌨ Atajos de teclado (← → seek, Space play/pause, ↑ ↓ volumen, F fullscreen)

## Configuración inicial

1. Copiar `config.example.json` a `config.json`
2. Agregar carpetas de música desde la UI
3. (Opcional) Configurar Immich desde la UI

## Seguridad

`config.json` y `playlists.json` contienen datos locales (rutas, API keys). Están en `.gitignore` — no se suben al repositorio. Usar `config.example.json` como plantilla.
