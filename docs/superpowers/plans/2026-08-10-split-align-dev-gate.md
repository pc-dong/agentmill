# Split Align + Design-Column Task Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Split tasks in the design column, gate `design→dev` behind Verify + human drag, add Split Bot alignment (design + task cards) that can revise the split, and require Dev `SUMMARY` comments before moving to test.

**Architecture:** Extend domain occupancy and move rules; persist `split_verified_at` on design cards; Split oneshot creates frozen tasks in `design` and dirties verify; Verify pass sets verified timestamp and unfreezes design-column tasks only; `POST /cards/:id/split-settle` applies alignment protocol; UI adds SplitChat + pipeline gates; Dev outcome requires parsed `SUMMARY:` before `dev→test`.

**Tech Stack:** Existing monorepo — `@ai-workforce/domain`, `@ai-workforce/agent`, `board-api` (Hono+SQLite), `worker` (tsx), `board-web` (React), Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-split-align-dev-gate-design.md`
- Task occupancy includes `design`; bots never move `design→dev`
- Human `design→dev` requires `frozen === false` **and** parent design `splitVerifiedAt != null` (do **not** allow `humanApproved` to bypass Verify for this move)
- Structure changes (create / successful update on design-column task / successful delete) clear `splitVerifiedAt` and re-freeze tasks still in `design` for that `designId`
- In-flight tasks (`column !== "design"`): never auto-update; delete requires `confirmDelete=true`
- Re-running Split oneshot: **append** new tasks + dirty Verify (do not wipe existing)
- Open split session on the design card blocks「拆分任务 / 校验覆盖」with a prompt (do not auto-settle)
- Dev must post `SUMMARY:` comment before `dev→test`; missing SUMMARY → no move + warning
- Do not migrate existing `dev`-column tasks back to design
- Tests pass without `CURSOR_API_KEY` (Mock)
- Prefer TDD; frequent commits per task

## File structure (locked in)

```text
packages/domain/
  src/columns.ts                 # task occupancy + design
  src/transition.ts              # ban bot design→dev for tasks
  src/columns.test.ts
  src/transition.test.ts
packages/agent/
  src/parseOutcome.ts            # parse SUMMARY line
  src/parseOutcome.test.ts
  src/parseSplitSettle.ts        # NEW: TASK create|update|delete + SPLIT note
  src/parseSplitSettle.test.ts   # NEW
  src/prompts.ts                 # split align + dev SUMMARY
  src/mock.ts                    # SUMMARY + split settle lines when useful
apps/board-api/
  src/db.ts                      # cards.split_verified_at
  src/repo.ts                    # CardRecord.splitVerifiedAt; markVerified/Dirty; helpers
  src/routes.ts                  # move gate; delete confirm; split-settle; design-jobs open-session check
  src/routes.test.ts / splitSettle.test.ts
apps/worker/
  src/outcomes.ts                # split→design; verify→verifiedAt; dev SUMMARY
  src/outcomes.test.ts
  src/boardClient.ts             # patch types if needed
apps/board-web/
  src/api.ts                     # Card.splitVerifiedAt; splitSettle; deleteCard confirm
  src/SplitChat.tsx              # NEW (mirror DesignChat, role=split)
  src/CardDrawer.tsx             # pipeline + SplitChat + delete confirm
  src/BoardView.tsx              # badges / drag error copy
  src/styles.css                 # minimal if needed
