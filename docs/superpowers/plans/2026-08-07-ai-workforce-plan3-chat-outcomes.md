# AI Workforce Plan 3: Realtime Design Chat + Role Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete MVP success path: Design sidebar streaming chat (UI↔API↔Worker↔agent) with settle-to-artifacts, plus role outcome automation (Split creates tasks, Verify/Dev/Test/Review apply column rules) on job completion — still no multi-tenant auth.

**Architecture:** Extend `AgentDriver` with `chatStream`. Board API hosts a WebSocket hub; UI and Worker both connect. Sessions persist in SQLite; active sessions block poll jobs for that card. After oneshot `completeJob`, Worker runs `applyRoleOutcome` which parses structured lines from the summary and calls Board APIs (`createCard`, `move`, `test-result`) under actor `bot` where gates allow.

**Tech Stack:** Existing Plan 1–2 stack + Hono WebSocket (`ws` / `@hono/node-ws` as needed), Cursor `Agent.create`+`send`+`stream` for chat (Mock stream for tests).

## Global Constraints

- AI execution remains local (`cwd` = board `workspacePath`)
- Human gates unchanged: `design → split` and `accept → done` require human; bots must not bypass
- Test fail → `applyTestFailure` / existing `/cards/:id/test-result`; freeze at `reworkCount >= 3`
- Active Session on a card ⇒ skip poll job creation and skip claim for that card (Plan 2 poll “any prior job” rule still applies)
- Design truth stays in workspace files; settle only writes ArtifactRefs + optional comment
- Streaming chat required for Design (and usable on epic in `design` column); deep “open Cursor IDE UI” is **out of scope** (YAGNI — chatStream + oneshot enough)
- Split output must create `task` cards in `dev` with `epicId`; then bot-move epic `split → verify`
- Verify pass: bot-move epic `verify` stays or archive comment; tasks already in `dev` — if none, fail with comment. Verify fail: bot-move epic `verify → split`
- Dev success with PR artifact: bot-move task `dev → test`
- Test: parse `TEST pass|fail` from summary → call test-result API (not raw column hacks)
- Review: artifacts/comments only — **never** move to Done
- Tests pass without `CURSOR_API_KEY` (Mock driver/stream)
- Do not break Plan 2 smoke (`plan2-smoke.sh` still green)

## Scope map

| Plan | Status |
|------|--------|
| Plan 1 Board | done |
| Plan 2 Worker oneshot | done |
| **Plan 3 (this)** | chat + sessions + role outcomes |
| Later | Cursor IDE deep-link, lock TTL, multi-worker HA |

## File structure (locked in)

```text
packages/agent/
  src/types.ts              # add chatStream to AgentDriver
  src/parseOutcome.ts       # TASK / VERIFY / TEST lines
  src/parseOutcome.test.ts
  src/mock.ts               # chatStream yields deltas
  src/cursor.ts             # chatStream via Agent.create
  src/prompts.ts            # strengthen role prompts with outcome line formats
packages/domain/            # no change unless tiny helpers needed
apps/board-api/
  src/db.ts                 # sessions, session_messages tables
  src/sessions.ts           # SessionRepo
  src/wsHub.ts              # WebSocket fan-out
  src/routes.ts             # session REST + wire hub
  src/index.ts              # attach WS upgrade
  src/sessions.test.ts
  src/repo.ts               # listClaimableJobs / createPollJobs skip active session cards
apps/worker/
  src/sessionRunner.ts      # handle chat turns
  src/outcomes.ts           # applyRoleOutcome
  src/outcomes.test.ts
  src/executor.ts           # call applyRoleOutcome after completeJob
  src/boardClient.ts        # session + createCard + move + test-result helpers
  src/index.ts              # WS client loop alongside tick
apps/board-web/
  src/DesignChat.tsx        # streaming panel in drawer for epic@design
  src/api.ts / CardDrawer.tsx
scripts/plan3-smoke.sh
README.md
```

---

### Task 1: Outcome line parsers + prompt updates

