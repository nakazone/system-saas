#!/usr/bin/env bash
# Sync local Senior Floors System into ./crm (multi-tenant port source).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SENIOR_FLOORS_SYSTEM_PATH:-$HOME/senior-floors-landing/senior-floors-system}"
DEST="$ROOT/crm"

if [[ ! -d "$SRC" ]]; then
  echo "Source not found: $SRC"
  echo "Set SENIOR_FLOORS_SYSTEM_PATH to your senior-floors-system checkout."
  exit 1
fi

mkdir -p "$DEST"
rsync -a --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude '.DS_Store' \
  --exclude 'senior-floors-system' \
  --exclude 'senior-floors-lvp' \
  --exclude 'senior-floors-website' \
  --exclude 'dist' \
  "$SRC/" "$DEST/"

echo "Synced $SRC → $DEST"
du -sh "$DEST"
