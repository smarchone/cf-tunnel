#!/usr/bin/env bash
# Deploy the Worker with USERS and ORIGIN_KEY; save its URL into .env.
# Re-run after adding/removing users.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV="$ROOT/.env"
USERS="$ROOT/.users"

[[ -f "$ENV" ]]   || { echo "Missing .env — run ./scripts/init-env.sh" >&2; exit 1; }
[[ -s "$USERS" ]] || { echo "No users — run ./scripts/add-user.sh <name>" >&2; exit 1; }

get() { sed -n "s/^$1=//p" "$ENV"; }
USERS_VALUE=$(paste -sd, "$USERS")

SECRETS=$(mktemp)
trap 'rm -f "$SECRETS"' EXIT
chmod 600 "$SECRETS"
printf '{"USERS":"%s","ORIGIN_KEY":"%s"}\n' \
  "$USERS_VALUE" "$(get ORIGIN_KEY)" > "$SECRETS"

cd "$ROOT/worker"
OUT=$(npx -y wrangler@4.164.0 deploy --secrets-file "$SECRETS" 2>&1 | tee /dev/stderr)

URL=$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' <<<"$OUT" | head -1)
if [[ -n "$URL" ]]; then
  sed -i '' "s|^WORKER_URL=.*|WORKER_URL=$URL|" "$ENV"
  echo "✓ Worker live at $URL (saved to .env). Next: ./scripts/online.sh"
else
  echo "Deployed, but couldn't read the workers.dev URL — set WORKER_URL in .env by hand." >&2
fi
