# AI Workforce Plan 1: Board Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working local Board (domain rules + SQLite API + React kanban) so humans can manage Epic / requirement / task cards, comments, human gates, and rework freeze — without Worker/Cursor yet.

**Architecture:** pnpm monorepo. Pure domain package owns column transitions, gates, and rework melt. `board-api` (Hono + better-sqlite3) persists boards/cards/comments/employees/jobs and enforces domain rules. `board-web` (Vite + React) renders the 8-column board and card detail. Worker and Cursor adapters are out of scope (Plan 2+).

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Hono, better-sqlite3, Zod, Vite, React 19.

## Global Constraints

- Personal / small-team use; no multi-tenant auth in MVP
- Board columns fixed: `需求 → 设计 → 拆分 → 校验 → 开发 → 测试 → 验收 → Done`
- Card types: `epic` | `requirement` | `task` with column occupancy per spec
- Human gates: `设计 → 拆分` and `验收 → Done` require `actor: "human"` + explicit approve
- Test failure returns to `开发` and increments `reworkCount`; at `reworkCount >= 3` card is `frozen` (bots must not auto-move)
- Design body lives in workspace files later; cards only store `ArtifactRef` links (API supports links array now)
- One Board ↔ one `workspacePath` string (path validated as non-empty; existence check deferred to Worker plan)
- Language: TypeScript everywhere; tests via Vitest
- YAGNI: no WebSocket, no Cursor SDK, no Split/Verify automation in this plan

## Scope split (read me)

| Plan | Delivers | Depends on |
|------|----------|------------|
| **Plan 1 (this file)** | Domain + Board API + Kanban UI | — |
| **Plan 2** (next) | Worker daemon + AgentDriver + Cursor adapter + Job claim + oneshot writeback | Plan 1 |
| **Plan 3** (next) | Sidebar streaming chat, Split/Verify/Dev/Test/Review bots, full MVP path | Plan 1–2 |

Do not implement Plan 2/3 work inside Plan 1 tasks.

## File structure (locked in)

```text
package.json                 # pnpm workspace root
pnpm-workspace.yaml
tsconfig.base.json
packages/domain/
  package.json
  src/columns.ts             # ColumnId, ORDER, occupancy
  src/transition.ts          # moveCard rules
  src/rework.ts              # test fail / freeze
  src/types.ts               # shared domain types
  src/index.ts
  src/transition.test.ts
  src/rework.test.ts
apps/board-api/
  package.json
  src/db.ts                  # sqlite schema + migrations
  src/repo.ts                # CRUD
  src/routes.ts              # Hono routes
  src/index.ts               # listen :8787
  src/routes.test.ts
apps/board-web/
  package.json
  index.html
  vite.config.ts
  src/main.tsx
  src/App.tsx
  src/api.ts
  src/BoardView.tsx
  src/CardDrawer.tsx
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/vitest.config.ts`

**Interfaces:**
- Consumes: nothing
- Produces: workspace scripts `test`, `build`; package `@ai-workforce/domain` export stub

- [ ] **Step 1: Create root workspace files**

`package.json`:

```json
{
  "name": "ai-workforce",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 2: Create domain package stub**

`packages/domain/package.json`:

```json
{
  "name": "@ai-workforce/domain",
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
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  }
}
```

`packages/domain/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/domain/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

`packages/domain/src/index.ts`:

```ts
export const DOMAIN_VERSION = "0.0.1";
```

- [ ] **Step 3: Install and verify stub test runner**

Create `packages/domain/src/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DOMAIN_VERSION } from "./index.js";

describe("domain package", () => {
  it("exports version", () => {
    expect(DOMAIN_VERSION).toBe("0.0.1");
  });
});
```

Run:

```bash
cd /Users/peichao.dong/Documents/projects/dpc/ai-workforce
pnpm install
pnpm --filter @ai-workforce/domain test
```

Expected: PASS (1 test)

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json packages/domain pnpm-lock.yaml
git commit -m "chore: scaffold pnpm monorepo and domain package"
```

---

### Task 2: Column model and occupancy rules

**Files:**
- Create: `packages/domain/src/types.ts`
- Create: `packages/domain/src/columns.ts`
- Create: `packages/domain/src/columns.test.ts`
- Modify: `packages/domain/src/index.ts`
- Delete: `packages/domain/src/smoke.test.ts` (optional; or leave)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type ColumnId = "requirements" | "design" | "split" | "verify" | "dev" | "test" | "accept" | "done"`
  - `export type CardType = "epic" | "requirement" | "task"`
  - `export const COLUMN_ORDER: ColumnId[]`
  - `export function isColumnAllowedForType(type: CardType, column: ColumnId): boolean`

- [ ] **Step 1: Write failing tests**

`packages/domain/src/columns.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COLUMN_ORDER, isColumnAllowedForType } from "./columns.js";

describe("COLUMN_ORDER", () => {
  it("matches the eight delivery columns", () => {
    expect(COLUMN_ORDER).toEqual([
      "requirements",
      "design",
      "split",
      "verify",
      "dev",
      "test",
      "accept",
      "done",
    ]);
  });
});

describe("isColumnAllowedForType", () => {
  it("keeps requirements in requirements column only", () => {
    expect(isColumnAllowedForType("requirement", "requirements")).toBe(true);
    expect(isColumnAllowedForType("requirement", "design")).toBe(false);
    expect(isColumnAllowedForType("requirement", "dev")).toBe(false);
  });

  it("keeps epic in design/split/verify only", () => {
    expect(isColumnAllowedForType("epic", "design")).toBe(true);
    expect(isColumnAllowedForType("epic", "split")).toBe(true);
    expect(isColumnAllowedForType("epic", "verify")).toBe(true);
    expect(isColumnAllowedForType("epic", "requirements")).toBe(false);
    expect(isColumnAllowedForType("epic", "dev")).toBe(false);
  });

  it("keeps task in dev/test/accept/done only", () => {
    expect(isColumnAllowedForType("task", "dev")).toBe(true);
    expect(isColumnAllowedForType("task", "test")).toBe(true);
    expect(isColumnAllowedForType("task", "accept")).toBe(true);
    expect(isColumnAllowedForType("task", "done")).toBe(true);
    expect(isColumnAllowedForType("task", "design")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @ai-workforce/domain test
```

Expected: FAIL (cannot find module `./columns.js` or exports missing)

- [ ] **Step 3: Implement types + columns**

`packages/domain/src/types.ts`:

```ts
export type ColumnId =
  | "requirements"
  | "design"
  | "split"
  | "verify"
  | "dev"
  | "test"
  | "accept"
  | "done";

export type CardType = "epic" | "requirement" | "task";

export type Actor = "human" | "bot";

export type ArtifactRef = {
  kind: "file" | "url" | "pr";
  href: string;
  label?: string;
};

export type CardState = {
  id: string;
  type: CardType;
  column: ColumnId;
  reworkCount: number;
  frozen: boolean;
  epicId?: string | null;
};
```

