# AI Workforce Plan 2: Worker + Cursor Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a local Worker daemon that claims Board Jobs, runs them through an AgentDriver (Mock for tests, Cursor local oneshot for real), and writes comments / ArtifactRefs back — without WebSocket streaming or full role-bot automation (Plan 3).

**Architecture:** Extend `board-api` with job claim/complete/fail + card execution locks. Add `packages/agent` with `AgentDriver` interface, `MockDriver`, and `CursorDriver` (`@cursor/sdk` `Agent.prompt` local). `apps/worker` polls the API, claims open jobs (and optionally creates poll-trigger jobs from watched columns), executes oneshot runs, writes back. Streaming chat / “open in Cursor UI” deferred to Plan 3.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Hono (existing), `@cursor/sdk`, Node 22+.

## Global Constraints

- AI execution only on the local machine (Cursor `local: { cwd: workspacePath }`)
- One Board ↔ one `workspacePath` (from Plan 1)
- Job failure → comment + keep column (no auto column change in Plan 2)
- Frozen cards: never claim / never create poll jobs
- Active card lock: at most one running job per `card_id`; skip locked cards when polling
- MVP adapter config: only `cursor` (plus `mock` for tests)
- No WebSocket, no sidebar streaming, no Split/Verify task-card generation (Plan 3)
- Role prompts are config strings; Plan 2 runs a **generic oneshot** for the mentioned/watched employee role and parses artifact hints from the result text
- Tests must pass without `CURSOR_API_KEY` (use MockDriver); CursorDriver covered by unit test with injected stub or skipped integration unless key present
- Follow existing Plan 1 patterns: ESM `.js` imports, Vitest, workspace packages

## Scope relative to Plan 1 / Plan 3

| Plan | Delivers |
|------|----------|
| Plan 1 (done) | Domain + Board API + Kanban UI + `@` → open Job |
| **Plan 2 (this)** | Job lifecycle API, locks, Worker, AgentDriver, Cursor oneshot writeback, column poll → Job |
| Plan 3 (next) | WebSocket chat bridge, Design sidebar, Split/Verify/Dev/Test/Review automation + auto column moves |

## File structure (locked in)

```text
packages/agent/
  package.json
  tsconfig.json
  vitest.config.ts
  src/types.ts              # AgentDriver, AgentEvent, RunInput, RunResult
  src/parse.ts              # parseArtifactHints from summary text
  src/mock.ts               # MockDriver
  src/cursor.ts             # CursorDriver (Agent.prompt)
  src/prompts.ts            # ROLE_PROMPTS map
  src/index.ts
  src/parse.test.ts
  src/mock.test.ts
apps/board-api/
  src/db.ts                 # migrate: locks + job status fields
  src/repo.ts               # claimJob, completeJob, failJob, lock helpers
  src/routes.ts             # worker endpoints
  src/repo.test.ts / routes.test.ts  # extend
apps/worker/
  package.json
  tsconfig.json
  vitest.config.ts
  src/config.ts
  src/boardClient.ts
  src/executor.ts           # claim → driver → writeback
  src/poller.ts             # create poll jobs from watch columns
  src/loop.ts
  src/index.ts
  src/executor.test.ts
  src/poller.test.ts
README.md                   # add worker runbook
scripts/plan2-smoke.sh      # MockDriver end-to-end against API
```

---

### Task 1: `packages/agent` — types, parse, MockDriver

**Files:**
- Create: `packages/agent/package.json`
- Create: `packages/agent/tsconfig.json`
- Create: `packages/agent/vitest.config.ts`
- Create: `packages/agent/src/types.ts`
- Create: `packages/agent/src/parse.ts`
- Create: `packages/agent/src/parse.test.ts`
- Create: `packages/agent/src/mock.ts`
- Create: `packages/agent/src/mock.test.ts`
- Create: `packages/agent/src/prompts.ts`
- Create: `packages/agent/src/index.ts`