docs/superpowers/specs/2026-08-10-split-align-dev-gate-design.md  # status → approved
```

---

### Task 1: Domain — task may sit in design; ban bot `design→dev`

**Files:**
- Modify: `packages/domain/src/columns.ts`
- Modify: `packages/domain/src/columns.test.ts`
- Modify: `packages/domain/src/transition.ts`
- Modify: `packages/domain/src/transition.test.ts`

**Interfaces:**
- Produces: `isColumnAllowedForType("task", "design") === true`
- Produces: `planMove(taskInDesign, { to: "dev", actor: "bot" })` → `{ ok: false, reason }` containing `human` or `design → dev`

- [ ] **Step 1: Write failing occupancy + move tests**

In `columns.test.ts`:

```ts
it("allows task in design column", () => {
  expect(isColumnAllowedForType("task", "design")).toBe(true);
});
```

In `transition.test.ts` (adapt existing card fixtures):

```ts
it("rejects bot moving task from design to dev", () => {
  const card = { id: "t1", type: "task" as const, column: "design" as const, reworkCount: 0, frozen: false };
  const r = planMove(card, { to: "dev", actor: "bot" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toMatch(/human|design\s*→\s*dev/i);
});

it("allows human moving unfrozen task design to dev (domain only)", () => {
  const card = { id: "t1", type: "task" as const, column: "design" as const, reworkCount: 0, frozen: false };
  const r = planMove(card, { to: "dev", actor: "human" });
  expect(r.ok).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @ai-workforce/domain exec vitest run src/columns.test.ts src/transition.test.ts -t "task in design|design to dev"
```

Expected: FAIL (task not allowed in design and/or bot move still ok)

- [ ] **Step 3: Minimal implementation**

`columns.ts` — change task occupancy:

```ts
task: ["design", "dev", "test", "accept", "done"],
```

`transition.ts` — after occupancy check, before human gates:

```ts
if (
  card.type === "task" &&
  card.column === "design" &&
  req.to === "dev" &&
  req.actor === "bot"
) {
  return {
    ok: false,
    reason: "Move design → dev for tasks requires a human drag",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run the same vitest command. Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/columns.ts packages/domain/src/columns.test.ts \
  packages/domain/src/transition.ts packages/domain/src/transition.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): allow tasks in design; ban bot design→dev

EOF
)"
```

---

### Task 2: Persist `splitVerifiedAt` + dirty/verified helpers

**Files:**
- Modify: `apps/board-api/src/db.ts`
- Modify: `apps/board-api/src/repo.ts`
- Modify: `apps/board-api/src/repo.test.ts`

**Interfaces:**
- Produces: `CardRecord.splitVerifiedAt: string | null`
- Produces: `repo.markDesignSplitVerified(designId: string): void` → sets `split_verified_at` ISO now
- Produces: `repo.markDesignSplitDirty(designId: string): void` → sets `split_verified_at` NULL; sets `frozen=1` for all tasks with that `design_id` and `column_id='design'`
- Consumes: existing `listTasksForDesign`, `updateCard`, `getCard`

- [ ] **Step 1: Write failing repo tests**

```ts
it("markDesignSplitVerified and Dirty round-trip", () => {
  const board = repo.createBoard({ name: "b", workspacePath: "/tmp/x" });
  const design = repo.createCard({
    boardId: board.id, type: "design", title: "D", description: "", column: "design",
  });
  const task = repo.createCard({
    boardId: board.id, type: "task", title: "T", description: "", column: "design",
    designId: design.id, frozen: false,
  });
  expect(repo.getCard(design.id)!.splitVerifiedAt).toBeNull();
  repo.markDesignSplitVerified(design.id);
  expect(repo.getCard(design.id)!.splitVerifiedAt).toBeTruthy();
  repo.markDesignSplitDirty(design.id);
  expect(repo.getCard(design.id)!.splitVerifiedAt).toBeNull();
  expect(repo.getCard(task.id)!.frozen).toBe(true);
});

it("markDesignSplitDirty does not freeze tasks outside design", () => {
  const board = repo.createBoard({ name: "b", workspacePath: "/tmp/x" });
  const design = repo.createCard({
    boardId: board.id, type: "design", title: "D", description: "", column: "design",
  });
  const inflight = repo.createCard({
    boardId: board.id, type: "task", title: "T", description: "", column: "dev",
    designId: design.id, frozen: false,
  });
  repo.markDesignSplitVerified(design.id);
  repo.markDesignSplitDirty(design.id);
  expect(repo.getCard(inflight.id)!.frozen).toBe(false);
  expect(repo.getCard(inflight.id)!.column).toBe("dev");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-workforce/board-api exec vitest run src/repo.test.ts -t "markDesignSplit"`

Expected: FAIL (`splitVerifiedAt` / methods missing)

- [ ] **Step 3: Implement migration + mapping + helpers**

`db.ts` after other `ensureColumn` calls:

```ts
ensureColumn(db, "cards", "split_verified_at", "TEXT");
```

`repo.ts` — add to `CardRecord`:

```ts
splitVerifiedAt: string | null;
```

Map in `getCard` / list SELECT (add `split_verified_at as splitVerifiedAt`) and INSERT/UPDATE paths default `null`.

```ts
markDesignSplitVerified(designId: string): void {
  const now = new Date().toISOString();
  this.db.prepare(
    `UPDATE cards SET split_verified_at = ?, updated_at = ? WHERE id = ? AND type = 'design'`,
  ).run(now, now, designId);
}

markDesignSplitDirty(designId: string): void {
  const now = new Date().toISOString();
  this.db.prepare(
    `UPDATE cards SET split_verified_at = NULL, updated_at = ? WHERE id = ? AND type = 'design'`,
  ).run(now, designId);
  this.db.prepare(
    `UPDATE cards SET frozen = 1, updated_at = ?
     WHERE design_id = ? AND type = 'task' AND column_id = 'design'`,
  ).run(now, designId);
}
```

Also allow `updateCard` patch `{ splitVerifiedAt: string | null }` for worker convenience **or** rely only on mark helpers (prefer mark helpers + expose via routes for verify).

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/board-api/src/db.ts apps/board-api/src/repo.ts apps/board-api/src/repo.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add design splitVerifiedAt and dirty helpers

EOF
)"
```

---

### Task 3: API move gate + delete confirmDelete

**Files:**
- Modify: `apps/board-api/src/routes.ts` (`POST /cards/:id/move`, `DELETE /cards/:id`)
- Modify: `apps/board-api/src/routes.test.ts`

**Interfaces:**
- Produces: human `task` `design→dev` returns 400 unless `!frozen && parent.splitVerifiedAt`
- Produces: `DELETE /cards/:id` — if task `column !== "design"`, require query `confirmDelete=true`; on success call `markDesignSplitDirty(designId)` when `designId` present
- Produces: design-column task delete without query succeeds and dirties parent design

- [ ] **Step 1: Write failing route tests**

```ts
it("blocks human design→dev when not verified", async () => {
  // create design + frozen=false task in design without markVerified
  const res = await app.request(`/cards/${task.id}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: "dev", actor: "human" }),
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: expect.stringMatching(/校验|verif/i) });
});

