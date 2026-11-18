#!/usr/bin/env bash
# One-time: generate REGISTER_KEY and ORIGIN_KEY into .env.
set -euo pipefail
ENV="$(cd "$(dirname "$0")/.." && pwd)/.env"

if [[ -f "$ENV" ]]; then
  echo ".env already exists — not overwriting." >&2
  exit 1
fi

umask 077
cat > "$ENV" <<EOF
# Set by scripts/deploy-worker.sh
WORKER_URL=
REGISTER_KEY=$(openssl rand -hex 32)
ORIGIN_KEY=$(openssl rand -hex 32)
EOF
echo "✓ Wrote .env. Next: ./scripts/add-user.sh <name>"