**Interfaces:**
- Consumes: nothing from board-api
- Produces:
  ```ts
  export type AgentEvent =
    | { type: "text_delta"; text: string }
    | { type: "artifact_hint"; kind: "file" | "url" | "pr"; href: string; label?: string }
    | { type: "done"; summary: string }
    | { type: "error"; message: string };

  export type RunInput = {
    workspacePath: string;
    prompt: string;
    role: string;
    cardId: string;
    boardId: string;
  };

  export type RunResult = {
    status: "ok" | "error";
    summary: string;
    artifacts: Array<{ kind: "file" | "url" | "pr"; href: string; label?: string }>;
  };

  export interface AgentDriver {
    readonly id: string;
    readonly displayName: string;
    oneshot(input: RunInput): Promise<RunResult>;
  }

  export function parseArtifactHints(text: string): RunResult["artifacts"];
  export class MockDriver implements AgentDriver;
  export const ROLE_PROMPTS: Record<string, string>;
  ```

- [ ] **Step 1: Write failing parse + mock tests**

`packages/agent/src/parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseArtifactHints } from "./parse.js";

describe("parseArtifactHints", () => {
  it("extracts ARTIFACT lines", () => {
    const text = [
      "Did the design.",
      "ARTIFACT file docs/design/auth.md Design doc",
      "ARTIFACT pr https://github.com/acme/app/pull/1 Login PR",
      "done",
    ].join("\n");
    expect(parseArtifactHints(text)).toEqual([
      { kind: "file", href: "docs/design/auth.md", label: "Design doc" },
      { kind: "pr", href: "https://github.com/acme/app/pull/1", label: "Login PR" },
    ]);
  });

  it("returns empty when none", () => {
    expect(parseArtifactHints("no artifacts here")).toEqual([]);
  });
});
```

`packages/agent/src/mock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MockDriver } from "./mock.js";

describe("MockDriver", () => {
  it("returns canned summary and parsed artifacts", async () => {
    const d = new MockDriver();
    const result = await d.oneshot({
      workspacePath: "/tmp/ws",
      prompt: "design please",
      role: "design",
      cardId: "c1",
      boardId: "b1",
    });
    expect(result.status).toBe("ok");
    expect(result.artifacts.some((a) => a.kind === "file")).toBe(true);
    expect(result.summary.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
# after creating package.json, from repo root:
pnpm install
pnpm --filter @ai-workforce/agent test
```

Expected: FAIL (modules missing) or package not found until Step 3.

- [ ] **Step 3: Implement package**

`packages/agent/package.json`:

```json
{
  "name": "@ai-workforce/agent",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@cursor/sdk": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  }
}
```

Note: If `@cursor/sdk` version resolution differs, pin to whatever `pnpm add @cursor/sdk` resolves; CursorDriver can lazy-import so Mock tests work even if SDK install is awkward — prefer listing dependency and implementing Cursor in Task 5.

`packages/agent/tsconfig.json` — same pattern as domain (`extends ../../tsconfig.base.json`, `outDir: dist`, `rootDir: src`).

`packages/agent/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

`packages/agent/src/types.ts`:

```ts
export type ArtifactHint = {
  kind: "file" | "url" | "pr";
  href: string;
  label?: string;
};

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "artifact_hint"; kind: ArtifactHint["kind"]; href: string; label?: string }
  | { type: "done"; summary: string }
  | { type: "error"; message: string };

export type RunInput = {
  workspacePath: string;
  prompt: string;
  role: string;
  cardId: string;
  boardId: string;
};

export type RunResult = {
  status: "ok" | "error";
  summary: string;
  artifacts: ArtifactHint[];
};

export interface AgentDriver {
  readonly id: string;
  readonly displayName: string;
  oneshot(input: RunInput): Promise<RunResult>;
}
```

`packages/agent/src/parse.ts`:

```ts
import type { ArtifactHint } from "./types.js";

const LINE =
  /^ARTIFACT\s+(file|url|pr)\s+(\S+)(?:\s+(.+))?$/i;

export function parseArtifactHints(text: string): ArtifactHint[] {
  const out: ArtifactHint[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(LINE);
    if (!m) continue;
    out.push({
      kind: m[1]!.toLowerCase() as ArtifactHint["kind"],
      href: m[2]!,
      label: m[3]?.trim() || undefined,
    });
  }
  return out;
}
```

`packages/agent/src/prompts.ts`:

```ts
export const ROLE_PROMPTS: Record<string, string> = {
  design:
    "You are Design Bot. Produce or update design docs under docs/ in the workspace. End with lines: ARTIFACT file <relpath> <label>",
  split:
    "You are Split Bot. Propose task breakdown in a markdown file. End with ARTIFACT file lines.",
  verify:
    "You are Verify Bot. Check coverage of requirements vs tasks/design. Write coverage-check.md. End with ARTIFACT file lines.",
  dev: "You are Dev Bot. Implement the task. Prefer opening a PR. End with ARTIFACT pr <url> <label> when possible.",
  test: "You are Test Bot. Run/verify tests and write a short report. End with ARTIFACT file or url lines.",
  review:
    "You are Review Bot. Write acceptance notes. End with ARTIFACT file lines. Do not mark Done.",
};

