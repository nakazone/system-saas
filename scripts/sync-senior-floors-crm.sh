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

# Nixpacks/Railway require valid UTF-8; SF checkout often has CP1252 dashes/accents.
DEST="$DEST" python3 - <<'PY'
from pathlib import Path
import os
root = Path(os.environ["DEST"])
skip = {".png",".jpg",".jpeg",".gif",".webp",".ico",".pdf",".woff",".woff2",".ttf",".eot",".zip",".gz",".br",".map"}
ctrl_map = {chr(c): "—" for c in (0x81, 0x8D, 0x8F, 0x90, 0x9D)}
fixed = 0
for p in root.rglob("*"):
    if not p.is_file() or "node_modules" in p.parts or p.suffix.lower() in skip:
        continue
    raw = p.read_bytes()
    if b"\x00" in raw[:4096]:
        continue
    try:
        text = raw.decode("utf-8")
        changed = False
    except UnicodeDecodeError:
        text = raw.decode("cp1252")
        changed = True
    for a, b in ctrl_map.items():
        if a in text:
            text = text.replace(a, b)
            changed = True
    if changed:
        p.write_bytes(text.encode("utf-8"))
        fixed += 1
print(f"UTF-8 normalized ({fixed} files rewritten)")
PY

echo "Synced $SRC → $DEST"
du -sh "$DEST"
