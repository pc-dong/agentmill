#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="${API:-http://127.0.0.1:8787}"
export AM_DATA_DIR="${AM_DATA_DIR:-$(mktemp -d)}"
API_PID=""
STARTED_API=false

cleanup() {
  if [[ "$STARTED_API" == true && -n "$API_PID" ]]; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

api_code() {
  local code
  code=$(curl -s --connect-timeout 1 -o /dev/null -w "%{http_code}" "$API/boards/__smoke_ping__" 2>/dev/null || true)
  echo "${code:-000}"
}

if [[ "$(api_code)" == "000" ]]; then
  echo "Starting board-api with AM_DATA_DIR=$AM_DATA_DIR"
  (cd "$ROOT" && AM_DATA_DIR="$AM_DATA_DIR" pnpm dev:api) &
  API_PID=$!
  STARTED_API=true
  for _ in $(seq 1 30); do
    [[ "$(api_code)" != "000" ]] && break
    sleep 0.5
  done
  if [[ "$(api_code)" == "000" ]]; then
    echo "board-api failed to start on $API" >&2
    exit 1
  fi
fi

BOARD=$(curl -sf -X POST "$API/boards" -H 'content-type: application/json' \
  -d '{"name":"P3","workspacePath":"/tmp/aiw-plan3-ws"}')
BOARD_ID=$(echo "$BOARD" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

EPIC=$(curl -sf -X POST "$API/boards/$BOARD_ID/cards" -H 'content-type: application/json' \
  -d '{"type":"epic","title":"Split me","column":"split","description":"epic for split"}')
EPIC_ID=$(echo "$EPIC" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

for title in "Req A" "Req B"; do
  curl -sf -X POST "$API/boards/$BOARD_ID/cards" -H 'content-type: application/json' \
    -d "{\"type\":\"requirement\",\"title\":\"$title\",\"column\":\"requirements\",\"description\":\"\",\"epicId\":\"$EPIC_ID\"}" >/dev/null
done

curl -sf -X POST "$API/cards/$EPIC_ID/comments" -H 'content-type: application/json' \
  -d '{"author":"human","body":"@Split Bot go"}' >/dev/null

export AM_BOARD_ID="$BOARD_ID"
export AM_API_BASE="$API"
export AM_DRIVER=mock
pnpm --filter @agentmill/agent build
pnpm --filter @agentmill/worker exec tsx src/once.ts

CARDS=$(curl -sf "$API/boards/$BOARD_ID/cards")
echo "$CARDS" | python3 -c '
import sys, json
cards = json.load(sys.stdin)
epic_id = sys.argv[1]
epic = next(c for c in cards if c["id"] == epic_id)
tasks = [c for c in cards if c["type"] == "task" and c["column"] == "dev" and c.get("epicId") == epic_id]
assert len(tasks) >= 2, {"tasks": len(tasks), "epic": epic}
assert epic["column"] == "verify", epic
print("plan3 split ok", len(tasks), "tasks, epic in verify")
' "$EPIC_ID"

curl -sf -X POST "$API/cards/$EPIC_ID/comments" -H 'content-type: application/json' \
  -d '{"author":"human","body":"@Verify Bot check coverage"}' >/dev/null
pnpm --filter @agentmill/worker exec tsx src/once.ts

COMMENTS=$(curl -sf "$API/cards/$EPIC_ID/comments")
echo "$COMMENTS" | python3 -c '
import sys, json
comments = json.load(sys.stdin)
assert any("coverage ok" in c.get("body", "") for c in comments), comments
print("plan3 verify ok")
'
