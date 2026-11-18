#!/usr/bin/env bash
# Online while this runs; AFK when it stops.
#   startup:  docker compose up -d, wait for the quick-tunnel URL, write it to KV
#   running:  every INTERVAL s, re-read the URL; write KV only when it changes
#   teardown: Ctrl-C / SIGTERM / SIGHUP → clear KV (AFK for everyone), docker compose down
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ -f .env ]] || { echo "Missing .env — run ./scripts/init-env.sh" >&2; exit 1; }

INTERVAL=${INTERVAL:-30}
METRICS=${METRICS:-http://127.0.0.1:2000}
WRANGLER=(npx -y wrangler@4.164.0)
last=""

log() { echo "$(date +%T) $*"; }
kv()  { (cd "$ROOT/worker" && "${WRANGLER[@]}" kv key "$@" --binding TUNNEL --remote >/dev/null 2>&1); }

teardown() {
  trap '' INT TERM HUP
  log "going AFK — clearing tunnel URL (~5s, extra Ctrl-C is ignored)…"
  # Run the delete in its own process group (set -m): the terminal sends Ctrl-C to the whole
  # foreground group, and node/wrangler doesn't honour an inherited ignore, so a second Ctrl-C
  # used to kill the delete mid-flight.
  set -m; kv delete tunnel_url & local pid=$!; set +m
  if wait "$pid"; then log "✓ cleared tunnel URL — AFK for everyone"
  else log "! couldn't clear tunnel URL — friends will still see AFK after login" >&2; fi
  docker compose down
  exit 0
}
trap teardown INT TERM HUP

docker compose up -d || { echo "docker compose up failed" >&2; exit 1; }
log "online loop: checking $METRICS/quicktunnel every ${INTERVAL}s (Ctrl-C to go AFK)"

while true; do
  host=$(curl -fsS --max-time 5 "$METRICS/quicktunnel" 2>/dev/null \
    | sed -n 's/.*"hostname" *: *"\([^"]*\)".*/\1/p')

  if [[ "$host" =~ ^[a-z0-9-]+\.trycloudflare\.com$ && "$host" != "$last" ]]; then
    if kv put tunnel_url "https://$host"; then log "registered https://$host"; last=$host
    else log "register failed; retrying in ${INTERVAL}s" >&2; fi
  fi

  # Fast retry until the first URL is registered (cloudflared takes a few seconds).
  if [[ -z "$last" ]]; then sleep 3 & else sleep "$INTERVAL" & fi
  wait $!   # lets the trap fire immediately
done
