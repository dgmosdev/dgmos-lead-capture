#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/.env" 2>/dev/null || true
API="${API:-http://localhost:8088}"
ADMIN_KEY="${ADMIN_KEY:-change-me-admin-key}"

echo "== health =="
curl -sf "$API/v1/health" | tee /dev/stderr
echo

echo "== bootstrap token =="
BOOT="$(curl -sf -X POST "$API/admin/bootstrap-token" -H "X-Admin-Key: $ADMIN_KEY")"
echo "$BOOT"
TOKEN="$(node -e "const j=JSON.parse(process.argv[1]); if(!j.secret) process.exit(1); process.stdout.write(j.secret)" "$BOOT")"

echo
echo "== session =="
curl -sf "$API/v1/session" -H "Authorization: Bearer $TOKEN" | tee /dev/stderr
echo

echo "== leads =="
curl -sf -X POST "$API/v1/leads" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"linkedin","leads":[{"name":"Smoke Test","profile_url":"https://www.linkedin.com/in/smoke-test","company":"Dgmos"}]}' \
  | tee /dev/stderr
echo
echo "OK"