**Files:**
- Create: `packages/agent/src/parseOutcome.ts`
- Create: `packages/agent/src/parseOutcome.test.ts`
- Modify: `packages/agent/src/prompts.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
```ts
export type ParsedTask = { title: string; description: string };
export type ParsedOutcome = {
  tasks: ParsedTask[];
  verify?: "pass" | "fail";
  test?: "pass" | "fail";
};
export function parseOutcome(summary: string): ParsedOutcome;
```

Line formats (exact):
- `TASK <title> | <description>` (description may be empty)
- `VERIFY pass` | `VERIFY fail`
- `TEST pass` | `TEST fail`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { parseOutcome } from "./parseOutcome.js";

describe("parseOutcome", () => {
  it("parses TASK lines", () => {
    const o = parseOutcome("TASK Login API | implement oauth\nTASK UI | forms");
    expect(o.tasks).toEqual([
      { title: "Login API", description: "implement oauth" },
      { title: "UI", description: "forms" },
    ]);
  });

  it("parses VERIFY and TEST", () => {
    expect(parseOutcome("VERIFY pass").verify).toBe("pass");
    expect(parseOutcome("TEST fail").test).toBe("fail");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @ai-workforce/agent test
```

- [ ] **Step 3: Implement parseOutcome; update ROLE_PROMPTS** to require those trailing lines for split/verify/dev/test roles (keep ARTIFACT lines from Plan 2).

- [ ] **Step 4: Tests PASS + commit**

```bash
git add packages/agent
git commit -m "feat(agent): parse role outcome lines for tasks and gates"
```

---

### Task 2: Sessions schema + poll/claim skip

**Files:**
- Modify: `apps/board-api/src/db.ts`
- Create: `apps/board-api/src/sessions.ts`
- Modify: `apps/board-api/src/repo.ts` (`createPollJobs`, `listClaimableJobs`, `claimJob`)
- Create: `apps/board-api/src/sessions.test.ts`
- Modify: `apps/board-api/src/repo.test.ts`

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  employee_role TEXT NOT NULL DEFAULT 'design',
  status TEXT NOT NULL, -- open | closed
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL, -- user | assistant | system
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

**SessionRepo:** `createSession`, `getOpenSessionForCard`, `appendMessage`, `listMessages`, `closeSession`, `listOpenSessionCardIds(boardId)`.

**Skip rule:** if `card_id` has `sessions.status='open'`, treat like locked for poll/claim.

- [ ] **Step 1: Tests** — open session blocks `claimJob` / `createPollJobs` for that card.

- [ ] **Step 2: Implement + PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(board-api): add chat sessions and skip poll while session open"
```

---

### Task 3: AgentDriver.chatStream (Mock + Cursor)

**Files:**
- Modify: `packages/agent/src/types.ts`
- Modify: `packages/agent/src/mock.ts` + tests
- Modify: `packages/agent/src/cursor.ts` + tests
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
```ts
export type ChatInput = {
  workspacePath: string;
  role: string;
  cardId: string;
  boardId: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
};

export interface AgentDriver {
  oneshot(input: RunInput): Promise<RunResult>;
  chatStream(input: ChatInput): AsyncIterable<AgentEvent>;
}
```

**Mock:** yield a few `text_delta` chunks then `done` with summary including optional `ARTIFACT file docs/aiw/chat-mock.md Mock chat`.

**Cursor:** `Agent.create({ local: { cwd } })` → `send(composedPrompt)` → `for await (event of run.stream())` map assistant text to `text_delta`; on end `done` with concatenated text + `parseArtifactHints`. Use `await using` / dispose. On error yield `{ type: "error" }`.

- [ ] **Step 1: Failing mock chatStream test**

- [ ] **Step 2: Implement both drivers (cursor with vi.mock)**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(agent): add chatStream to MockDriver and CursorDriver"
```

---

### Task 4: WebSocket hub + session HTTP API

**Files:**
- Create: `apps/board-api/src/wsHub.ts`
- Modify: `apps/board-api/src/routes.ts`
- Modify: `apps/board-api/src/index.ts`
- Modify: `apps/board-api/package.json` (add `ws` if needed)
- Create: `apps/board-api/src/wsHub.test.ts` (unit test hub fan-out without full browser)

