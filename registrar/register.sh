#!/bin/sh
# Every INTERVAL seconds: read the quick-tunnel hostname from cloudflared.
# When it changes (first start, cloudflared restart), PUT it to the Worker → KV.
set -u
: "${WORKER_URL:?}" "${REGISTER_KEY:?}"
INTERVAL=${INTERVAL:-30}
last=""

while true; do
  host=$(curl -fsS --max-time 5 http://cloudflared:2000/quicktunnel 2>/dev/null \
    | sed -n 's/.*"hostname" *: *"\([^"]*\)".*/\1/p')

  if [ -n "$host" ] && [ "$host" != "$last" ]; then
    if curl -fsS --max-time 10 -X PUT \
         -H "authorization: Bearer $REGISTER_KEY" \
         --data "https://$host" "$WORKER_URL/__tunnel" >/dev/null; then
      echo "registered https://$host"
      last=$host
    else
      echo "register failed; retrying in ${INTERVAL}s"
    fi
  fi

  sleep "$INTERVAL"
done
