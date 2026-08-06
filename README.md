# AI Workforce

Lightweight kanban for human + AI employee software delivery.

## Plan 1 (current)

Board domain rules, SQLite API, React kanban. No Worker/Cursor yet.

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
