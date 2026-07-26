#!/bin/bash

# Add music files to the playlist
MUSIC_DIR="/home/lagger/repos/server-music/music"

if [ -z "$1" ]; then
    echo "Uso: $0 <carpeta_de_musica>"
    exit 1
fi

# Create directory if it doesn't exist
mkdir -p "$MUSIC_DIR/$1"

echo "Archivos añadidos a: $MUSIC_DIR/$1"
ls -la "$MUSIC_DIR/$1"