export function buildPrompt(role: string, card: {
  title: string;
  description: string;
  column: string;
}): string {
  const base = ROLE_PROMPTS[role] ?? "You are an AI employee assisting on a kanban card.";
  return [
    base,
    "",
    `Card title: ${card.title}`,
    `Column: ${card.column}`,
    `Description: ${card.description}`,
    "",
    "When you create or update files, list them as:",
    "ARTIFACT file <relative-path> <optional label>",
    "ARTIFACT pr <url> <optional label>",
    "ARTIFACT url <url> <optional label>",
  ].join("\n");
}
```

`packages/agent/src/mock.ts`:

```ts
import { parseArtifactHints } from "./parse.js";
import type { AgentDriver, RunInput, RunResult } from "./types.js";

export class MockDriver implements AgentDriver {
  readonly id = "mock";
  readonly displayName = "Mock Driver";

  async oneshot(input: RunInput): Promise<RunResult> {
    const summary = [
      `Mock ${input.role} completed for card ${input.cardId}.`,
      `ARTIFACT file docs/aiw/${input.role}-${input.cardId}.md Mock output`,
    ].join("\n");
    return {
      status: "ok",
      summary,
      artifacts: parseArtifactHints(summary),
    };
  }
}
```

`packages/agent/src/index.ts`:

```ts
export * from "./types.js";
export * from "./parse.js";
export * from "./mock.js";
export * from "./prompts.js";
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm install
pnpm --filter @ai-workforce/agent test
pnpm --filter @ai-workforce/agent build
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent pnpm-lock.yaml
git commit -m "feat(agent): add AgentDriver types, parse hints, and MockDriver"
```

---

### Task 2: Board API — job claim lifecycle + card lock

**Files:**
- Modify: `apps/board-api/src/db.ts`
- Modify: `apps/board-api/src/repo.ts`
- Modify: `apps/board-api/src/repo.test.ts`
- Modify: `apps/board-api/src/routes.ts`
- Modify: `apps/board-api/src/routes.test.ts`

**Interfaces:**
- Consumes: existing `BoardRepo`
- Produces:
  - Schema adds: `cards.locked_job_id TEXT`, `cards.locked_at TEXT`; jobs: `error TEXT`, `finished_at TEXT`; status ∈ `open|claimed|done|failed`
  - `claimJob(jobId, workerId): JobRecord | null` — atomic open→claimed if card unlocked and not frozen
  - `completeJob(jobId, { summary, artifacts })` — unlock, status done, merge artifacts, add comment
  - `failJob(jobId, message)` — unlock, status failed, comment
  - `listClaimableJobs(boardId)` — open jobs whose card not frozen and not locked
  - Routes:
    - `POST /jobs/:jobId/claim` body `{ workerId }`
    - `POST /jobs/:jobId/complete` body `{ summary, artifacts }`
    - `POST /jobs/:jobId/fail` body `{ message }`
    - `GET /boards/:boardId/jobs/claimable`
    - `POST /boards/:boardId/poll-jobs` body optional — creates open jobs for idle cards in each employee watch column (used by worker); skip frozen/locked/already-open-job-for-same-employee+card

- [ ] **Step 1: Write failing repo/route tests for claim**

Add to `apps/board-api/src/repo.test.ts`:

```ts
  it("claims a job and locks the card; second claim fails", () => {
    const repo = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "design",
      description: "",
    });
    const emp = repo.listEmployees(board.id).find((e) => e.role === "design")!;
    const job = repo.createJob({
      boardId: board.id,
      cardId: epic.id,
      employeeId: emp.id,
      trigger: "mention",
    });
    const claimed = repo.claimJob(job.id, "worker-1");
    expect(claimed?.status).toBe("claimed");
    expect(repo.getCard(epic.id)?.lockedJobId).toBe(job.id);
    expect(repo.claimJob(job.id, "worker-2")).toBeNull();
  });

  it("completeJob writes artifacts and unlocks", () => {
    const repo = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "design",
      description: "",
    });
    const emp = repo.listEmployees(board.id).find((e) => e.role === "design")!;
    const job = repo.createJob({
      boardId: board.id,
      cardId: epic.id,
      employeeId: emp.id,
      trigger: "mention",
    });
    repo.claimJob(job.id, "worker-1");
    repo.completeJob(job.id, {
      summary: "done",
      artifacts: [{ kind: "file", href: "docs/a.md", label: "A" }],
    });
    const card = repo.getCard(epic.id)!;
    expect(card.lockedJobId).toBeNull();
    expect(card.artifacts[0]?.href).toBe("docs/a.md");
    expect(repo.listComments(epic.id).some((c) => c.body.includes("done"))).toBe(
      true,
    );
  });
