#!/usr/bin/env bash
# Add (or replace) a login. Stored as name:sha256 in .users; uploaded by deploy-worker.sh.
#   ./scripts/add-user.sh alice
set -euo pipefail
USERS="$(cd "$(dirname "$0")/.." && pwd)/.users"

NAME=${1:?usage: add-user.sh <name>}
[[ "$NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Name: letters, digits, . _ - only" >&2; exit 1; }

read -rsp "Password for $NAME: " PW; echo
[[ ${#PW} -ge 12 ]] || { echo "Use at least 12 characters" >&2; exit 1; }

HASH=$(printf %s "$PW" | shasum -a 256 | cut -d' ' -f1)
umask 077
touch "$USERS"
grep -v "^$NAME:" "$USERS" > "$USERS.tmp" || true
echo "$NAME:$HASH" >> "$USERS.tmp"
mv "$USERS.tmp" "$USERS"
echo "✓ $NAME saved. Run ./scripts/deploy-worker.sh to apply."
