#!/usr/bin/env bash
#   ./scripts/remove-user.sh alice
set -euo pipefail
USERS="$(cd "$(dirname "$0")/.." && pwd)/.users"
NAME=${1:?usage: remove-user.sh <name>}
grep -v "^$NAME:" "$USERS" > "$USERS.tmp" || true
mv "$USERS.tmp" "$USERS"
echo "✓ $NAME removed. Run ./scripts/deploy-worker.sh to apply."
