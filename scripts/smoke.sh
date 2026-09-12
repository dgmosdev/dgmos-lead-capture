#!/usr/bin/env bash
set -euo pipefail
API="${API:-http://localhost:8088}"
echo "== health =="
curl -sf "$API/v1/health"
echo
echo OK