it("allows human design→dev after verify mark", async () => {
  repo.markDesignSplitVerified(design.id);
  repo.updateCard(task.id, { frozen: false });
  const res = await app.request(`/cards/${task.id}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: "dev", actor: "human" }),
  });
  expect(res.status).toBe(200);
  expect((await res.json()).column).toBe("dev");
});

it("rejects delete of in-flight task without confirmDelete", async () => {
  const res = await app.request(`/cards/${inflight.id}`, { method: "DELETE" });
  expect(res.status).toBe(409);
});

it("deletes in-flight task with confirmDelete and dirties design", async () => {
  repo.markDesignSplitVerified(design.id);
  const res = await app.request(`/cards/${inflight.id}?confirmDelete=true`, {
    method: "DELETE",
  });
  expect(res.status).toBe(200);
  expect(repo.getCard(design.id)!.splitVerifiedAt).toBeNull();
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @ai-workforce/board-api exec vitest run src/routes.test.ts -t "design→dev|confirmDelete"`

- [ ] **Step 3: Implement gates**

In `POST /cards/:cardId/move`, after `planMove` ok, before `updateCard`:

```ts
if (
  card.type === "task" &&
  card.column === "design" &&
  body.to === "dev" &&
  body.actor === "human"
) {
  if (card.frozen) {
    return c.json({ error: "任务仍冻结：请先通过「校验覆盖」" }, 400);
  }
  if (!card.designId) {
    return c.json({ error: "task missing designId" }, 400);
  }
  const design = repo.getCard(card.designId);
  if (!design?.splitVerifiedAt) {
    return c.json(
      { error: "拆分未校验或已变更：请重新「校验覆盖」后再拖入开发列" },
      400,
    );
  }
}
```

In `DELETE /cards/:cardId`:

```ts
const confirmDelete = c.req.query("confirmDelete") === "true";
if (card.type === "task" && card.column !== "design" && !confirmDelete) {
  return c.json(
    { error: "in-flight task delete requires confirmDelete=true" },
    409,
  );
}
const designId = card.designId;
if (!repo.deleteCard(cardId)) {
  return c.json({ error: "cannot delete" }, 409);
}
if (designId) repo.markDesignSplitDirty(designId);
return c.json({ ok: true, id: cardId });
```

Note: deleting a design-column task also dirties (structure change) — intentional.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/board-api/src/routes.ts apps/board-api/src/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(api): gate design→dev on verify; confirm in-flight deletes

EOF
)"
```

---

### Task 4: Worker Split → design column; Verify sets verifiedAt

**Files:**
- Modify: `apps/worker/src/outcomes.ts`
- Modify: `apps/worker/src/outcomes.test.ts`
- Modify: `apps/worker/src/boardClient.ts` (ensure `updateCard` can send `splitVerifiedAt` **or** add `markDesignSplitVerified` / `markDesignSplitDirty` HTTP helpers)

**Interfaces:**
- Produces: split `createCard({ column: "design", frozen: true, designId, ... })`
- Produces: after creating ≥1 task, call dirty on design (API helper or `PATCH`/`POST`)
- Produces: verify pass → unfreeze only `type=task && designId && frozen && column==="design"`; then mark design verified
- Consumes: Task 2 helpers via board-api routes

Preferred HTTP (add thin routes if missing):

- `POST /cards/:designId/split-verified` → `markDesignSplitVerified`
- `POST /cards/:designId/split-dirty` → `markDesignSplitDirty`

Or extend `PATCH /cards/:id` with `splitVerifiedAt`. Prefer dedicated POSTs to keep side effects (re-freeze) correct.

- [ ] **Step 1: Write failing worker tests**

Update existing split test expectation `column: "design"`.

Add:

```ts
it("verify pass unfreezes design-column tasks and marks verified", async () => {
  const updateCard = vi.fn(async () => ({}));
  const client = fakeClient({
    listCards: vi.fn(async () => [
      { id: "t1", type: "task", designId: "design1", frozen: true, column: "design" },
      { id: "t2", type: "task", designId: "design1", frozen: true, column: "dev" },
    ]),
    updateCard,
    markDesignSplitVerified: vi.fn(async () => {}),
  });
  await applyRoleOutcome("verify", "VERIFY pass", designCtx, client);
  expect(updateCard).toHaveBeenCalledWith("t1", { frozen: false });
  expect(updateCard).not.toHaveBeenCalledWith("t2", expect.anything());
  expect(client.markDesignSplitVerified).toHaveBeenCalledWith("design1");
});
```

Extend `OutcomeBoardClient` with optional `markDesignSplitVerified` / `markDesignSplitDirty`.

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @ai-workforce/worker exec vitest run src/outcomes.test.ts -t "split|verify pass"`

- [ ] **Step 3: Implement outcomes + boardClient + API POSTs**

`outcomes.ts` split case: `column: "design"`; after loop if `outcome.tasks.length > 0` and `client.markDesignSplitDirty`, call it with `ctx.cardId`.

Verify pass: only unfreeze when `t.column === "design"`; then `markDesignSplitVerified(ctx.cardId)`.

`boardClient.ts`:

```ts
markDesignSplitVerified(designId: string) {
  return this.request(`/cards/${designId}/split-verified`, { method: "POST" });
},
markDesignSplitDirty(designId: string) {
  return this.request(`/cards/${designId}/split-dirty`, { method: "POST" });
},
```

`routes.ts` — add the two POST handlers (design type only).

- [ ] **Step 4: Run worker + api tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/outcomes.ts apps/worker/src/outcomes.test.ts \
  apps/worker/src/boardClient.ts apps/board-api/src/routes.ts apps/board-api/src/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(worker): create split tasks in design; verify marks splitVerifiedAt

EOF
)"
```

---

### Task 5: `parseSplitSettle` protocol

**Files:**
- Create: `packages/agent/src/parseSplitSettle.ts`
- Create: `packages/agent/src/parseSplitSettle.test.ts`
- Modify: `packages/agent/src/index.ts` (export)
- Modify: `packages/agent/src/prompts.ts` (add `splitAlign` prompt text used by session)

**Interfaces:**
- Produces:

```ts
export type SplitSettleOp =
  | { kind: "create"; title: string; description: string; planPath?: string }
  | { kind: "update"; cardId: string; title: string; description: string; planPath?: string }
  | { kind: "delete"; cardId: string }
  | { kind: "note"; text: string };

export function parseSplitSettle(text: string): SplitSettleOp[];
```

Line formats (exact):

- `TASK create | <title> | <description> [| plan:path]`
- `TASK update | <cardId> | <title> | <description> [| plan:path]`
- `TASK delete | <cardId>`
- `SPLIT note | <text>`

- [ ] **Step 1: Write failing parser tests** covering create/update/delete/note and ignore junk

- [ ] **Step 2: Run — FAIL**

Run: `pnpm --filter @ai-workforce/agent exec vitest run src/parseSplitSettle.test.ts`

- [ ] **Step 3: Implement parser + `ROLE_PROMPTS.splitAlign`**

```ts
splitAlign: [
  "You are Split Bot aligning task breakdown.",
  "When settling, end with protocol lines (no code fence):",
  "TASK create | <title> | <description> [| plan:<relpath>]",
  "TASK update | <cardId> | <title> | <description> [| plan:<relpath>]",
  "TASK delete | <cardId>",
  "SPLIT note | <text>",
  "Only structural lines change the board; notes are comments only.",
].join(" "),
```

Keep existing `split` oneshot prompt; session uses `splitAlign` (sessionRunner / UI role still `split` — map prompt: if session/chat use `splitAlign`, oneshot job keeps `split`).

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/parseSplitSettle.ts packages/agent/src/parseSplitSettle.test.ts \
  packages/agent/src/index.ts packages/agent/src/prompts.ts
git commit -m "$(cat <<'EOF'
feat(agent): parse Split settle protocol and splitAlign prompt

EOF
)"
```

---

### Task 6: `POST /cards/:cardId/split-settle` apply ops

**Files:**
- Modify: `apps/board-api/src/routes.ts`
- Create: `apps/board-api/src/splitSettle.test.ts` (or extend `routes.test.ts`)

**Interfaces:**
- Endpoint body:

```ts
{
  ops: Array<
    | { kind: "create"; title: string; description: string; planPath?: string }
    | { kind: "update"; cardId: string; title: string; description: string; planPath?: string }
    | { kind: "delete"; cardId: string; confirmDelete?: boolean }
    | { kind: "note"; text: string }
  >;
}
```

- Card under settle must be `design` **or** `task` with `designId`. Resolve `designId` = design card id.
- Apply rules from spec §5.3–5.4; any successful create/update/delete → single `markDesignSplitDirty(designId)` at end (or per op — once is enough if any structural success).
- Returns `{ applied: [...], skipped: [...], design: CardRecord }`

- [ ] **Step 1: Failing integration tests** for create→design+frozen, update skip in-flight, delete needs confirm, dirty clears verified

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement route**

Skeleton:

```ts
app.post("/cards/:cardId/split-settle", async (c) => {
  const card = repo.getCard(c.req.param("cardId"));
  // resolve designId
  // for each op: apply / skip with comments
  // if structuralApplied: markDesignSplitDirty(designId)
  // return summary
});
```

Create uses `repo.createCard({ type: "task", column: "design", designId, epicId from design, frozen: true, ... })`.

Update only if target `column === "design"` and same board/`designId`.

Delete: if target not in design and `!confirmDelete` → skip entry in `skipped` with reason (do not 409 whole request); if confirmDelete → delete + structural.

Notes → `addComment` on design or session card.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/board-api/src/routes.ts apps/board-api/src/splitSettle.test.ts
git commit -m "$(cat <<'EOF'
feat(api): apply split-settle ops with in-flight guards

EOF
)"
```

---

### Task 7: Open split session blocks design-jobs; session prompt mapping

**Files:**
- Modify: `apps/board-api/src/routes.ts` (`POST …/design-jobs`)
- Modify: `apps/board-api/src/routes.test.ts`
- Modify: `apps/worker/src/sessionRunner.ts` (use `splitAlign` prompt when `employeeRole === "split"`)

**Interfaces:**
- If `sessions.getOpenSessionForCard(cardId)` exists with `employeeRole === "split"` (or any open session — **spec: open split session**), return 409:

```json
{ "error": "请先结束拆分对齐会话（settle）后再拆分/校验" }
```

- [ ] **Step 1: Failing test** — open split session then design-jobs split → 409

- [ ] **Step 2: Implement check** using existing SessionRepo helpers (add `getOpenSession(cardId, role?)` if needed)

- [ ] **Step 3: sessionRunner maps role `split` → `ROLE_PROMPTS.splitAlign` for chat turns

- [ ] **Step 4: Tests PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: block design-jobs while split session open; use splitAlign in chat

EOF
)"
```