**REST:**
- `POST /boards/:boardId/cards/:cardId/sessions` → `{ id }` (role default design; 409 if open session exists)
- `GET /sessions/:sessionId/messages`
- `POST /sessions/:sessionId/close`
- `POST /sessions/:sessionId/settle` body `{ artifacts?: ArtifactRef[], comment?: string }` — merge artifacts on card, append comment, close session

**WS protocol** (JSON messages):
```ts
type WsClientMsg =
  | { type: "hello"; role: "ui" | "worker"; boardId: string; workerId?: string }
  | { type: "session.user_message"; sessionId: string; text: string }
  | { type: "session.agent_delta"; sessionId: string; text: string } // worker → hub
  | { type: "session.agent_done"; sessionId: string; summary: string }
  | { type: "session.agent_error"; sessionId: string; message: string };

type WsServerMsg =
  | { type: "session.user_message"; sessionId: string; cardId: string; text: string } // to worker
  | { type: "session.agent_delta"; sessionId: string; text: string } // to ui
  | { type: "session.agent_done"; sessionId: string; summary: string }
  | { type: "session.agent_error"; sessionId: string; message: string }
  | { type: "error"; message: string };
```

Flow:
1. UI creates session via REST, connects WS, sends `session.user_message`
2. Hub persists user message, fans out to worker sockets on same boardId
3. Worker runs chatStream, sends deltas/done back
4. Hub persists assistant final on done, fans out to UI sockets

Use `@hono/node-server` + `ws` Server upgrade pattern. Keep hub in-memory Map; OK for single-process MVP.

- [ ] **Step 1: Hub unit test** (subscribe/broadcast)

- [ ] **Step 2: Wire REST + WS in index**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(board-api): WebSocket hub and design session APIs"
```

---

### Task 5: Worker session runner + outcomes wiring prep

**Files:**
- Create: `apps/worker/src/sessionRunner.ts`
- Create: `apps/worker/src/wsClient.ts`
- Modify: `apps/worker/src/boardClient.ts`
- Modify: `apps/worker/src/index.ts`
- Create: `apps/worker/src/sessionRunner.test.ts` (mock driver + fake send)

**Behavior:**
- On `session.user_message`: load board/card, build history from REST messages, `driver.chatStream`, forward deltas; on done POST nothing extra if hub persists from worker messages (worker sends agent_done; hub stores).
- Prefer: hub stores user messages; worker sends deltas; on done hub stores assistant summary from `session.agent_done`.

- [ ] **Step 1: Test sessionRunner emits deltas then done**

- [ ] **Step 2: Implement WS client loop in index alongside `tick` (Promise.race / parallel)**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(worker): handle design session chat over WebSocket"
```

---

### Task 6: board-web DesignChat UI

**Files:**
- Create: `apps/board-web/src/DesignChat.tsx`
- Modify: `apps/board-web/src/CardDrawer.tsx`
- Modify: `apps/board-web/src/api.ts`
- Modify: `apps/board-web/vite.config.ts` — proxy `/ws` to API with `ws: true`

**UI (epic + column design only):**
- Button「开始对齐」→ create session
- Chat transcript + input
- Stream assistant deltas
- 「沉淀结论」→ settle with artifacts parsed client-side from last summary `ARTIFACT` lines **or** settle empty + comment “settled from chat” (prefer parse last assistant message for ARTIFACT lines using shared logic duplicated lightly or inline regex matching Plan 2)

No unit tests required for UI (same Plan 1 option A spirit); manual + smoke covers.

- [ ] **Step 1: Implement DesignChat + wire drawer**

