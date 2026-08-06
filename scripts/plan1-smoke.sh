#!/usr/bin/env bash
set -euo pipefail
API="${API:-http://127.0.0.1:8787}"
BOARD=$(curl -sf -X POST "$API/boards" -H 'content-type: application/json' \
  -d '{"name":"Smoke","workspacePath":"/tmp/aiw-smoke"}')
BOARD_ID=$(echo "$BOARD" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
EPIC=$(curl -sf -X POST "$API/boards/$BOARD_ID/cards" -H 'content-type: application/json' \
  -d '{"type":"epic","title":"E","column":"design","description":""}')
EPIC_ID=$(echo "$EPIC" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
curl -sf -X POST "$API/cards/$EPIC_ID/move" -H 'content-type: application/json' \
  -d '{"to":"split","actor":"human","humanApproved":true}' >/dev/null
TASK=$(curl -sf -X POST "$API/boards/$BOARD_ID/cards" -H 'content-type: application/json' \
  -d '{"type":"task","title":"T","column":"test","description":""}')
TASK_ID=$(echo "$TASK" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
for i in 1 2 3; do
  BODY=$(curl -sf -X POST "$API/cards/$TASK_ID/test-result" -H 'content-type: application/json' \
    -d '{"passed":false}')
  if [[ "$i" -lt 3 ]]; then
    curl -sf -X POST "$API/cards/$TASK_ID/move" -H 'content-type: application/json' \
      -d '{"to":"test","actor":"bot"}' >/dev/null
  fi
done
echo "$BODY" | python3 -c 'import sys,json; c=json.load(sys.stdin); assert c["frozen"] is True, c; print("plan1 smoke ok", c["reworkCount"])'
