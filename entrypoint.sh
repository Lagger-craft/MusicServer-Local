#!/bin/sh
# Fix permissions for lyrics directory (volume mount from host)
if [ -d /lyrics ]; then
    chown -R appuser:appuser /lyrics 2>/dev/null || true
fi
exec gosu appuser "$@"