`packages/domain/src/columns.ts`:

```ts
import type { CardType, ColumnId } from "./types.js";

export const COLUMN_ORDER: ColumnId[] = [
  "requirements",
  "design",
  "split",
  "verify",
  "dev",
  "test",
  "accept",
  "done",
];

const OCCUPANCY: Record<CardType, readonly ColumnId[]> = {
  requirement: ["requirements"],
  epic: ["design", "split", "verify"],
  task: ["dev", "test", "accept", "done"],
};

export function isColumnAllowedForType(
  type: CardType,
  column: ColumnId,
): boolean {
  return OCCUPANCY[type].includes(column);
}
```

`packages/domain/src/index.ts`:

```ts
export const DOMAIN_VERSION = "0.0.1";
export * from "./types.js";
export * from "./columns.js";
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @ai-workforce/domain test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): add column order and card type occupancy"
```

---

### Task 3: Transition gates (human approve)

**Files:**
- Create: `packages/domain/src/transition.ts`
- Create: `packages/domain/src/transition.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `CardState`, `ColumnId`, `Actor`, `isColumnAllowedForType`
- Produces:
  - `export type MoveRequest = { to: ColumnId; actor: Actor; humanApproved?: boolean }`
  - `export type MoveResult = { ok: true; next: CardState; audit: string } | { ok: false; reason: string }`
  - `export function planMove(card: CardState, req: MoveRequest): MoveResult`

- [ ] **Step 1: Write failing tests**

`packages/domain/src/transition.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planMove } from "./transition.js";
import type { CardState } from "./types.js";

const epicDesign = (): CardState => ({
  id: "e1",
  type: "epic",
  column: "design",
  reworkCount: 0,
  frozen: false,
});

const taskAccept = (): CardState => ({
  id: "t1",
  type: "task",
  column: "accept",
  reworkCount: 0,
  frozen: false,
  epicId: "e1",
});