```

Add route test claiming via HTTP similarly (create board → comment @Bot → claim → complete).

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @ai-workforce/domain build
pnpm --filter @ai-workforce/board-api test
```

Expected: FAIL missing `claimJob`

- [ ] **Step 3: Implement migrate + repo methods**

In `migrate`, after existing `CREATE TABLE` blocks, run additive migrations safe for existing DBs:

```ts
  // Additive columns (ignore errors if exist — use try/pragma table_info)
```

Prefer explicit helper:

```ts
function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  decl: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

// in migrate after CREATE IF NOT EXISTS:
ensureColumn(db, "cards", "locked_job_id", "TEXT");
ensureColumn(db, "cards", "locked_at", "TEXT");
ensureColumn(db, "jobs", "error", "TEXT");
ensureColumn(db, "jobs", "finished_at", "TEXT");
ensureColumn(db, "jobs", "worker_id", "TEXT");
```

Update `getCard` mapping to include `lockedJobId: string | null` and `lockedAt: string | null`.

Implement `claimJob` inside a transaction:

```ts
claimJob(jobId: string, workerId: string): JobRecord | null {
  const claim = this.db.transaction(() => {
    const job = this.db
      .prepare(`SELECT * FROM jobs WHERE id = ?`)
      .get(jobId) as { id: string; status: string; card_id: string; board_id: string; employee_id: string } | undefined;
    if (!job || job.status !== "open") return null;
    const card = this.getCard(job.card_id);
    if (!card || card.frozen || card.lockedJobId) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE jobs SET status='claimed', claimed_at=?, worker_id=? WHERE id=? AND status='open'`,
      )
      .run(now, workerId, jobId);
    this.db
      .prepare(
        `UPDATE cards SET locked_job_id=?, locked_at=?, updated_at=? WHERE id=?`,
      )
      .run(jobId, now, now, job.card_id);
    return this.getJob(jobId);
  });
  return claim();
}
```

`completeJob` / `failJob`: set job status, clear lock, append artifacts (complete only), add comment from employee display name or `"bot"`.

`listClaimableJobs`:

```sql
SELECT j.id FROM jobs j
JOIN cards c ON c.id = j.card_id
WHERE j.board_id = ? AND j.status = 'open'
  AND c.frozen = 0
  AND (c.locked_job_id IS NULL OR c.locked_job_id = '')
ORDER BY j.created_at
```

`createPollJobs(boardId)`: for each employee, for each watch column, list cards in that column on board; for each card if not frozen/locked and no open/claimed job for (card, employee), `createJob({ trigger: "poll" })`. Return count created.

Wire routes accordingly.

- [ ] **Step 4: Tests PASS + commit**

```bash
pnpm --filter @ai-workforce/board-api test
git add apps/board-api
git commit -m "feat(board-api): claim/complete/fail jobs with card locks"
```

---

### Task 3: Worker package — config + BoardClient

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/vitest.config.ts`
- Create: `apps/worker/src/config.ts`
- Create: `apps/worker/src/boardClient.ts`
- Create: `apps/worker/src/boardClient.test.ts` (mock fetch)

**Interfaces:**
- Consumes: board-api HTTP
- Produces:
  ```ts
  export type WorkerConfig = {
    apiBase: string;       // default http://127.0.0.1:8787
    boardId: string;
    workerId: string;
    driver: "mock" | "cursor";
    pollIntervalMs: number;
    cursorApiKey?: string;
    modelId: string;       // default composer-2.5
  };
  export function loadConfig(env: NodeJS.ProcessEnv): WorkerConfig;
  export class BoardClient {
    listClaimableJobs(): Promise<Job[]>;
    claimJob(jobId: string): Promise<Job | null>;
    completeJob(jobId: string, body: {...}): Promise<void>;
    failJob(jobId: string, message: string): Promise<void>;
    getBoard(): Promise<{ workspacePath: string }>;
    getCard(cardId: string): Promise<Card>;
    getEmployee(employeeId: string): Promise<Employee>;
    createPollJobs(): Promise<{ created: number }>;
  }
  ```

