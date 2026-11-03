#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node scripts/apply-config.mjs

VERSION="$(node -p "require('./package.json').version")"
MANIFEST_VERSION="$(node -p "require('./extension/manifest.json').version")"
if [ "$VERSION" != "$MANIFEST_VERSION" ]; then
  echo "Version mismatch: package.json=$VERSION manifest.json=$MANIFEST_VERSION" >&2
  exit 1
fi

OUT_DIR="$ROOT/dist"
ZIP="$OUT_DIR/dgmos-lead-capture-extension-${VERSION}.zip"
mkdir -p "$OUT_DIR"
rm -f "$ZIP"

# Ship runtime files only: no tests, LinkedIn page fixtures, npm metadata or OS junk.
(
  cd "$ROOT/extension"
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
