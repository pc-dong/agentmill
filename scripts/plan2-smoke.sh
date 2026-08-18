#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="${API:-http://127.0.0.1:8787}"
export AM_DATA_DIR="${AM_DATA_DIR:-$(mktemp -d)}"
# assume API already running OR start it in background:
# Prefer: smoke documents "start pnpm dev:api first" like plan1

BOARD=$(curl -sf -X POST "$API/boards" -H 'content-type: application/json' \
  -d '{"name":"P2","workspacePath":"/tmp/aiw-plan2-ws"}')
BOARD_ID=$(echo "$BOARD" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
EPIC=$(curl -sf -X POST "$API/boards/$BOARD_ID/cards" -H 'content-type: application/json' \
  -d '{"type":"epic","title":"Design me","column":"design","description":"outline"}')
EPIC_ID=$(echo "$EPIC" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
curl -sf -X POST "$API/cards/$EPIC_ID/comments" -H 'content-type: application/json' \
  -d '{"author":"human","body":"@Design Bot please draft"}' >/dev/null

export AM_BOARD_ID="$BOARD_ID"
export AM_API_BASE="$API"
export AM_DRIVER=mock
pnpm --filter @agentmill/agent build
pnpm --filter @agentmill/worker exec tsx src/once.ts

CARD=$(curl -sf "$API/boards/$BOARD_ID/cards" | python3 -c 'import sys,json; epic="'"$EPIC_ID"'"; cards=json.load(sys.stdin); print(json.dumps([c for c in cards if c["id"]==epic][0]))')
echo "$CARD" | python3 -c 'import sys,json; c=json.load(sys.stdin); assert any(a.get("href","").endswith(".md") for a in c.get("artifacts",[])), c; print("plan2 smoke ok", c["artifacts"][0]["href"])'