---

### Task 8: Dev `SUMMARY` required before `dev→test`

**Files:**
- Modify: `packages/agent/src/parseOutcome.ts` (+ test)
- Modify: `packages/agent/src/prompts.ts` (`dev` prompt)
- Modify: `packages/agent/src/mock.ts` (dev summary includes `SUMMARY:`)
- Modify: `apps/worker/src/outcomes.ts` (+ test)

**Interfaces:**
- `parseOutcome` adds `summaryLine?: string` from `/^SUMMARY:\s*(.+)$/im`
- Dev case:

```ts
const line = outcome.summaryLine ?? /* fallback: parse SUMMARY from summary string */;
if (!line?.trim()) {
  await client.postComment(ctx.cardId, "bot", "Warning: missing SUMMARY: line; not moving to test");
  return;
}
await client.postComment(ctx.cardId, "bot", `实现总结\n${line.trim()}`);
await client.moveCard(ctx.cardId, "test", "bot");
```

Remove old “any non-empty summary or PR” shortcut as sole gate — require SUMMARY; PR alone is not enough.

- [ ] **Step 1: Failing tests** for parse + outcomes (with SUMMARY moves; without does not)

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(worker): require Dev SUMMARY comment before moving to test

EOF
)"
```

---

### Task 9: Web — API types, SplitChat, CardDrawer pipeline, BoardView

**Files:**
- Modify: `apps/board-web/src/api.ts`
- Create: `apps/board-web/src/SplitChat.tsx`
- Modify: `apps/board-web/src/CardDrawer.tsx`
- Modify: `apps/board-web/src/BoardView.tsx`
- Modify: `apps/board-web/src/styles.css` (only if needed)
- Modify: `apps/board-web/src/ConfirmDialog.tsx` (reuse for delete)

**Interfaces:**
- `Card` includes `splitVerifiedAt: string | null`
- `api.splitSettle(cardId, { ops })`
- `api.deleteCard(cardId, { confirmDelete?: boolean })`
- `SplitChat` props: `{ boardId, card, onSettled?: () => void }` — `employeeRole: "split"`; on settle: `parseSplitSettle(lastAgentText)` → `splitSettle` → `settleSession`
- Design pipeline: show「拆分对齐」opening SplitChat; before split/verify, if latest open session role=split → alert and return
- Copy updates: tasks land in design; dirty / pending verify banners from `!card.splitVerifiedAt` and related tasks frozen
- Task drawer: mount `SplitChat`; if `card.column !== "design"` show in-flight notice; delete button uses ConfirmDialog when not in design

- [ ] **Step 1: Extend `api.ts`**

```ts
splitVerifiedAt?: string | null;
// ...
splitSettle: (cardId: string, body: { ops: unknown[] }) =>
  json(fetch(`${base}/cards/${cardId}/split-settle`, { method: "POST", ... })),
