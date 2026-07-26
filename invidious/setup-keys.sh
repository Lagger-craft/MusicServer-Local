#!/usr/bin/env bash
set -e

echo "Generando claves seguras para Invidious..."
HMAC_KEY=$(python3 -c "import secrets,string; print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(32)))")
COMPANION_KEY=$(python3 -c "import secrets,string; print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(16)))")

echo "=== NUEVAS CLAVES ==="
echo "HMAC_KEY:          $HMAC_KEY"
echo "COMPANION_KEY:     $COMPANION_KEY"
echo ""
echo "Actualizá docker-compose.yml:"
echo "  1. hmac_key: \"$HMAC_KEY\""
echo "  2. invidious_companion_key: \"$COMPANION_KEY\""
echo "  3. SERVER_SECRET_KEY=$COMPANION_KEY"
echo ""
echo "Luego: docker compose down invidious companion && docker compose up -d invidious companion"