describe("planMove gates", () => {
  it("blocks design → split without human approval", () => {
    const result = planMove(epicDesign(), {
      to: "split",
      actor: "human",
      humanApproved: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/human approval/i);
  });

  it("allows design → split with human approval", () => {
    const result = planMove(epicDesign(), {
      to: "split",
      actor: "human",
      humanApproved: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.column).toBe("split");
      expect(result.audit).toMatch(/design → split/);
    }
  });

  it("blocks bot from design → split even with flag", () => {
    const result = planMove(epicDesign(), {
      to: "split",
      actor: "bot",
      humanApproved: true,
    });
    expect(result.ok).toBe(false);
  });

  it("blocks accept → done without human approval", () => {
    const result = planMove(taskAccept(), {
      to: "done",
      actor: "human",
      humanApproved: false,
    });
    expect(result.ok).toBe(false);
  });

  it("allows bot auto-move dev → test when not frozen", () => {
    const card: CardState = {
      id: "t2",
      type: "task",
      column: "dev",
      reworkCount: 0,
      frozen: false,
    };
    const result = planMove(card, { to: "test", actor: "bot" });
    expect(result.ok).toBe(true);
  });

  it("rejects wrong occupancy (task into design)", () => {
    const card: CardState = {
      id: "t3",
      type: "task",
      column: "dev",
      reworkCount: 0,
      frozen: false,
    };
    const result = planMove(card, {
      to: "design",
      actor: "human",
      humanApproved: true,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects any move when frozen unless human unfreeze path handled elsewhere", () => {
    const card: CardState = {
      id: "t4",
      type: "task",
      column: "test",
      reworkCount: 3,
      frozen: true,
    };
    const result = planMove(card, { to: "accept", actor: "bot" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/frozen/i);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @ai-workforce/domain test
```

Expected: FAIL on missing `planMove`

- [ ] **Step 3: Implement transition**

`packages/domain/src/transition.ts`:

```ts
import { isColumnAllowedForType } from "./columns.js";
import type { Actor, CardState, ColumnId } from "./types.js";

export type MoveRequest = {
  to: ColumnId;
  actor: Actor;
  humanApproved?: boolean;
};

export type MoveResult =
  | { ok: true; next: CardState; audit: string }
  | { ok: false; reason: string };

const HUMAN_GATES: ReadonlyArray<readonly [ColumnId, ColumnId]> = [
  ["design", "split"],
  ["accept", "done"],
];

function requiresHumanGate(from: ColumnId, to: ColumnId): boolean {
  return HUMAN_GATES.some(([a, b]) => a === from && b === to);
}

export function planMove(card: CardState, req: MoveRequest): MoveResult {
  if (card.frozen && req.actor === "bot") {
    return { ok: false, reason: "Card is frozen; bot cannot move it" };
  }
  if (card.frozen && req.actor === "human" && !req.humanApproved) {
    return {
      ok: false,
      reason: "Card is frozen; human must explicitly approve a decision move",
    };
  }
  if (!isColumnAllowedForType(card.type, req.to)) {
    return {
      ok: false,
      reason: `Type ${card.type} cannot occupy column ${req.to}`,
    };
  }
  if (requiresHumanGate(card.column, req.to)) {
    if (req.actor !== "human" || !req.humanApproved) {
      return {
        ok: false,
        reason: `Move ${card.column} → ${req.to} requires human approval`,
      };
    }
  }
  const next: CardState = { ...card, column: req.to };
  return {
    ok: true,
    next,
    audit: `${req.actor}: ${card.column} → ${req.to}`,
  };
}
```

Update `packages/domain/src/index.ts` to also export transition:

```ts
export const DOMAIN_VERSION = "0.0.1";
export * from "./types.js";
export * from "./columns.js";
export * from "./transition.js";
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @ai-workforce/domain test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): enforce human gates and occupancy on moves"
```

---

### Task 4: Rework counter and freeze

**Files:**
- Create: `packages/domain/src/rework.ts`
- Create: `packages/domain/src/rework.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `CardState`
- Produces:
  - `export const REWORK_LIMIT = 3`
  - `export function applyTestFailure(card: CardState): MoveResult-like { next, froze }`  
  - Concrete:
    ```ts
    export type TestFailureResult =
      | { kind: "reopen_dev"; next: CardState; audit: string }
      | { kind: "freeze"; next: CardState; audit: string };
    export function applyTestFailure(card: CardState): TestFailureResult;
    export type HumanDecision = "return_dev" | "force_accept" | "close_done";
    export function applyHumanDecision(card: CardState, decision: HumanDecision): MoveResult;
    ```
  - Reuse `MoveResult` from transition for `applyHumanDecision`

- [ ] **Step 1: Write failing tests**

`packages/domain/src/rework.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyHumanDecision, applyTestFailure, REWORK_LIMIT } from "./rework.js";
import type { CardState } from "./types.js";

function taskInTest(reworkCount: number, frozen = false): CardState {
  return {
    id: "t1",
    type: "task",
    column: "test",
    reworkCount,
    frozen,
    epicId: "e1",
  };
}

describe("applyTestFailure", () => {
  it("returns to dev and increments reworkCount when below limit", () => {
    const result = applyTestFailure(taskInTest(0));
    expect(result.kind).toBe("reopen_dev");
    if (result.kind === "reopen_dev") {
      expect(result.next.column).toBe("dev");
      expect(result.next.reworkCount).toBe(1);
      expect(result.next.frozen).toBe(false);
    }
  });

  it("freezes when reworkCount would reach REWORK_LIMIT", () => {
    const result = applyTestFailure(taskInTest(REWORK_LIMIT - 1));
    expect(result.kind).toBe("freeze");
    if (result.kind === "freeze") {
      expect(result.next.reworkCount).toBe(REWORK_LIMIT);
      expect(result.next.frozen).toBe(true);
      expect(result.next.column).toBe("test");
    }
  });
});

describe("applyHumanDecision", () => {
  it("return_dev unfreezes stay count and moves to dev", () => {
    const card = taskInTest(3, true);
    const result = applyHumanDecision(card, "return_dev");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.column).toBe("dev");
      expect(result.next.frozen).toBe(false);
      expect(result.next.reworkCount).toBe(3);
    }
  });

  it("force_accept moves frozen card to accept", () => {
    const result = applyHumanDecision(taskInTest(3, true), "force_accept");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.column).toBe("accept");
      expect(result.next.frozen).toBe(false);
    }
  });

  it("close_done requires going to done with human semantics", () => {
    const result = applyHumanDecision(taskInTest(3, true), "close_done");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.column).toBe("done");
      expect(result.next.frozen).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @ai-workforce/domain test
```

Expected: FAIL missing `rework` module

- [ ] **Step 3: Implement rework**

`packages/domain/src/rework.ts`:

```ts
import type { MoveResult } from "./transition.js";
import type { CardState } from "./types.js";

export const REWORK_LIMIT = 3;

export type TestFailureResult =
  | { kind: "reopen_dev"; next: CardState; audit: string }
  | { kind: "freeze"; next: CardState; audit: string };

export type HumanDecision = "return_dev" | "force_accept" | "close_done";

export function applyTestFailure(card: CardState): TestFailureResult {
  if (card.type !== "task" || card.column !== "test") {
    throw new Error("applyTestFailure only valid for task cards in test");
  }
  const reworkCount = card.reworkCount + 1;
  if (reworkCount >= REWORK_LIMIT) {
    const next: CardState = {
      ...card,
      reworkCount,
      frozen: true,
    };
    return {
      kind: "freeze",
      next,
      audit: `test failed; reworkCount=${reworkCount}; frozen for human decision`,
    };
  }
  const next: CardState = {
    ...card,
    column: "dev",
    reworkCount,
    frozen: false,
  };
  return {
    kind: "reopen_dev",
    next,
    audit: `test failed; return to dev; reworkCount=${reworkCount}`,
  };
}

export function applyHumanDecision(
  card: CardState,
  decision: HumanDecision,
): MoveResult {
  if (!card.frozen) {
    return { ok: false, reason: "Card is not frozen" };
  }
  if (card.type !== "task") {
    return { ok: false, reason: "Only task cards support rework decisions" };
  }
  if (decision === "return_dev") {
    return {
      ok: true,
      next: { ...card, column: "dev", frozen: false },
      audit: "human: unfreeze → dev (reworkCount preserved)",
    };
  }
  if (decision === "force_accept") {
    return {
      ok: true,
      next: { ...card, column: "accept", frozen: false },
      audit: "human: unfreeze → accept",
    };
  }
  return {
    ok: true,
    next: { ...card, column: "done", frozen: false },
    audit: "human: unfreeze → done (closed)",
  };
}
```

Export from `index.ts`:

```ts
export * from "./rework.js";
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @ai-workforce/domain test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): add test rework loop and freeze decisions"
```

---

### Task 5: Board API SQLite schema and repository

**Files:**
- Create: `apps/board-api/package.json`
- Create: `apps/board-api/tsconfig.json`
- Create: `apps/board-api/vitest.config.ts`
- Create: `apps/board-api/src/db.ts`
- Create: `apps/board-api/src/repo.ts`
- Create: `apps/board-api/src/repo.test.ts`

**Interfaces:**
- Consumes: `@ai-workforce/domain` types
- Produces:
  - `openDb(path: string): Database`
  - `migrate(db): void`
  - `BoardRepo` with `createBoard`, `getBoard`, `createCard`, `listCards`, `updateCard`, `addComment`, `listComments`, `listEmployees`, `createJob`, `listOpenJobs`

- [ ] **Step 1: Create board-api package manifests**

`apps/board-api/package.json`:

```json
{
  "name": "@ai-workforce/board-api",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@ai-workforce/domain": "workspace:*",
    "@hono/node-server": "^1.13.8",
    "better-sqlite3": "^11.8.1",
    "hono": "^4.7.2",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.13.4",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  }
}
```

`apps/board-api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`apps/board-api/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 2: Write failing repo test**

`apps/board-api/src/repo.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDb } from "./db.js";
import { BoardRepo } from "./repo.js";

const tmpFiles: string[] = [];

afterEach(() => {
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  tmpFiles.length = 0;
});

function tempDb(): BoardRepo {
  const file = path.join(
    os.tmpdir(),
    `aiw-board-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  tmpFiles.push(file);
  const db = openDb(file);
  migrate(db);
  return new BoardRepo(db);
}

describe("BoardRepo", () => {
  it("creates a board and cards, lists by column", () => {
    const repo = tempDb();
    const board = repo.createBoard({
      name: "Demo",
      workspacePath: "/tmp/demo-workspace",
    });
    expect(board.id).toBeTruthy();

    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Auth theme",
      column: "design",
      description: "",
    });
    const req = repo.createCard({
      boardId: board.id,
      type: "requirement",
      title: "Login",
      column: "requirements",
      description: "OAuth login",
      epicId: epic.id,
    });
    expect(req.epicId).toBe(epic.id);

    const cards = repo.listCards(board.id);
    expect(cards).toHaveLength(2);
  });

  it("stores comments and artifact links on update", () => {
    const repo = tempDb();
    const board = repo.createBoard({
      name: "Demo",
      workspacePath: "/tmp/ws",
    });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "design",
      description: "",
    });
    repo.addComment({
      cardId: epic.id,
      author: "human",
      body: "Looks good",
    });
    repo.updateCard(epic.id, {
      artifacts: [
        { kind: "file", href: "docs/design/auth.md", label: "design" },
      ],
    });
    const comments = repo.listComments(epic.id);
    expect(comments).toHaveLength(1);
    const updated = repo.getCard(epic.id);
    expect(updated?.artifacts[0]?.href).toBe("docs/design/auth.md");
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
pnpm install
pnpm --filter @ai-workforce/board-api test
```

Expected: FAIL (modules missing)

- [ ] **Step 4: Implement db + repo**

`apps/board-api/src/db.ts`:

```ts
import Database from "better-sqlite3";

export function openDb(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      column_id TEXT NOT NULL,
      epic_id TEXT,
      rework_count INTEGER NOT NULL DEFAULT 0,
      frozen INTEGER NOT NULL DEFAULT 0,
      artifacts_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL,
      watch_columns_json TEXT NOT NULL,
      adapter TEXT NOT NULL DEFAULT 'cursor'
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      created_at TEXT NOT NULL,
      claimed_at TEXT
    );
  `);
}
```

`apps/board-api/src/repo.ts`:

```ts
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ArtifactRef, CardType, ColumnId } from "@ai-workforce/domain";

export type Board = {
  id: string;
  name: string;
  workspacePath: string;
  createdAt: string;
};

export type CardRecord = {
  id: string;
  boardId: string;
  type: CardType;
  title: string;
  description: string;
  column: ColumnId;
  epicId: string | null;
  reworkCount: number;
  frozen: boolean;
  artifacts: ArtifactRef[];
  createdAt: string;
  updatedAt: string;
};

export type CommentRecord = {
  id: string;
  cardId: string;
  author: string;
  body: string;
  createdAt: string;
};

const DEFAULT_EMPLOYEES: Array<{
  role: string;
  displayName: string;
  watchColumns: ColumnId[];
}> = [
  { role: "design", displayName: "Design Bot", watchColumns: ["design"] },
  { role: "split", displayName: "Split Bot", watchColumns: ["split"] },
  { role: "verify", displayName: "Verify Bot", watchColumns: ["verify"] },
  { role: "dev", displayName: "Dev Bot", watchColumns: ["dev"] },
  { role: "test", displayName: "Test Bot", watchColumns: ["test"] },
  { role: "review", displayName: "Review Bot", watchColumns: ["accept"] },
];

export class BoardRepo {
  constructor(private readonly db: Database.Database) {}

  createBoard(input: { name: string; workspacePath: string }): Board {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO boards (id, name, workspace_path, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, input.name, input.workspacePath, createdAt);

    const insertEmp = this.db.prepare(
      `INSERT INTO employees (id, board_id, role, display_name, watch_columns_json, adapter)
       VALUES (?, ?, ?, ?, ?, 'cursor')`,
    );
    for (const emp of DEFAULT_EMPLOYEES) {
      insertEmp.run(
        randomUUID(),
        id,
        emp.role,
        emp.displayName,
        JSON.stringify(emp.watchColumns),
      );
    }

    return {
      id,
      name: input.name,
      workspacePath: input.workspacePath,
      createdAt,
    };
  }

  getBoard(id: string): Board | null {
    const row = this.db
      .prepare(
        `SELECT id, name, workspace_path as workspacePath, created_at as createdAt
         FROM boards WHERE id = ?`,
      )
      .get(id) as Board | undefined;
    return row ?? null;
  }

  createCard(input: {
    boardId: string;
    type: CardType;
    title: string;
    description: string;
    column: ColumnId;
    epicId?: string | null;
  }): CardRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO cards (
           id, board_id, type, title, description, column_id, epic_id,
           rework_count, frozen, artifacts_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, '[]', ?, ?)`,
      )
      .run(
        id,
        input.boardId,
        input.type,
        input.title,
        input.description,
        input.column,
        input.epicId ?? null,
        now,
        now,
      );
    return this.getCard(id)!;
  }

  getCard(id: string): CardRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, board_id as boardId, type, title, description,
                column_id as columnId, epic_id as epicId,
                rework_count as reworkCount, frozen, artifacts_json as artifactsJson,
                created_at as createdAt, updated_at as updatedAt
         FROM cards WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          boardId: string;
          type: CardType;
          title: string;
          description: string;
          columnId: ColumnId;
          epicId: string | null;
          reworkCount: number;
          frozen: number;
          artifactsJson: string;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      boardId: row.boardId,
      type: row.type,
      title: row.title,
      description: row.description,
      column: row.columnId,
      epicId: row.epicId,
      reworkCount: row.reworkCount,
      frozen: !!row.frozen,
      artifacts: JSON.parse(row.artifactsJson) as ArtifactRef[],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  listCards(boardId: string): CardRecord[] {
    const rows = this.db
      .prepare(`SELECT id FROM cards WHERE board_id = ? ORDER BY created_at`)
      .all(boardId) as Array<{ id: string }>;
    return rows.map((r) => this.getCard(r.id)!);
  }

  updateCard(
    id: string,
    patch: Partial<{
      title: string;
      description: string;
      column: ColumnId;
      epicId: string | null;
      reworkCount: number;
      frozen: boolean;
      artifacts: ArtifactRef[];
    }>,
  ): CardRecord {
    const current = this.getCard(id);
    if (!current) throw new Error(`Card not found: ${id}`);
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `UPDATE cards SET title=?, description=?, column_id=?, epic_id=?,
         rework_count=?, frozen=?, artifacts_json=?, updated_at=? WHERE id=?`,
      )
      .run(
        next.title,
        next.description,
        next.column,
        next.epicId,
        next.reworkCount,
        next.frozen ? 1 : 0,
        JSON.stringify(next.artifacts),
        next.updatedAt,
        id,
      );
    return this.getCard(id)!;
  }

  addComment(input: {
    cardId: string;
    author: string;
    body: string;
  }): CommentRecord {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO comments (id, card_id, author, body, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.cardId, input.author, input.body, createdAt);
    return { id, cardId: input.cardId, author: input.author, body: input.body, createdAt };
  }

  listComments(cardId: string): CommentRecord[] {
    return this.db
      .prepare(
        `SELECT id, card_id as cardId, author, body, created_at as createdAt
         FROM comments WHERE card_id = ? ORDER BY created_at`,
      )
      .all(cardId) as CommentRecord[];
  }

  listEmployees(boardId: string): Array<{
    id: string;
    boardId: string;
    role: string;
    displayName: string;
    watchColumns: ColumnId[];
    adapter: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, board_id as boardId, role, display_name as displayName,
                watch_columns_json as watchColumnsJson, adapter
         FROM employees WHERE board_id = ?`,
      )
      .all(boardId) as Array<{
      id: string;
      boardId: string;
      role: string;
      displayName: string;
      watchColumnsJson: string;
      adapter: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      boardId: r.boardId,
      role: r.role,
      displayName: r.displayName,
      watchColumns: JSON.parse(r.watchColumnsJson) as ColumnId[],
      adapter: r.adapter,
    }));
  }

  createJob(input: {
    boardId: string;
    cardId: string;
    employeeId: string;
    trigger: "mention" | "poll";
  }): { id: string; status: string } {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO jobs (id, board_id, card_id, employee_id, status, trigger, created_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(
        id,
        input.boardId,
        input.cardId,
        input.employeeId,
        input.trigger,
        createdAt,
      );
    return { id, status: "open" };
  }

  listOpenJobs(boardId: string) {
    return this.db
      .prepare(
        `SELECT id, board_id as boardId, card_id as cardId, employee_id as employeeId,
                status, trigger, created_at as createdAt, claimed_at as claimedAt
         FROM jobs WHERE board_id = ? AND status = 'open' ORDER BY created_at`,
      )
      .all(boardId);
  }
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
pnpm --filter @ai-workforce/domain build
pnpm --filter @ai-workforce/board-api test
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/board-api packages/domain/package.json pnpm-lock.yaml
git commit -m "feat(board-api): add sqlite schema and board repository"
```

---

### Task 6: HTTP routes for board/cards/moves

**Files:**
- Create: `apps/board-api/src/routes.ts`
- Create: `apps/board-api/src/index.ts`
- Create: `apps/board-api/src/routes.test.ts`
- Modify: `apps/board-api/package.json` (if needed)

**Interfaces:**
- Consumes: `BoardRepo`, `planMove`, `applyTestFailure`, `applyHumanDecision`
- Produces: Hono app with:
  - `POST /boards`
  - `GET /boards/:boardId`
  - `GET /boards/:boardId/cards`
  - `POST /boards/:boardId/cards`
  - `POST /cards/:cardId/move` body `{ to, actor, humanApproved? }`
  - `POST /cards/:cardId/test-result` body `{ passed: boolean }`
  - `POST /cards/:cardId/human-decision` body `{ decision }`
  - `POST /cards/:cardId/comments` body `{ author, body }` — if body matches `/@(Design|Split|Verify|Dev|Test|Review)\\s*Bot/i`, create open Job
  - `GET /boards/:boardId/jobs`
  - `GET /boards/:boardId/employees`

- [ ] **Step 1: Write failing route tests**

`apps/board-api/src/routes.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./routes.js";
import { migrate, openDb } from "./db.js";
import { BoardRepo } from "./repo.js";

const tmpFiles: string[] = [];

afterEach(() => {
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  tmpFiles.length = 0;
});

function appWithRepo() {
  const file = path.join(os.tmpdir(), `aiw-api-${Date.now()}.sqlite`);
  tmpFiles.push(file);
  const db = openDb(file);
  migrate(db);
  const repo = new BoardRepo(db);
  return { app: createApp(repo), repo };
}

describe("routes", () => {
  it("creates board and moves epic design → split with approval", async () => {
    const { app } = appWithRepo();
    const boardRes = await app.request("http://localhost/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Demo",
        workspacePath: "/tmp/ws",
      }),
    });
    expect(boardRes.status).toBe(201);
    const board = await boardRes.json();

    const cardRes = await app.request(
      `http://localhost/boards/${board.id}/cards`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "epic",
          title: "Theme",
          column: "design",
          description: "",
        }),
      },
    );
    const card = await cardRes.json();

    const denied = await app.request(`http://localhost/cards/${card.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: "split",
        actor: "human",
        humanApproved: false,
      }),
    });
    expect(denied.status).toBe(400);

    const ok = await app.request(`http://localhost/cards/${card.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: "split",
        actor: "human",
        humanApproved: true,
      }),
    });
    expect(ok.status).toBe(200);
    const moved = await ok.json();
    expect(moved.column).toBe("split");
  });

  it("creates job when comment mentions a bot", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "design",
      description: "",
    });
    const res = await app.request(`http://localhost/cards/${epic.id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        author: "human",
        body: "@Design Bot please draft outline",
      }),
    });
    expect(res.status).toBe(201);
    const jobs = repo.listOpenJobs(board.id);
    expect(jobs.length).toBe(1);
  });

  it("freezes after third test failure", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      column: "test",
      description: "",
    });
    for (let i = 0; i < 2; i++) {
      const r = await app.request(
        `http://localhost/cards/${task.id}/test-result`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ passed: false }),
        },
      );
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.column).toBe("dev");
      repo.updateCard(task.id, { column: "test" });
    }
    const third = await app.request(
      `http://localhost/cards/${task.id}/test-result`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passed: false }),
      },
    );
    const body = await third.json();
    expect(body.frozen).toBe(true);
    expect(body.reworkCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @ai-workforce/board-api test
```

Expected: FAIL missing `createApp`

- [ ] **Step 3: Implement routes + server entry**

`apps/board-api/src/routes.ts`:

```ts
import { Hono } from "hono";
import { z } from "zod";
import {
  applyHumanDecision,
  applyTestFailure,
  planMove,
  type ColumnId,
  type CardType,
  type HumanDecision,
} from "@ai-workforce/domain";
import type { BoardRepo } from "./repo.js";

const mentionRe =
  /@(Design|Split|Verify|Dev|Test|Review)\s*Bot/i;

export function createApp(repo: BoardRepo) {
  const app = new Hono();

  app.post("/boards", async (c) => {
    const body = z
      .object({ name: z.string().min(1), workspacePath: z.string().min(1) })
      .parse(await c.req.json());
    const board = repo.createBoard(body);
    return c.json(board, 201);
  });

  app.get("/boards/:boardId", (c) => {
    const board = repo.getBoard(c.req.param("boardId"));
    if (!board) return c.json({ error: "not found" }, 404);
    return c.json(board);
  });

  app.get("/boards/:boardId/cards", (c) => {
    return c.json(repo.listCards(c.req.param("boardId")));
  });

  app.post("/boards/:boardId/cards", async (c) => {
    const boardId = c.req.param("boardId");
    if (!repo.getBoard(boardId)) return c.json({ error: "not found" }, 404);
    const body = z
      .object({
        type: z.enum(["epic", "requirement", "task"]),
        title: z.string().min(1),
        description: z.string().default(""),
        column: z.enum([
          "requirements",
          "design",
          "split",
          "verify",
          "dev",
          "test",
          "accept",
          "done",
        ]),
        epicId: z.string().nullable().optional(),
      })
      .parse(await c.req.json());
    const card = repo.createCard({
      boardId,
      type: body.type as CardType,
      title: body.title,
      description: body.description,
      column: body.column as ColumnId,
      epicId: body.epicId,
    });
    return c.json(card, 201);
  });

  app.post("/cards/:cardId/move", async (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card) return c.json({ error: "not found" }, 404);
    const body = z
      .object({
        to: z.enum([
          "requirements",
          "design",
          "split",
          "verify",
          "dev",
          "test",
          "accept",
          "done",
        ]),
        actor: z.enum(["human", "bot"]),
        humanApproved: z.boolean().optional(),
      })
      .parse(await c.req.json());

    const result = planMove(
      {
        id: card.id,
        type: card.type,
        column: card.column,
        reworkCount: card.reworkCount,
        frozen: card.frozen,
        epicId: card.epicId,
      },
      {
        to: body.to as ColumnId,
        actor: body.actor,
        humanApproved: body.humanApproved,
      },
    );
    if (!result.ok) return c.json({ error: result.reason }, 400);
    const updated = repo.updateCard(card.id, {
      column: result.next.column,
      frozen: result.next.frozen,
      reworkCount: result.next.reworkCount,
    });
    repo.addComment({
      cardId: card.id,
      author: body.actor,
      body: `[audit] ${result.audit}`,
    });
    return c.json(updated);
  });

  app.post("/cards/:cardId/test-result", async (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card) return c.json({ error: "not found" }, 404);
    const body = z.object({ passed: z.boolean() }).parse(await c.req.json());
    if (body.passed) {
      const result = planMove(
        {
          id: card.id,
          type: card.type,
          column: card.column,
          reworkCount: card.reworkCount,
          frozen: card.frozen,
          epicId: card.epicId,
        },
        { to: "accept", actor: "bot" },
      );
      if (!result.ok) return c.json({ error: result.reason }, 400);
      const updated = repo.updateCard(card.id, { column: result.next.column });
      repo.addComment({
        cardId: card.id,
        author: "bot",
        body: `[audit] ${result.audit}`,
      });
      return c.json(updated);
    }
    const failure = applyTestFailure({
      id: card.id,
      type: card.type,
      column: card.column,
      reworkCount: card.reworkCount,
      frozen: card.frozen,
      epicId: card.epicId,
    });
    const updated = repo.updateCard(card.id, {
      column: failure.next.column,
      reworkCount: failure.next.reworkCount,
      frozen: failure.next.frozen,
    });
    repo.addComment({
      cardId: card.id,
      author: "bot",
      body: `[audit] ${failure.audit}`,
    });
    return c.json(updated);
  });

  app.post("/cards/:cardId/human-decision", async (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card) return c.json({ error: "not found" }, 404);
    const body = z
      .object({
        decision: z.enum(["return_dev", "force_accept", "close_done"]),
      })
      .parse(await c.req.json());
    const result = applyHumanDecision(
      {
        id: card.id,
        type: card.type,
        column: card.column,
        reworkCount: card.reworkCount,
        frozen: card.frozen,
        epicId: card.epicId,
      },
      body.decision as HumanDecision,
    );
    if (!result.ok) return c.json({ error: result.reason }, 400);
    const updated = repo.updateCard(card.id, {
      column: result.next.column,
      frozen: result.next.frozen,
      reworkCount: result.next.reworkCount,
    });
    repo.addComment({
      cardId: card.id,
      author: "human",
      body: `[audit] ${result.audit}`,
    });
    return c.json(updated);
  });

  app.post("/cards/:cardId/comments", async (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card) return c.json({ error: "not found" }, 404);
    const body = z
      .object({ author: z.string().min(1), body: z.string().min(1) })
      .parse(await c.req.json());
    const comment = repo.addComment({
      cardId: card.id,
      author: body.author,
      body: body.body,
    });
    const m = body.body.match(mentionRe);
    if (m) {
      const role = m[1]!.toLowerCase();
      const employees = repo.listEmployees(card.boardId);
      const emp = employees.find((e) => e.role === role);
      if (emp) {
        repo.createJob({
          boardId: card.boardId,
          cardId: card.id,
          employeeId: emp.id,
          trigger: "mention",
        });
      }
    }
    return c.json(comment, 201);
  });

  app.get("/cards/:cardId/comments", (c) => {
    return c.json(repo.listComments(c.req.param("cardId")));
  });

  app.get("/boards/:boardId/employees", (c) => {
    return c.json(repo.listEmployees(c.req.param("boardId")));
  });

  app.get("/boards/:boardId/jobs", (c) => {
    return c.json(repo.listOpenJobs(c.req.param("boardId")));
  });

  return app;
}
```

`apps/board-api/src/index.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { migrate, openDb } from "./db.js";
import { BoardRepo } from "./repo.js";
import { createApp } from "./routes.js";

