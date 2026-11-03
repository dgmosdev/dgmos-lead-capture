#!/usr/bin/env bash
# Usage: package-extension.sh [--store]
#   default  → dist/dgmos-lead-capture-extension-<v>.zip       (team zip; keeps manifest "key" = fixed ID)
#   --store  → dist/dgmos-lead-capture-extension-<v>-store.zip (Chrome Web Store; no "key", no localhost hosts)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STORE=0
if [ "${1:-}" = "--store" ]; then STORE=1; fi

node scripts/apply-config.mjs

VERSION="$(node -p "require('./package.json').version")"
MANIFEST_VERSION="$(node -p "require('./extension/manifest.json').version")"
if [ "$VERSION" != "$MANIFEST_VERSION" ]; then
  echo "Version mismatch: package.json=$VERSION manifest.json=$MANIFEST_VERSION" >&2
  exit 1
fi

OUT_DIR="$ROOT/dist"
SUFFIX=""
if [ "$STORE" = "1" ]; then SUFFIX="-store"; fi
ZIP="$OUT_DIR/dgmos-lead-capture-extension-${VERSION}${SUFFIX}.zip"
mkdir -p "$OUT_DIR"
rm -f "$ZIP"

SRC="$ROOT/extension"
if [ "$STORE" = "1" ]; then
  # The Web Store assigns its own item ID and rejects a manifest "key"; dev-only hosts don't ship.
  SRC="$(mktemp -d)"
  trap 'rm -rf "$SRC"' EXIT
  cp -R "$ROOT/extension/." "$SRC/"
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const m = JSON.parse(fs.readFileSync(p, "utf8"));
    delete m.key;
    m.host_permissions = (m.host_permissions || []).filter((h) => !/^http:\/\/(localhost|127\.0\.0\.1)\//.test(h));
    fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  ' "$SRC/manifest.json"
fi

# Ship runtime files only: no tests, LinkedIn page fixtures, npm metadata or OS junk.
(
  cd "$SRC"
  zip -r -q "$ZIP" . \
    -x "*.test.js" \
    -x "*/fixtures/*" \
    -x "package.json" \
    -x "package-lock.json" \
    -x "node_modules/*" \
    -x "*.DS_Store"
)

if unzip -Z1 "$ZIP" | grep -E '(\.test\.js$|/fixtures/|package(-lock)?\.json$|node_modules/)' >/dev/null; then
  echo "Package contains non-runtime files:" >&2
  unzip -Z1 "$ZIP" | grep -E '(\.test\.js$|/fixtures/|package(-lock)?\.json$|node_modules/)' >&2
  exit 1
fi

echo "Packed $ZIP ($(unzip -Z1 "$ZIP" | grep -vc '/$') files)"