- [ ] **Step 1: Failing test for loadConfig**

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("requires AIW_BOARD_ID", () => {
    expect(() =>
      loadConfig({ AIW_API_BASE: "http://127.0.0.1:8787" }),
    ).toThrow(/AIW_BOARD_ID/);
  });

  it("defaults driver to mock", () => {
    const c = loadConfig({
      AIW_BOARD_ID: "b1",
      AIW_API_BASE: "http://127.0.0.1:8787",
    });
    expect(c.driver).toBe("mock");
    expect(c.workerId).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement config + BoardClient**

`apps/worker/package.json`:

```json
{
  "name": "@ai-workforce/worker",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@ai-workforce/agent": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.13.4",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  }
}
```

`loadConfig` reads: `AIW_API_BASE`, `AIW_BOARD_ID`, `AIW_WORKER_ID` (default `os.hostname()+pid`), `AIW_DRIVER` (`mock`|`cursor`), `AIW_POLL_INTERVAL_MS` (default `5000`), `CURSOR_API_KEY`, `AIW_MODEL_ID` (default `composer-2.5`).

`BoardClient` uses `fetch` against `apiBase`.

- [ ] **Step 3: Tests PASS + commit**

```bash
pnpm install
pnpm --filter @ai-workforce/worker test
git add apps/worker pnpm-lock.yaml
git commit -m "feat(worker): add config and BoardClient"
```

---

### Task 4: Worker executor + loop (MockDriver)

**Files:**
- Create: `apps/worker/src/executor.ts`
- Create: `apps/worker/src/executor.test.ts`
- Create: `apps/worker/src/loop.ts`
- Create: `apps/worker/src/index.ts`
- Modify: root `package.json` — add `"dev:worker": "pnpm --filter @ai-workforce/worker dev"`

**Interfaces:**
- Consumes: `BoardClient`, `AgentDriver`, `buildPrompt`
- Produces:
  ```ts
  export async function executeClaimedJob(
    client: BoardClient,
    driver: AgentDriver,
    job: { id: string; cardId: string; employeeId: string; boardId: string },
  ): Promise<void>;

  export async function tick(
    client: BoardClient,
    driver: AgentDriver,
    opts: { createPollJobs: boolean },
  ): Promise<{ claimed: number; pollCreated: number }>;
  ```

Behavior:
1. Optionally `createPollJobs`
2. `listClaimableJobs` → for each, `claimJob` → if claimed, `executeClaimedJob`
3. Executor loads board/card/employee, builds prompt, `driver.oneshot`, on ok `completeJob` with summary+artifacts, on throw/error `failJob`

- [ ] **Step 1: Write executor test with fake client + MockDriver**

```ts
import { describe, expect, it, vi } from "vitest";
import { MockDriver } from "@ai-workforce/agent";
import { executeClaimedJob } from "./executor.js";

describe("executeClaimedJob", () => {
  it("completes with artifacts from mock driver", async () => {
    const completeJob = vi.fn(async () => {});
    const client = {
      getBoard: async () => ({ workspacePath: "/tmp/ws" }),
      getCard: async () => ({
        id: "c1",
        title: "T",
        description: "D",
        column: "design",
        frozen: false,
        artifacts: [],
      }),
      getEmployee: async () => ({
        id: "e1",
        role: "design",
        displayName: "Design Bot",
      }),
      completeJob,
      failJob: vi.fn(async () => {}),
    };
    await executeClaimedJob(client as never, new MockDriver(), {
      id: "j1",
      cardId: "c1",
      employeeId: "e1",
      boardId: "b1",
    });
    expect(completeJob).toHaveBeenCalledOnce();
    const body = completeJob.mock.calls[0]![1];
    expect(body.artifacts.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement executor + loop + index**

`index.ts`:

```ts
import { MockDriver } from "@ai-workforce/agent";
import { loadConfig } from "./config.js";
import { BoardClient } from "./boardClient.js";
import { tick } from "./loop.js";
// CursorDriver imported dynamically when driver===cursor (Task 5)

const config = loadConfig(process.env);
const client = new BoardClient(config);
const driver = new MockDriver(); // Task 5 replaces selection

async function main() {
  console.log(`worker ${config.workerId} board=${config.boardId} driver=${config.driver}`);
  for (;;) {
    const r = await tick(client, driver, { createPollJobs: true });
    if (r.claimed || r.pollCreated) {
      console.log(r);
    }
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Tests PASS + commit**

```bash
pnpm --filter @ai-workforce/agent build
pnpm --filter @ai-workforce/worker test
git add apps/worker package.json
git commit -m "feat(worker): execute claimed jobs with MockDriver loop"
```

---

### Task 5: CursorDriver

**Files:**
- Create: `packages/agent/src/cursor.ts`
- Create: `packages/agent/src/cursor.test.ts` (stub/mock module)
- Modify: `packages/agent/src/index.ts`
- Modify: `apps/worker/src/index.ts` — select driver by config
- Modify: `packages/agent/package.json` if SDK version needs adjust

**Interfaces:**
- Produces: `export class CursorDriver implements AgentDriver`
- Uses `@cursor/sdk` `Agent.prompt(message, { apiKey, model: { id }, local: { cwd: workspacePath } })`
- Maps result text → `parseArtifactHints`; on SDK throw → `{ status: "error", summary, artifacts: [] }`

- [ ] **Step 1: Write test with vi.mock**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@cursor/sdk", () => ({
  Agent: {
    prompt: vi.fn(async () => ({
      status: "finished",
      result: "ok\nARTIFACT file docs/x.md X",
    })),
  },
}));

import { Agent } from "@cursor/sdk";
import { CursorDriver } from "./cursor.js";

describe("CursorDriver", () => {
  beforeEach(() => {
    vi.mocked(Agent.prompt).mockClear();
  });

  it("calls Agent.prompt with local cwd", async () => {
    const d = new CursorDriver({
      apiKey: "test-key",
      modelId: "composer-2.5",
    });
    const result = await d.oneshot({
      workspacePath: "/tmp/ws",
      prompt: "hello",
      role: "design",
      cardId: "c1",
      boardId: "b1",
    });
    expect(Agent.prompt).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({
        apiKey: "test-key",
        local: { cwd: "/tmp/ws" },
      }),
    );
    expect(result.status).toBe("ok");
    expect(result.artifacts[0]?.href).toBe("docs/x.md");
  });
});
```

- [ ] **Step 2: Implement CursorDriver**

```ts
import { Agent } from "@cursor/sdk";
import { parseArtifactHints } from "./parse.js";
import type { AgentDriver, RunInput, RunResult } from "./types.js";