deleteCard: (cardId: string, opts?: { confirmDelete?: boolean }) =>
  json(fetch(`${base}/cards/${cardId}${opts?.confirmDelete ? "?confirmDelete=true" : ""}`, { method: "DELETE" })),
```

Export or duplicate a tiny `parseSplitSettle` in web **or** depend on `@ai-workforce/agent` if already used — prefer importing from agent if Vite already can; else copy thin parser into `parseSplitSettle.ts` under web matching agent (keep agent as source of truth; web may import if package exports allow — check existing `parseBaSettle` pattern in web).

- [ ] **Step 2: Implement `SplitChat.tsx`** by cloning `DesignChat.tsx` structure with role `split`, settle calling split-settle first

- [ ] **Step 3: Wire CardDrawer / BoardView**

Design pipeline order: 拆分任务 → 拆分对齐 → 校验覆盖 → 完成→Done

Update success poll copy: look for tasks in design column.

BoardView: on move failure show `error` string from API; badge `FROZEN` / type already exist — ensure design-column tasks visible.

- [ ] **Step 4: Manual smoke checklist** (document in commit body): new board → design card → split → tasks in design → align settle create → verify → drag to dev

- [ ] **Step 5: Commit**

```bash
git add apps/board-web/src
git commit -m "$(cat <<'EOF'
feat(web): SplitChat alignment and design-column task UX

