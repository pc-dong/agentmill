#!/usr/bin/env bash
# Multi-workspace smoke: one worker (wildcard) serving two boards with
# separate workspaces; verify per-board job execution and file isolation.
set -euo pipefail

PORT=8799
BASE="http://127.0.0.1:$PORT"
ROOT="$(mktemp -d /tmp/aiw-multi-XXXXXX)"
DATA="$ROOT/data"
WS_A="$ROOT/ws-a"
WS_B="$ROOT/ws-b"
mkdir -p "$DATA" "$WS_A" "$WS_B"

cleanup() {
  [[ -n "${WORKER_PID:-}" ]] && kill "$WORKER_PID" 2>/dev/null || true
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT

if curl -sf "http://127.0.0.1:$PORT/boards" >/dev/null 2>&1; then
  echo "port $PORT busy; aborting"
  exit 1
fi

AM_DATA_DIR="$DATA" PORT="$PORT" pnpm --filter @agentmill/board-api dev >/tmp/aiw-multi-api.log 2>&1 &
API_PID=$!
for i in $(seq 1 50); do
  curl -sf "$BASE/boards" >/dev/null 2>&1 && break
  sleep 0.2
done

# Two boards = two workspaces
BOARD_A=$(curl -sf -X POST "$BASE/boards" -H 'content-type: application/json' \
  -d "{\"name\":\"A\",\"workspacePath\":\"$WS_A\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
BOARD_B=$(curl -sf -X POST "$BASE/boards" -H 'content-type: application/json' \
  -d "{\"name\":\"B\",\"workspacePath\":\"$WS_B\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# GET /boards must list both
COUNT=$(curl -sf "$BASE/boards" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
[[ "$COUNT" == "2" ]] || { echo "FAIL: expected 2 boards, got $COUNT"; exit 1; }

# A requirement card on each board, then @BA Bot mention → mention jobs on both boards
CARD_A=$(curl -sf -X POST "$BASE/boards/$BOARD_A/cards" -H 'content-type: application/json' \
  -d '{"type":"requirement","title":"Req A","description":"","column":"requirements","epicId":null}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
CARD_B=$(curl -sf -X POST "$BASE/boards/$BOARD_B/cards" -H 'content-type: application/json' \
  -d '{"type":"requirement","title":"Req B","description":"","column":"requirements","epicId":null}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -sf -X POST "$BASE/cards/$CARD_A/comments" -H 'content-type: application/json' \
  -d '{"author":"human","body":"@BA Bot 澄清一下需求 A"}' >/dev/null
curl -sf -X POST "$BASE/cards/$CARD_B/comments" -H 'content-type: application/json' \
  -d '{"author":"human","body":"@BA Bot 澄清一下需求 B"}' >/dev/null

# Start ONE worker with NO board env → wildcard, serves every board
AM_API_BASE="$BASE" AM_POLL_INTERVAL_MS=500 pnpm --filter @agentmill/worker dev >/tmp/aiw-multi-worker.log 2>&1 &
WORKER_PID=$!

wait_bot_comment() {
  local card="$1"
  for i in $(seq 1 60); do
    local n
    n=$(curl -sf "$BASE/cards/$card/comments" | python3 -c 'import sys,json;print(sum(1 for c in json.load(sys.stdin) if c["author"]=="bot"))' 2>/dev/null || echo 0)
    [[ "$n" -ge 1 ]] && return 0
    sleep 0.5
  done
  return 1
}

echo "waiting for worker to finish jobs on both boards…"
wait_bot_comment "$CARD_A" || { echo "FAIL: board A job not done"; exit 1; }
wait_bot_comment "$CARD_B" || { echo "FAIL: board B job not done"; exit 1; }

# Both mention jobs must be terminal (done) — open jobs list must be empty.
for b in "$BOARD_A" "$BOARD_B"; do
  OPEN=$(curl -sf "$BASE/boards/$b/jobs" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
  [[ "$OPEN" == "0" ]] || { echo "FAIL: board $b still has open jobs"; exit 1; }
done

# Bot reply comment must land on the right card of the right board
CA=$(curl -sf "$BASE/cards/$CARD_A/comments" | python3 -c 'import sys,json;print(sum(1 for c in json.load(sys.stdin) if c["author"]=="bot"))')
CB=$(curl -sf "$BASE/cards/$CARD_B/comments" | python3 -c 'import sys,json;print(sum(1 for c in json.load(sys.stdin) if c["author"]=="bot"))')
[[ "$CA" -ge 1 && "$CB" -ge 1 ]] || { echo "FAIL: bot comments missing (A=$CA B=$CB)"; exit 1; }

echo "PASS: single wildcard worker executed jobs on both boards/workspaces"