export class CursorDriver implements AgentDriver {
  readonly id = "cursor";
  readonly displayName = "Cursor";

  constructor(
    private readonly opts: { apiKey: string; modelId: string },
  ) {}

  async oneshot(input: RunInput): Promise<RunResult> {
    try {
      const result = await Agent.prompt(input.prompt, {
        apiKey: this.opts.apiKey,
        model: { id: this.opts.modelId },
        local: { cwd: input.workspacePath },
      });
      const summary =
        typeof result.result === "string"
          ? result.result
          : JSON.stringify(result.result ?? result);
      return {
        status: "ok",
        summary,
        artifacts: parseArtifactHints(summary),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { status: "error", summary: message, artifacts: [] };
    }
  }
}
```

Wire worker `index.ts`:

```ts
import { CursorDriver, MockDriver } from "@ai-workforce/agent";

function createDriver(config: WorkerConfig) {
  if (config.driver === "cursor") {
    if (!config.cursorApiKey) {
      throw new Error("CURSOR_API_KEY required when AIW_DRIVER=cursor");
    }
    return new CursorDriver({
      apiKey: config.cursorApiKey,
      modelId: config.modelId,
    });
  }
  return new MockDriver();
}
```

If executor sees `result.status === "error"`, call `failJob` instead of complete.

- [ ] **Step 3: Tests PASS + commit**

```bash
pnpm --filter @ai-workforce/agent test
pnpm --filter @ai-workforce/agent build
pnpm --filter @ai-workforce/worker test
git add packages/agent apps/worker pnpm-lock.yaml
git commit -m "feat(agent): add CursorDriver local oneshot via @cursor/sdk"
```

---

### Task 6: Poller + plan2 smoke + README

**Files:**
- Create: `apps/worker/src/poller.ts` (if not inlined in Task 2 API — worker just calls `createPollJobs`; optional thin wrapper)
- Create: `scripts/plan2-smoke.sh`
- Modify: `README.md`
- Modify: root `package.json` scripts if needed

**Acceptance:**
1. Start API with temp data dir
2. Create board + epic in design
3. Comment `@Design Bot work`
4. Start worker with `AIW_DRIVER=mock` once via `tsx` one-shot mode **or** run smoke that uses BoardClient logic through a `pnpm --filter @ai-workforce/worker exec tsx scripts/once.ts`

Add `apps/worker/src/once.ts` that runs a single `tick` then exits (easier for smoke):

```ts
import { MockDriver } from "@ai-workforce/agent";
import { loadConfig } from "./config.js";
import { BoardClient } from "./boardClient.js";
import { tick } from "./loop.js";

const config = loadConfig(process.env);
const r = await tick(new BoardClient(config), new MockDriver(), {
  createPollJobs: true,
});
console.log(JSON.stringify(r));
if (r.claimed < 1 && r.pollCreated < 1) {
  // still ok if mention job claimed
}
```

`scripts/plan2-smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="${API:-http://127.0.0.1:8787}"
export AIW_DATA_DIR="${AIW_DATA_DIR:-$(mktemp -d)}"
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

export AIW_BOARD_ID="$BOARD_ID"
export AIW_API_BASE="$API"
export AIW_DRIVER=mock
pnpm --filter @ai-workforce/agent build
pnpm --filter @ai-workforce/worker exec tsx src/once.ts

CARD=$(curl -sf "$API/boards/$BOARD_ID/cards" | python3 -c 'import sys,json; print([c for c in json.load(sys.stdin) if c["id"]=="'"$EPIC_ID"'"][0])')
echo "$CARD" | python3 -c 'import sys,json; c=json.load(sys.stdin); assert any(a.get("href","").endswith(".md") for a in c.get("artifacts",[])), c; print("plan2 smoke ok", c["artifacts"][0]["href"])'
```

README section:

```markdown
## Plan 2 — Worker

```bash
export AIW_BOARD_ID=<board-id from UI or API>
export AIW_DRIVER=mock          # or cursor
export CURSOR_API_KEY=...       # required for cursor
pnpm --filter @ai-workforce/agent build
pnpm dev:worker
```

Smoke (API must be running): `./scripts/plan2-smoke.sh`
```

- [ ] **Step 1: Implement once.ts + smoke + README**

- [ ] **Step 2: Run smoke against live API**

```bash
pnpm --filter @ai-workforce/domain build
pnpm --filter @ai-workforce/agent build
AIW_DATA_DIR=/tmp/aiw-p2-data pnpm dev:api &
sleep 1
chmod +x scripts/plan2-smoke.sh
./scripts/plan2-smoke.sh
```

Expected: `plan2 smoke ok ...`

- [ ] **Step 3: Commit**

```bash
git add apps/worker scripts/plan2-smoke.sh README.md package.json
git commit -m "feat(worker): add once tick, plan2 smoke, and runbook"
```

---

## Plan 2 self-review

### Spec coverage

| Spec item | Task |
|-----------|------|
| AgentDriver abstraction | Task 1 |
| Cursor local oneshot | Task 5 |
| Job claim / lock / fail keep column | Task 2 |
| `@` → Job → Worker execute | Task 4 + 6 |
| Timed column scan → Job | Task 2 `createPollJobs` + Task 4 tick |
| Writeback comment + ArtifactRef | Task 2 completeJob + Task 4 |
| Skip frozen | Task 2 claimable query |
| No streaming / no auto column moves | Out of scope (Plan 3) |

### Placeholder scan

No TBD left; Cursor SDK result shape uses defensive `result.result` stringification.

### Type consistency

- Artifact hint shape matches Plan 1 `ArtifactRef` (`kind` + `href` + `label`)
- Job statuses: `open|claimed|done|failed`
- Env: `AIW_*` + `CURSOR_API_KEY`

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-ai-workforce-plan2-worker-cursor.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task + review gates  
2. **Inline Execution** — execute in this session with checkpoints  

**Which approach?**