const dataDir = process.env.AIW_DATA_DIR ?? path.join(process.cwd(), ".data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "board.sqlite");
const db = openDb(dbPath);
migrate(db);
const app = createApp(new BoardRepo(db));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`board-api listening on http://127.0.0.1:${port}`);
console.log(`sqlite: ${dbPath}`);
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @ai-workforce/domain build
pnpm --filter @ai-workforce/board-api test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/board-api
git commit -m "feat(board-api): expose REST routes for cards, gates, jobs"
```

---

### Task 7: React kanban UI (read + create + move)

**Files:**
- Create: `apps/board-web/package.json`
- Create: `apps/board-web/tsconfig.json`
- Create: `apps/board-web/tsconfig.app.json`
- Create: `apps/board-web/vite.config.ts`
- Create: `apps/board-web/index.html`
- Create: `apps/board-web/src/main.tsx`
- Create: `apps/board-web/src/App.tsx`
- Create: `apps/board-web/src/api.ts`
- Create: `apps/board-web/src/BoardView.tsx`
- Create: `apps/board-web/src/CardDrawer.tsx`
- Create: `apps/board-web/src/styles.css`

**Interfaces:**
- Consumes: Board API at `http://127.0.0.1:8787` (Vite proxy `/api` → API)
- Produces: UI to create board (localStorage `boardId`), show 8 columns, create requirement/epic/task, open drawer for comments / approve move / human decision

