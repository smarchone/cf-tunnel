#!/usr/bin/env bash
# Go AFK for everyone: stop the registrar, clear the URL in KV, stop the stack.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

docker compose stop registrar >/dev/null 2>&1 || true
if curl -fsS --max-time 10 -X DELETE -H "authorization: Bearer $REGISTER_KEY" \
     "$WORKER_URL/__tunnel" >/dev/null; then
  echo "✓ Cleared tunnel URL — AFK for everyone"
else
  echo "! Couldn't reach the Worker — friends will still see AFK after login" >&2
fi
docker compose down