EOF
)"
```

---

### Task 10: Spec status + regression suite

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-split-align-dev-gate-design.md` (status → 已批准)
- Run full package tests

- [ ] **Step 1: Update spec header status to 已批准（实现计划已就绪 / 用户确认继续）**

- [ ] **Step 2: Run regression**

```bash
pnpm --filter @ai-workforce/domain exec vitest run
pnpm --filter @ai-workforce/agent exec vitest run
pnpm --filter @ai-workforce/board-api exec vitest run
pnpm --filter @ai-workforce/worker exec vitest run
```

Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-10-split-align-dev-gate-design.md
git commit -m "$(cat <<'EOF'
docs: mark split-align design approved

EOF
)"
```

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| Task occupancy includes design | Task 1 |
| Split creates in design + frozen | Task 4 |
| Bot cannot design→dev | Task 1 |
| Human design→dev needs unfrozen + verified | Task 3 |
| Verify pass unfreeze design tasks + set verified | Task 4 |
| Dirty clears verified + re-freeze design tasks | Task 2–3, 6 |
| Split align on design + task (C) | Task 5–6, 9 |
| Protocol create/update/delete/note | Task 5–6 |
| In-flight update skip; delete confirm | Task 3, 6, 9 |
| Open session blocks split/verify | Task 7 |
| Dev SUMMARY short comment | Task 8 |
| UI pipeline / banners / drag errors | Task 9 |
| No back-migrate old dev tasks | Global + Task 4 |
| Re-split appends + dirty | Task 4 (dirty after create) |

## Placeholder / consistency scan

- Field name locked: `splitVerifiedAt` / column `split_verified_at`
- Protocol verbs locked: `TASK create|update|delete`, `SPLIT note`
- Prompt name: `splitAlign` for chat; oneshot remains `split`
- Delete confirm query: `confirmDelete=true`
