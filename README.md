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
export AIW_BOARD_ID=<board-id from UI or API>
export AIW_DRIVER=mock          # or cursor
export CURSOR_API_KEY=...       # required for cursor
pnpm --filter @ai-workforce/agent build
pnpm dev:worker
```

Poll creates one job per (card, employee) pair. It does not re-queue cards that already have any job for that employee (open, claimed, done, or failed). Use `@Design Bot` (or other role bots) in a comment to re-run work on a card.

Smoke (API must be running): `./scripts/plan2-smoke.sh`