- [ ] **Step 2: `pnpm --filter @ai-workforce/board-web build` PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(board-web): design sidebar streaming chat and settle"
```

---

### Task 7: applyRoleOutcome after job complete

**Files:**
- Create: `apps/worker/src/outcomes.ts`
- Create: `apps/worker/src/outcomes.test.ts`
- Modify: `apps/worker/src/executor.ts`
- Modify: `apps/worker/src/boardClient.ts` — `createCard`, `moveCard`, `postTestResult`, `listCards`

**applyRoleOutcome(role, summary, ctx):**

| role | actions |
|------|---------|
| `design` | none beyond Plan 2 artifacts (human moves) |
| `split` | `parseOutcome.tasks` → each `createCard({ type:'task', column:'dev', epicId })`; `moveCard(epic, 'verify', bot)` — **epic must be in split**; if move fails, comment error |
| `verify` | if `verify==='pass'`: comment “coverage ok” (tasks already in dev); if `fail`: `moveCard(epic,'split', bot)` + comment; if missing VERIFY line: failJob already done — comment warn |
| `dev` | if artifacts has `pr` or summary ok: `moveCard(task,'test', bot)` |
| `test` | if `test==='pass'`: `postTestResult(true)`; if `fail`: `postTestResult(false)`; if missing: comment warn, no move |
| `review` | comment only |

Use existing domain gates via API (`actor: "bot"`).

Enrich `buildPrompt` for split: BoardClient should pass requirement titles — extend executor to fetch sibling requirements by `epicId` and append to prompt (modify `buildPrompt` or wrap).

- [ ] **Step 1: outcomes.test.ts with fake BoardClient**

- [ ] **Step 2: Wire executor after successful completeJob**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(worker): apply role outcomes for split/verify/dev/test"
```

---

### Task 8: plan3-smoke + README

**Files:**
- Create: `scripts/plan3-smoke.sh`
- Modify: `README.md`

**Smoke (Mock driver, API+worker once paths):**

1. Start API (document prerequisite)
2. Create board, epic in `design`, 2 requirements with `epicId`
3. Human-approve move is N/A yet — put epic directly in `split` for automation segment **or** create epic in split
4. Create mention job for Split via comment `@Split Bot go` on epic in split
5. Run `pnpm --filter @ai-workforce/worker exec tsx src/once.ts` with MockDriver — **extend MockDriver oneshot** for role `split` to return TASK lines + ARTIFACT (update Mock in Task 1 or 7 if needed so smoke works)

MockDriver role-aware canned summaries:

```ts
if (input.role === "split") {
  summary = `TASK A | do a\nTASK B | do b\nARTIFACT file docs/aiw/breakdown.md Breakdown`;
}
if (input.role === "verify") summary = `VERIFY pass\nARTIFACT file docs/aiw/coverage.md Coverage`;
if (input.role === "dev") summary = `ARTIFACT pr https://example.com/pr/1 PR`;
if (input.role === "test") summary = `TEST pass\nARTIFACT file docs/aiw/test.md Test`;
```

6. Assert ≥2 task cards in `dev`, epic column `verify`
7. Optional second once for verify mention

Also ensure `plan2-smoke.sh` still passes.

- [ ] **Step 1: Update MockDriver role canned outputs if not done**

- [ ] **Step 2: Write and run plan3-smoke.sh**

- [ ] **Step 3: README Plan 3 section + commit**

```bash
git commit -m "feat: add Plan 3 smoke and runbook for chat and role outcomes"
```

---

## Self-review

### Spec coverage

| Spec § | Task |
|--------|------|
| Design sidebar streaming | 3–6 |
| Settle artifacts | 4 settle API + 6 UI |
| Session blocks poll | 2 |
| Split → tasks + verify | 1, 7, 8 |
| Verify pass/fail | 7 |
| Dev → test | 7 |
| Test pass/fail + freeze | 7 via test-result |
| Review no Done | 7 |
| Human gates preserved | 7 uses bot only where allowed |
| Open Cursor IDE | explicitly out |

### Placeholder scan

No TBD. WS library: prefer `ws` with Node upgrade; if `@hono/node-ws` fits existing Hono version, use it — implementer picks one and pins in package.json.

### Type consistency

- `AgentEvent` reused for chatStream
- Artifact shapes match Plan 2
- Bot moves go through existing `/cards/:id/move`

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-ai-workforce-plan3-chat-outcomes.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task + reviews  
2. **Inline Execution** — this session with checkpoints  

**Which approach?**
