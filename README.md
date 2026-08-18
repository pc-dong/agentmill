# AI Workforce

Lightweight kanban for human + AI employee software delivery.

Plan 1 complete (board domain, SQLite API, React kanban). Plan 2 worker available (`mock` or `cursor` driver).

## Plan 1 — Run & Test

### Run

```bash
pnpm install
pnpm --filter @ai-workforce/domain build
pnpm dev:api   # :8787
pnpm dev:web   # :5173
```

### Test

```bash
pnpm --filter @ai-workforce/domain test
pnpm --filter @ai-workforce/board-api test
```

## Plan 2 — Worker

```bash
# Default: serve ALL boards/workspaces (auto-discovered each tick)
export AIW_DRIVER=mock          # or cursor
export CURSOR_API_KEY=...       # required for cursor

# Optional: restrict to specific boards (comma-separated)
# export AIW_BOARD_IDS=<board-id-1>,<board-id-2>
# export AIW_BOARD_ID=<board-id>     # legacy single-board form, still works

pnpm --filter @ai-workforce/agent build
pnpm dev:worker
```

**Multi-workspace:** one worker process serves every board, each board bound to its own workspace directory. Workspace access is isolated per card: jobs resolve the workspace from the board that owns the card (never from worker config), Cursor runs with `cwd` = that workspace, and split/scanner-created cards always land on the job's own board. WS session chats are routed by the session's `boardId`.

Poll creates one job per (card, employee) pair. It does not re-queue cards that already have any job for that employee (open, claimed, done, or failed). Use `@Design Bot` (or other role bots) in a comment to re-run work on a card.

Smoke (requires API already running on `:8787`; does not auto-start): `./scripts/plan2-smoke.sh`
Multi-workspace smoke (auto-starts its own API on `:8799`): `./scripts/multi-board-smoke.sh`

## Plan 3 — Chat + role outcomes

Design sidebar streams chat over WebSocket; settle writes artifacts. After oneshot jobs complete, the worker applies role outcomes (Split → tasks + verify, Verify/Dev/Test/Review column rules).

```bash
export AIW_DRIVER=mock          # or cursor   (worker serves all boards by default)
pnpm --filter @ai-workforce/agent build
pnpm dev:worker                 # poll + WS session loop
```

Prerequisite: `pnpm dev:api` on `:8787` (shares `AIW_DATA_DIR` with worker).

Smoke (may auto-start API when port is down): `./scripts/plan3-smoke.sh`

Flow exercised: epic in `split`, requirements with `epicId`, `@Split Bot` → ≥2 tasks in `dev` and epic in `verify`, then `@Verify Bot` → coverage comment.

## Plan 4 — BA clarification → Epic/PRD

Requirement cards in `requirements` open a BA sidebar chat (`employeeRole=ba`). Flow:

1. **澄清** — chat with BA Bot (mock or Cursor driver).
2. **在 Cursor 中深挖** (optional) — enqueues a `deep_dive` oneshot job; after it finishes, human still clicks settle.
3. **沉淀结论** — UI validates BA protocol lines, enqueues `settle` job; Worker writes `docs/epics/...` under the board `workspacePath`, then `POST /cards/:id/ba-settle` creates/links the Epic card.

Protocol lines (in the BA reply / settle payload): `EPIC_MODE create|link`, `EPIC_ID`, `EPIC_SLUG`, `EPIC_TITLE`, `PRD_ID`, `PRD_SLUG`, `PRD_TITLE`, plus `ARTIFACT file …` paths.

Smoke (may auto-start API when port is down): `./scripts/plan4-ba-smoke.sh`

Exercises create (new Epic + PRD files + epic card) then link (second requirement → PRD only).
