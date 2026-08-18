#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Prefer dedicated port so a stale :8787 (other worktrees) does not mask plan4 routes.
PORT="${PORT:-8797}"
API="${API:-http://127.0.0.1:$PORT}"
export AM_DATA_DIR="${AM_DATA_DIR:-$(mktemp -d)}"
WS="$(mktemp -d)"
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

has_ba_jobs() {
  # Probe with invalid card: 404 = route exists; 000/connection = down; other may be missing route.
  local code
  code=$(curl -s --connect-timeout 1 -o /dev/null -w "%{http_code}" \
    -X POST "$API/cards/__smoke__/ba-jobs" \
    -H 'content-type: application/json' \
    -d '{"kind":"settle","summary":"x"}' 2>/dev/null || true)
  [[ "${code:-000}" == "404" ]]
}

if [[ "$(api_code)" == "000" ]] || ! has_ba_jobs; then
  if [[ "$(api_code)" != "000" ]] && ! has_ba_jobs; then
    PORT=8797
    API="http://127.0.0.1:$PORT"
    echo "Existing API lacks ba-jobs; starting worktree API on $API"
  else
    echo "Starting board-api with AM_DATA_DIR=$AM_DATA_DIR PORT=$PORT"
  fi
  (cd "$ROOT" && AM_DATA_DIR="$AM_DATA_DIR" PORT="$PORT" pnpm dev:api) &
  API_PID=$!
  STARTED_API=true
  for _ in $(seq 1 40); do
    [[ "$(api_code)" != "000" ]] && has_ba_jobs && break
    sleep 0.5
  done
  if [[ "$(api_code)" == "000" ]] || ! has_ba_jobs; then
    echo "board-api failed to start with ba-jobs on $API" >&2
    exit 1
  fi
fi

BOARD=$(curl -sf -X POST "$API/boards" -H 'content-type: application/json' \
  -d "{\"name\":\"P4-BA\",\"workspacePath\":\"$WS\"}")
BOARD_ID=$(echo "$BOARD" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

REQ1=$(curl -sf -X POST "$API/boards/$BOARD_ID/cards" -H 'content-type: application/json' \
  -d '{"type":"requirement","title":"OAuth login","column":"requirements","description":"need oauth"}')
REQ1_ID=$(echo "$REQ1" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

CREATE_SUMMARY=$'Conversation about OAuth.\nEPIC_MODE create\nEPIC_ID E-DEMO-001\nEPIC_SLUG login\nEPIC_TITLE Login theme\nPRD_ID P-001-01\nPRD_SLUG oauth\nPRD_TITLE OAuth login\nARTIFACT file docs/epics/E-DEMO-001-login/EPIC.md Epic\nARTIFACT file docs/epics/E-DEMO-001-login/shared-context.md Shared\nARTIFACT file docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md PRD'

python3 - "$API" "$REQ1_ID" "$CREATE_SUMMARY" <<'PY'
import json, sys, urllib.request
api, card_id, summary = sys.argv[1], sys.argv[2], sys.argv[3]
req = urllib.request.Request(
    f"{api}/cards/{card_id}/ba-jobs",
    data=json.dumps({"kind": "settle", "summary": summary}).encode(),
    headers={"content-type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
PY

export AM_BOARD_ID="$BOARD_ID"
export AM_API_BASE="$API"
export AM_DRIVER=mock
pnpm --filter @agentmill/agent build
pnpm --filter @agentmill/worker exec tsx src/once.ts

test -f "$WS/docs/epics/E-DEMO-001-login/EPIC.md"
test -f "$WS/docs/epics/E-DEMO-001-login/shared-context.md"
test -f "$WS/docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md"

CARDS=$(curl -sf "$API/boards/$BOARD_ID/cards")
EPIC_CARD_ID=$(echo "$CARDS" | python3 -c '
import sys, json
cards = json.load(sys.stdin)
req_id = sys.argv[1]
req = next(c for c in cards if c["id"] == req_id)
assert req.get("epicId"), {"req": req}
epics = [c for c in cards if c["type"] == "epic" and c["id"] == req["epicId"]]
assert len(epics) == 1, {"epics": epics, "req": req}
assert "epic_id: E-DEMO-001" in (epics[0].get("description") or ""), epics[0]
print(epics[0]["id"])
' "$REQ1_ID")

echo "plan4 create ok epic=$EPIC_CARD_ID"

REQ2=$(curl -sf -X POST "$API/boards/$BOARD_ID/cards" -H 'content-type: application/json' \
  -d "{\"type\":\"requirement\",\"title\":\"SSO\",\"column\":\"requirements\",\"description\":\"sso\",\"epicId\":\"$EPIC_CARD_ID\"}")
REQ2_ID=$(echo "$REQ2" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

LINK_SUMMARY=$'Linking SSO PRD.\nEPIC_MODE link\nEPIC_ID E-DEMO-001\nEPIC_SLUG login\nEPIC_TITLE Login theme\nPRD_ID P-001-02\nPRD_SLUG sso\nPRD_TITLE SSO login\nARTIFACT file docs/epics/E-DEMO-001-login/prds/P-001-02-sso.md PRD'

python3 - "$API" "$REQ2_ID" "$LINK_SUMMARY" <<'PY'
import json, sys, urllib.request
api, card_id, summary = sys.argv[1], sys.argv[2], sys.argv[3]
req = urllib.request.Request(
    f"{api}/cards/{card_id}/ba-jobs",
    data=json.dumps({"kind": "settle", "summary": summary}).encode(),
    headers={"content-type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
PY

pnpm --filter @agentmill/worker exec tsx src/once.ts

test -f "$WS/docs/epics/E-DEMO-001-login/prds/P-001-02-sso.md"
# link path must not invent a second epic tree
test -f "$WS/docs/epics/E-DEMO-001-login/EPIC.md"
test ! -d "$WS/docs/epics/E-DEMO-001-sso"

CARDS2=$(curl -sf "$API/boards/$BOARD_ID/cards")
echo "$CARDS2" | python3 -c '
import sys, json
cards = json.load(sys.stdin)
req2_id, epic_id = sys.argv[1], sys.argv[2]
req2 = next(c for c in cards if c["id"] == req2_id)
assert req2.get("epicId") == epic_id, req2
epics = [c for c in cards if c["type"] == "epic"]
assert len(epics) == 1, {"epics": len(epics)}
print("plan4 link ok")
' "$REQ2_ID" "$EPIC_CARD_ID"

echo "plan4 ba smoke ok"