- [ ] **Step 1: Scaffold board-web**

`apps/board-web/package.json`:

```json
{
  "name": "@ai-workforce/board-web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "echo 'no unit tests in plan1 ui'"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.8",
    "@types/react-dom": "^19.0.3",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.3",
    "vite": "^6.1.0"
  }
}
```

`apps/board-web/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
```

`apps/board-web/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Workforce Board</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/board-web/tsconfig.json`:

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }]
}
```

`apps/board-web/tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Implement API client + UI**

`apps/board-web/src/api.ts`:

```ts
const base = "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export type Card = {
  id: string;
  boardId: string;
  type: "epic" | "requirement" | "task";
  title: string;
  description: string;
  column: string;
  epicId: string | null;
  reworkCount: number;
  frozen: boolean;
  artifacts: Array<{ kind: string; href: string; label?: string }>;
};

export const api = {
  createBoard: (name: string, workspacePath: string) =>
    json<{ id: string; name: string; workspacePath: string }>(
      fetch(`${base}/boards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, workspacePath }),
      }),
    ),
  getBoard: (id: string) => json(fetch(`${base}/boards/${id}`)),
  listCards: (boardId: string) =>
    json<Card[]>(fetch(`${base}/boards/${boardId}/cards`)),
  createCard: (
    boardId: string,
    body: {
      type: Card["type"];
      title: string;
      description?: string;
      column: string;
      epicId?: string | null;
    },
  ) =>
    json<Card>(
      fetch(`${base}/boards/${boardId}/cards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  moveCard: (
    cardId: string,
    body: { to: string; actor: "human" | "bot"; humanApproved?: boolean },
  ) =>
    json<Card>(
      fetch(`${base}/cards/${cardId}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  humanDecision: (
    cardId: string,
    decision: "return_dev" | "force_accept" | "close_done",
  ) =>
    json<Card>(
      fetch(`${base}/cards/${cardId}/human-decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      }),
    ),
  listComments: (cardId: string) =>
    json<Array<{ id: string; author: string; body: string; createdAt: string }>>(
      fetch(`${base}/cards/${cardId}/comments`),
    ),
  addComment: (cardId: string, author: string, body: string) =>
    json(
      fetch(`${base}/cards/${cardId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ author, body }),
      }),
    ),
};
```

`apps/board-web/src/styles.css`:

```css
:root {
  font-family: "IBM Plex Sans", "Noto Sans SC", system-ui, sans-serif;
  color: #1c1917;
  background: #f5f5f4;
}
* { box-sizing: border-box; }
body { margin: 0; }
.app { padding: 16px; }
.board {
  display: grid;
  grid-template-columns: repeat(8, minmax(180px, 1fr));
  gap: 8px;
  overflow-x: auto;
}
.column {
  background: #e7e5e4;
  border-radius: 8px;
  padding: 8px;
  min-height: 70vh;
}
.column h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; }
.card {
  background: #fff;
  border: 1px solid #d6d3d1;
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  text-align: left;
  width: 100%;
}
.card.frozen { outline: 2px solid #b91c1c; }
.meta { color: #78716c; font-size: 12px; }
.drawer {
  position: fixed; right: 0; top: 0; width: 380px; height: 100%;
  background: #fff; border-left: 1px solid #d6d3d1; padding: 16px;
  overflow: auto;
}
```

`apps/board-web/src/BoardView.tsx`:

```tsx
import type { Card } from "./api";

const COLUMNS: Array<{ id: string; label: string }> = [
  { id: "requirements", label: "需求" },
  { id: "design", label: "设计" },
  { id: "split", label: "拆分" },
  { id: "verify", label: "校验" },
  { id: "dev", label: "开发" },
  { id: "test", label: "测试" },
  { id: "accept", label: "验收" },
  { id: "done", label: "Done" },
];

export function BoardView(props: {
  cards: Card[];
  onOpen: (card: Card) => void;
}) {
  return (
    <div className="board">
      {COLUMNS.map((col) => (
        <section className="column" key={col.id}>
          <h3>{col.label}</h3>
          {props.cards
            .filter((c) => c.column === col.id)
            .map((c) => (
              <button
                key={c.id}
                className={`card${c.frozen ? " frozen" : ""}`}
                onClick={() => props.onOpen(c)}
              >
                <div className="meta">
                  {c.type}
                  {c.reworkCount > 0 ? ` · rework ${c.reworkCount}` : ""}
                  {c.frozen ? " · FROZEN" : ""}
                </div>
                <strong>{c.title}</strong>
              </button>
            ))}
        </section>
      ))}
    </div>
  );
}
```

`apps/board-web/src/CardDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type Card } from "./api";

export function CardDrawer(props: {
  card: Card;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [comments, setComments] = useState<
    Array<{ id: string; author: string; body: string }>
  >([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listComments(props.card.id).then(setComments).catch((e) => setError(String(e)));
  }, [props.card.id]);

  async function approveTo(to: string) {
    setError(null);
    try {
      await api.moveCard(props.card.id, {
        to,
        actor: "human",
        humanApproved: true,
      });
      props.onChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <aside className="drawer">
      <button type="button" onClick={props.onClose}>
        关闭
      </button>
      <h2>{props.card.title}</h2>
      <p className="meta">
        {props.card.type} · {props.card.column}
      </p>
      <p>{props.card.description}</p>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      {props.card.type === "epic" && props.card.column === "design" && (
        <button type="button" onClick={() => approveTo("split")}>
          人批：设计 → 拆分
        </button>
      )}
      {props.card.type === "task" && props.card.column === "accept" && (
        <button type="button" onClick={() => approveTo("done")}>
          人批：验收 → Done
        </button>
      )}
      {props.card.frozen && (
        <div>
          <button
            type="button"
            onClick={async () => {
              await api.humanDecision(props.card.id, "return_dev");
              props.onChanged();
            }}
          >
            解冻→开发
          </button>
          <button
            type="button"
            onClick={async () => {
              await api.humanDecision(props.card.id, "force_accept");
              props.onChanged();
            }}
          >
            解冻→验收
          </button>
          <button
            type="button"
            onClick={async () => {
              await api.humanDecision(props.card.id, "close_done");
              props.onChanged();
            }}
          >
            关闭→Done
          </button>
        </div>
      )}

      <h3>评论 / @Bot</h3>
      <ul>
        {comments.map((c) => (
          <li key={c.id}>
            <strong>{c.author}</strong>: {c.body}
          </li>
        ))}
      </ul>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
      <button
        type="button"
        onClick={async () => {
          await api.addComment(props.card.id, "human", body);
          setBody("");
          const list = await api.listComments(props.card.id);
          setComments(list);
          props.onChanged();
        }}
      >
        发送
      </button>
    </aside>
  );
}
```

`apps/board-web/src/App.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, type Card } from "./api";
import { BoardView } from "./BoardView";
import { CardDrawer } from "./CardDrawer";

const BOARD_KEY = "aiw.boardId";

export function App() {
  const [boardId, setBoardId] = useState<string | null>(
    () => localStorage.getItem(BOARD_KEY),
  );
  const [cards, setCards] = useState<Card[]>([]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [workspacePath, setWorkspacePath] = useState(
    "/tmp/ai-workforce-demo-ws",
  );
  const [title, setTitle] = useState("");

  const refresh = useCallback(async () => {
    if (!boardId) return;
    const list = await api.listCards(boardId);
    setCards(list);
    if (selected) {
      setSelected(list.find((c) => c.id === selected.id) ?? null);
    }
  }, [boardId, selected]);

  useEffect(() => {
    refresh().catch(console.error);
  }, [boardId]);

  if (!boardId) {
    return (
      <div className="app">
        <h1>AI Workforce</h1>
        <label>
          Workspace 路径
          <input
            value={workspacePath}
            onChange={(e) => setWorkspacePath(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <button
          type="button"
          onClick={async () => {
            const board = await api.createBoard("Local Board", workspacePath);
            localStorage.setItem(BOARD_KEY, board.id);
            setBoardId(board.id);
          }}
        >
          创建看板
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <header
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20 }}>AI Workforce</h1>
        <input
          placeholder="新卡片标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          type="button"
          onClick={async () => {
            await api.createCard(boardId, {
              type: "requirement",
              title: title || "新需求",
              column: "requirements",
            });
            setTitle("");
            await refresh();
          }}
        >
          + 需求
        </button>
        <button
          type="button"
          onClick={async () => {
            await api.createCard(boardId, {
              type: "epic",
              title: title || "新主题",
              column: "design",
            });
            setTitle("");
            await refresh();
          }}
        >
          + Epic(设计列)
        </button>
        <button
          type="button"
          onClick={async () => {
            await api.createCard(boardId, {
              type: "task",
              title: title || "新任务",
              column: "dev",
            });
            setTitle("");
            await refresh();
          }}
        >
          + 任务(开发列)
        </button>
        <button type="button" onClick={() => refresh()}>
          刷新
        </button>
      </header>
      <BoardView cards={cards} onOpen={setSelected} />
      {selected && (
        <CardDrawer
          card={selected}
          onClose={() => setSelected(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
```

`apps/board-web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 3: Install and smoke-run**

```bash
pnpm install
pnpm --filter @ai-workforce/domain build
pnpm --filter @ai-workforce/board-api dev
# other terminal:
pnpm --filter @ai-workforce/board-web dev
```

Manual check:
1. Open `http://127.0.0.1:5173`
2. Create board
3. Add requirement + epic
4. Open epic → 人批 设计→拆分
5. Comment `@Design Bot hi` then `GET /api/boards/:id/jobs` shows open job (via browser network or curl)

- [ ] **Step 4: Commit**

```bash
git add apps/board-web
git commit -m "feat(board-web): add kanban UI with gates and comments"
```

---

### Task 8: Root README + Plan 1 acceptance script

**Files:**
- Create: `README.md`
- Create: `scripts/plan1-smoke.sh`
- Modify: `package.json` (add `dev:api`, `dev:web` scripts)

**Interfaces:**
- Consumes: running API
- Produces: documented runbook; shell smoke that hits REST without UI

- [ ] **Step 1: Add scripts and README**

Root `package.json` scripts append:

```json
{
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "dev:api": "pnpm --filter @ai-workforce/board-api dev",
    "dev:web": "pnpm --filter @ai-workforce/board-web dev"
  }
}
```

`README.md`:

```markdown
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
```

`scripts/plan1-smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
API="${API:-http://127.0.0.1:8787}"
BOARD=$(curl -sf -X POST "$API/boards" -H 'content-type: application/json' \
  -d '{"name":"Smoke","workspacePath":"/tmp/aiw-smoke"}')
BOARD_ID=$(echo "$BOARD" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
EPIC=$(curl -sf -X POST "$API/boards/$BOARD_ID/cards" -H 'content-type: application/json' \
  -d '{"type":"epic","title":"E","column":"design","description":""}')
EPIC_ID=$(echo "$EPIC" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
curl -sf -X POST "$API/cards/$EPIC_ID/move" -H 'content-type: application/json' \
  -d '{"to":"split","actor":"human","humanApproved":true}' >/dev/null
TASK=$(curl -sf -X POST "$API/boards/$BOARD_ID/cards" -H 'content-type: application/json' \
  -d '{"type":"task","title":"T","column":"test","description":""}')
TASK_ID=$(echo "$TASK" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
for i in 1 2 3; do
  BODY=$(curl -sf -X POST "$API/cards/$TASK_ID/test-result" -H 'content-type: application/json' \
    -d '{"passed":false}')
  if [[ "$i" -lt 3 ]]; then
    # move back to test for next failure simulation
    curl -sf -X POST "$API/cards/$TASK_ID/move" -H 'content-type: application/json' \
      -d '{"to":"test","actor":"human","humanApproved":true}' >/dev/null || true
    # human move test←dev may need no gate; use update via test-result path only:
    # After failure card is in dev; put back to test with bot move
    curl -sf -X POST "$API/cards/$TASK_ID/move" -H 'content-type: application/json' \
      -d '{"to":"test","actor":"bot"}' >/dev/null
  fi
done
echo "$BODY" | python3 -c 'import sys,json; c=json.load(sys.stdin); assert c["frozen"] is True, c; print("plan1 smoke ok", c["reworkCount"])'
```

- [ ] **Step 2: Make executable and run against API**

```bash
chmod +x scripts/plan1-smoke.sh
pnpm dev:api &
sleep 1
./scripts/plan1-smoke.sh
```

Expected stdout: `plan1 smoke ok 3`

- [ ] **Step 3: Commit**

```bash
git add README.md scripts/plan1-smoke.sh package.json
git commit -m "docs: add Plan 1 runbook and API smoke script"
```

---

## Plan 1 self-review

### Spec coverage (Plan 1 slice)

| Spec item | Task |
|-----------|------|
| Columns + occupancy | Task 2 |
| Human gates design→split, accept→done | Task 3, 6, 7 |
| Rework ≥3 freeze + human decision | Task 4, 6, 7 |
| Epic / requirement / task model | Task 5–7 |
| Comments + @ → Job record | Task 6 |
| Employees seeded | Task 5 |
| ArtifactRef on card | Task 5 (storage); UI display can be Plan 2 polish |
| Board ↔ workspacePath | Task 5–7 |
| Worker / Cursor / streaming / Split bots | **Deferred to Plan 2–3** |

### Placeholder scan

No TBD/TODO left in task steps.

### Type consistency

- `ColumnId` / `CardType` / `Actor` shared from `@ai-workforce/domain`
- API persists `column_id` mapped to domain `column`
- `REWORK_LIMIT = 3` matches spec
- Mention roles lowercase map to employee `role` field

---

## Follow-on plans (not written yet)

**Plan 2 — Worker + Cursor:** `apps/worker`, `packages/agent` with `AgentDriver` + Cursor local adapter; claim jobs; oneshot writeback comments/links.

**Plan 3 — Realtime + role bots:** WebSocket bridge, Design sidebar chat, Split/Verify task generation, Dev/Test/Review automation completing MVP success criteria.
