#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/.env" 2>/dev/null || true
ADMIN_KEY="${ADMIN_KEY:-change-me-admin-key}"
API="${API:-http://localhost:8088}"
curl -sS -X POST "$API/admin/bootstrap-token" -H "X-Admin-Key: $ADMIN_KEY" | tee /dev/stderr
echo
