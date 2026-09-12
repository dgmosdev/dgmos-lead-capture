#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node scripts/apply-config.mjs

VERSION="$(node -p "require('./package.json').version")"
OUT_DIR="$ROOT/dist"
ZIP="$OUT_DIR/dgmos-capture-extension-${VERSION}.zip"
mkdir -p "$OUT_DIR"
rm -f "$ZIP"

(
  cd "$ROOT/extension"
  zip -r "$ZIP" . \
    -x "*.test.js" \
    -x "package.json" \
    -x "node_modules/*" \
    -x ".DS_Store"
)

echo "Packed $ZIP"
