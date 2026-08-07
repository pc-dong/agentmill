# Requirement BA Epic/PRD Clarification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let requirement cards clarify with BA Bot (sidebar chat + optional Cursor deep-dive), then settle into Marriott-style Epic/PRD files in the board workspace and link/create Epic cards per the approved design.

**Architecture:** Extend jobs with `payload` + triggers `settle` | `deep_dive`. UI validates BA protocol lines then enqueues a BA job; Worker writes files under `workspacePath` and calls `POST /cards/:id/ba-settle` to update SQLite (create Epic card on `create`, link PRD artifacts on `link`). Session chat reuses Plan 3 WS with `employee_role=ba`. Deep-dive is oneshot with BA prompt; human still clicks settle afterward.

**Tech Stack:** Existing monorepo — `@ai-workforce/agent` parsers/prompts/templates, `board-api` (Hono+SQLite), `worker` (tsx), `board-web` (React), Mock/Cursor drivers.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-requirement-ba-epic-prd-design.md`
- Write files only from Worker (`cwd` = board `workspacePath`); API never writes workspace files
- `EPIC_MODE create` → Epic dir + PRD + Epic card in `requirements` + set requirement `epicId`
- `EPIC_MODE link` → PRD only + index update; requirement must already have `epicId`
- If requirement already has `epicId` and protocol says `create` → force `link` + warning comment
- BA never moves cards across human gates; never auto-settles on poll
- Mention regex must include `@BA Bot`
- Tests pass without `CURSOR_API_KEY` (Mock)
- Do not break `scripts/plan3-smoke.sh`
- Existing boards created before this plan lack BA employee — smoke/tests use **new** boards; document recreate or optional seed later (YAGNI seed endpoint)

## File structure (locked in)

```text
packages/agent/
  src/parseBaSettle.ts          # EPIC_* / PRD_* protocol
  src/parseBaSettle.test.ts
  src/baDocs.ts                 # render + writeFs write helpers (pure path builders + markdown)
  src/baDocs.test.ts
  src/prompts.ts                # ba + baDeepDive prompts
  src/mock.ts                   # ba settle/deep_dive + chat protocol lines
  templates/ba/                 # slim Marriott-aligned templates
    EPIC.md.tpl
    shared-context.md.tpl
    PRD.md.tpl
apps/board-api/
  src/db.ts                     # jobs.payload column
  src/repo.ts                   # ba employee; createJob payload/triggers; findEpicByEpicId
  src/routes.ts                 # ba-settle + ba-jobs; mention @BA; session role ba
  src/baSettle.test.ts          # or routes.test.ts cases
apps/worker/
  src/baWrite.ts                # write docs from protocol + templates
  src/baWrite.test.ts
  src/executor.ts               # settle vs deep_dive vs oneshot branches
  src/boardClient.ts            # baSettle, createBaJob helpers
  src/sessionRunner.ts          # use session employee role / ba for requirements
apps/board-web/
  src/RequirementChat.tsx
  src/CardDrawer.tsx            # mount RequirementChat
  src/api.ts                    # createBaJob, baSettle (if UI needs), createSession role
scripts/plan4-ba-smoke.sh
README.md                       # short BA section
```

---

### Task 1: BA employee + prompts + slim templates

**Files:**
- Modify: `apps/board-api/src/repo.ts` (`DEFAULT_EMPLOYEES`)
- Modify: `packages/agent/src/prompts.ts`
- Modify: `apps/board-api/src/routes.ts` (`mentionRe`)
- Create: `packages/agent/templates/ba/EPIC.md.tpl`
- Create: `packages/agent/templates/ba/shared-context.md.tpl`
- Create: `packages/agent/templates/ba/PRD.md.tpl`
- Modify: `apps/board-api/src/repo.test.ts` (assert BA seeded)

**Interfaces:**
- Produces: employee `role: "ba"`, `displayName: "BA Bot"`, `watchColumns: ["requirements"]`
- Produces: `ROLE_PROMPTS.ba` and `ROLE_PROMPTS.baDeepDive` strings
- Produces: template files readable later via `path.join(agentPackageRoot, "templates/ba/...")`

- [ ] **Step 1: Write failing test for BA seed**

In `apps/board-api/src/repo.test.ts` add:

```ts
it("seeds BA Bot watching requirements", () => {
  const board = repo.createBoard({ name: "b", workspacePath: "/tmp/x" });
  const ba = repo.listEmployees(board.id).find((e) => e.role === "ba");
  expect(ba?.displayName).toBe("BA Bot");
  expect(ba?.watchColumns).toEqual(["requirements"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-workforce/board-api exec vitest run src/repo.test.ts -t "seeds BA"`
Expected: FAIL (no ba employee)

- [ ] **Step 3: Add DEFAULT_EMPLOYEES entry + mention regex + prompts + templates**

`repo.ts` — append to `DEFAULT_EMPLOYEES`:

```ts
{ role: "ba", displayName: "BA Bot", watchColumns: ["requirements"] },
```

`routes.ts`:

```ts
const mentionRe = /@(Design|Split|Verify|Dev|Test|Review|BA)\s*Bot/i;
```

`prompts.ts` — add:

```ts
  ba: [
    "You are BA Bot. Clarify requirements with grilling questions.",
    "When ready to settle, end with protocol lines:",
    "EPIC_MODE create|link",
    "EPIC_ID E-<DOMAIN>-<NNN>",
    "EPIC_SLUG <slug>",
    "EPIC_TITLE <title>",
    "PRD_ID P-<epicNNN>-<nn>",
    "PRD_SLUG <slug>",
    "PRD_TITLE <title>",
    "ARTIFACT file docs/epics/<epic-id>-<slug>/EPIC.md Epic",
    "ARTIFACT file docs/epics/<epic-id>-<slug>/shared-context.md Shared",
    "ARTIFACT file docs/epics/<epic-id>-<slug>/prds/<prd-id>-<slug>.md PRD",
    "For link mode omit writing new EPIC.md/shared-context ARTIFACT lines if unchanged; always include PRD ARTIFACT.",
  ].join(" "),
  baDeepDive: [
    "You are BA Bot in Cursor deep-dive mode.",
    "Prefer workspace docs/template and any epic-prd skills if present.",
    "Still end with the same EPIC_MODE / EPIC_* / PRD_* / ARTIFACT protocol lines.",
    "Do not change kanban columns.",
  ].join(" "),
```

Create slim templates (placeholders `{{EPIC_ID}}`, `{{EPIC_TITLE}}`, `{{PRD_ID}}`, `{{PRD_TITLE}}`, `{{SLUG}}`, `{{SUMMARY}}`):

`EPIC.md.tpl` — meta + PRD index stub + sections 背景/目标/范围; `shared-context.md.tpl` — 术语/对象 stubs; `PRD.md.tpl` — 归属 + 需求说明 + AC stub. Keep each under ~40 lines.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ai-workforce/board-api exec vitest run src/repo.test.ts -t "seeds BA"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/board-api/src/repo.ts apps/board-api/src/repo.test.ts apps/board-api/src/routes.ts \
  packages/agent/src/prompts.ts packages/agent/templates/ba
git commit -m "feat(ba): seed BA Bot, prompts, and slim Epic/PRD templates"
```

---

### Task 2: parseBaSettle + ba-settle API + job payload

**Files:**
- Create: `packages/agent/src/parseBaSettle.ts`
- Create: `packages/agent/src/parseBaSettle.test.ts`
- Modify: `packages/agent/src/index.ts` (re-export)
- Modify: `packages/agent/src/parse.ts` (keep ARTIFACT shared — parseBaSettle calls `parseArtifactHints`)
- Modify: `apps/board-api/src/db.ts` — `ensureColumn(db, "jobs", "payload", "TEXT")`
- Modify: `apps/board-api/src/repo.ts` — JobRecord.payload; createJob trigger+payload; `findEpicCardByEpicId`
- Modify: `apps/board-api/src/routes.ts` — `POST /cards/:cardId/ba-settle`, `POST /cards/:cardId/ba-jobs`
- Modify: `apps/board-api/src/routes.test.ts` or Create: `apps/board-api/src/baSettle.test.ts`

**Interfaces:**

```ts
// packages/agent/src/parseBaSettle.ts
export type BaSettleProtocol = {
  mode: "create" | "link";
  epicId: string;
  epicSlug: string;
  epicTitle: string;
  prdId: string;
  prdSlug: string;
  prdTitle: string;
  artifacts: ArtifactHint[];
};

export function parseBaSettle(summary: string): BaSettleProtocol | { error: string };
export function epicDirRel(p: BaSettleProtocol): string; // docs/epics/${epicId}-${epicSlug}
export function prdRel(p: BaSettleProtocol): string;
```

```ts
// repo.createJob
trigger: "mention" | "poll" | "settle" | "deep_dive";
payload?: string | null;

// POST /cards/:cardId/ba-settle body
{
  mode: "create" | "link";
  epicKey: string;       // E-XXX-001
  epicTitle: string;
  epicSlug: string;
  artifacts: ArtifactHint[];
  warning?: string;      // e.g. forced link
}

// POST /cards/:cardId/ba-jobs body
{ kind: "settle" | "deep_dive"; summary: string }
// → { job: JobRecord }
```

Epic card description **must** start with `epic_id: E-XXX-001\n` for lookup.

- [ ] **Step 1: Write failing parseBaSettle tests**

```ts
import { describe, expect, it } from "vitest";
import { parseBaSettle } from "./parseBaSettle.js";

const sample = `
EPIC_MODE create
EPIC_ID E-DEMO-001
EPIC_SLUG login
EPIC_TITLE Login theme
PRD_ID P-001-01
PRD_SLUG oauth
PRD_TITLE OAuth login
ARTIFACT file docs/epics/E-DEMO-001-login/EPIC.md Epic
ARTIFACT file docs/epics/E-DEMO-001-login/shared-context.md Shared
ARTIFACT file docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md PRD
`;

describe("parseBaSettle", () => {
  it("parses create protocol", () => {
    const r = parseBaSettle(sample);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.mode).toBe("create");
    expect(r.epicId).toBe("E-DEMO-001");
    expect(r.artifacts).toHaveLength(3);
  });

  it("rejects missing EPIC_MODE", () => {
    const r = parseBaSettle("PRD_ID P-001-01");
    expect("error" in r).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-workforce/agent exec vitest run src/parseBaSettle.test.ts`
Expected: FAIL (module missing)

- [ ] **Step 3: Implement parseBaSettle**

Parse lines with `/^EPIC_MODE\s+(create|link)$/i` etc. Require all of: mode, epicId, epicSlug, epicTitle, prdId, prdSlug, prdTitle. Require ≥1 `ARTIFACT file` for create (prefer 3); for link require ≥1 PRD path artifact. Export helpers `epicDirRel` / `prdRel`.

- [ ] **Step 4: Run parse tests — PASS**

- [ ] **Step 5: Write failing ba-settle API test**

```ts
it("ba-settle create creates epic card and links requirement", async () => {
  const board = repo.createBoard({ name: "b", workspacePath: "/tmp/ws" });
  const req = repo.createCard({
    boardId: board.id,
    type: "requirement",
    title: "Need login",
    description: "",
    column: "requirements",
  });
  const res = await app.request(`/cards/${req.id}/ba-settle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "create",
      epicKey: "E-DEMO-001",
      epicTitle: "Login",
      epicSlug: "login",
      artifacts: [
        { kind: "file", href: "docs/epics/E-DEMO-001-login/EPIC.md", label: "Epic" },
        { kind: "file", href: "docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md", label: "PRD" },
      ],
    }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.requirement.epicId).toBeTruthy();
  expect(body.epic.type).toBe("epic");
  expect(body.epic.column).toBe("requirements");
  expect(body.epic.description.startsWith("epic_id: E-DEMO-001")).toBe(true);
  // second call idempotent
  const res2 = await app.request(`/cards/${req.id}/ba-settle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "create",
      epicKey: "E-DEMO-001",
      epicTitle: "Login",
      epicSlug: "login",
      artifacts: [{ kind: "file", href: "docs/epics/E-DEMO-001-login/EPIC.md", label: "Epic" }],
    }),
  });
  const body2 = await res2.json();
  expect(body2.epic.id).toBe(body.epic.id);
});
```

- [ ] **Step 6: Implement db payload + repo helpers + routes**

`findEpicCardByEpicId(boardId, epicKey)`: list epics where `description.startsWith(\`epic_id: ${epicKey}\`)` or artifacts href includes `/${epicKey}-`.

`ba-settle` logic:
1. Load requirement card; 404 if not requirement
2. Effective mode: if `mode===create` && `card.epicId` → treat as `link`, set warning
3. `link`: require `card.epicId`; load epic; append artifacts to both; comment audit
4. `create`: find or create epic with title `epicTitle`, description `epic_id: ${epicKey}\n`, column `requirements`, artifacts; `updateCard(req, { epicId: epic.id, artifacts: merge })`; audit comment

`ba-jobs`: resolve ba employee; `createJob({ trigger: kind, payload: summary })`; return job.

Persist payload in INSERT/SELECT for jobs.

- [ ] **Step 7: Run API tests — PASS**

Run: `pnpm --filter @ai-workforce/board-api exec vitest run src/baSettle.test.ts src/routes.test.ts`

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/parseBaSettle.ts packages/agent/src/parseBaSettle.test.ts packages/agent/src/index.ts \
  apps/board-api/src/db.ts apps/board-api/src/repo.ts apps/board-api/src/routes.ts apps/board-api/src/baSettle.test.ts
git commit -m "feat(ba): parse settle protocol and ba-settle/ba-jobs API"
```

---

### Task 3: Worker write docs + settle/deep_dive execution

**Files:**
- Create: `apps/worker/src/baWrite.ts`
- Create: `apps/worker/src/baWrite.test.ts`
- Modify: `apps/worker/src/boardClient.ts` — `baSettle`, job.payload typing
- Modify: `apps/worker/src/executor.ts`
- Modify: `packages/agent/src/mock.ts` — ba / baDeepDive oneshot + chatStream protocol
- Modify: `apps/worker/src/outcomes.ts` — `case "ba": return;` (no column moves)

**Interfaces:**

```ts
// baWrite.ts
export async function writeBaDocuments(input: {
  workspacePath: string;
  protocol: BaSettleProtocol;
  summaryMarkdown: string; // conversation residue for {{SUMMARY}}
  templatesDir: string;
}): Promise<{ written: string[]; overwritten: string[] }>;
```

- [ ] **Step 1: Write failing baWrite test** using `fs.mkdtempSync` — create mode writes 3 files; link mode writes only PRD and appends a row to EPIC.md index if EPIC.md exists.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement writeBaDocuments**

Resolve templates from `fileURLToPath(new URL('../../../../packages/agent/templates/ba', import.meta.url))` (adjust relative from `apps/worker/src`) **or** pass `templatesDir` from env `AIW_BA_TEMPLATES`. Replace placeholders; `mkdirSync` recursive; write UTF-8. For link: if EPIC.md missing, skip index patch (comment in return). Index patch: if table row for `prdId` missing, append `| ${prdId} | ${prdTitle} | … | Draft |`.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Wire executor**

```ts
const jobFull = await client.getJob?.(job.id) // OR extend claim response / listClaimable to include payload+trigger

// Prefer: claimable jobs already return trigger+payload after repo change
if (job.trigger === "settle") {
  const parsed = parseBaSettle(job.payload ?? "");
  if ("error" in parsed) {
    await client.failJob(job.id, parsed.error);
    return;
  }
  let protocol = parsed;
  if (card.epicId && protocol.mode === "create") {
    protocol = { ...protocol, mode: "link" };
  }
  const { written, overwritten } = await writeBaDocuments({...});
  await client.baSettle(card.id, {
    mode: protocol.mode,
    epicKey: protocol.epicId,
    epicTitle: protocol.epicTitle,
    epicSlug: protocol.epicSlug,
    artifacts: protocol.artifacts.map(a => ({...a, label: a.label ?? ""})),
    warning: card.epicId && parsed.mode === "create"
      ? "create requested but epicId set; forced link"
      : undefined,
  });
  await client.completeJob(job.id, {
    summary: `ba-settle wrote: ${written.join(", ")}`,
    artifacts: protocol.artifacts.map(...),
  });
  return;
}

if (job.trigger === "deep_dive" || employee.role === "ba") {
  // deep_dive or mention/poll ba: oneshot with baDeepDive or ba prompt
  const roleKey = job.trigger === "deep_dive" ? "baDeepDive" : "ba";
  // buildPrompt needs to accept baDeepDive — extend buildPrompt OR inline ROLE_PROMPTS[roleKey]
  ...
  // on success completeJob; do NOT call baSettle; applyRoleOutcome no-op for ba
  await client.postComment(card.id, "bot", result.summary);
  return;
}
```

Extend `listClaimableJobs` / Job type with `payload: string | null`.

Mock `oneshot` for `ba` / `baDeepDive`: return fixed create protocol for card title slugified.

Mock `chatStream` when `role === "ba"`: stream then done with create protocol lines (use cardId in slug).

- [ ] **Step 6: Unit/integration test executor settle with mock fs + mock fetch boardClient** — minimal fake client recording baSettle calls.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/baWrite.ts apps/worker/src/baWrite.test.ts apps/worker/src/executor.ts \
  apps/worker/src/boardClient.ts apps/worker/src/outcomes.ts packages/agent/src/mock.ts
git commit -m "feat(worker): write BA Epic/PRD docs on settle jobs"
```

---

### Task 4: RequirementChat UI + session role ba

**Files:**
- Create: `apps/board-web/src/RequirementChat.tsx`
- Modify: `apps/board-web/src/CardDrawer.tsx`
- Modify: `apps/board-web/src/api.ts` — `createSession(boardId, cardId, role?)`, `createBaJob`
- Modify: `apps/board-api` session create to accept `employeeRole` (if not already)
- Modify: `apps/worker/src/sessionRunner.ts` — pass `role: session.employeeRole || (card.type==="requirement"?"ba":"design")` into chatStream (load session meta via new GET or include in WS hello)

**Check sessions create route** — today may hardcode design. Change:

```ts
// POST body optional { employeeRole: "ba" | "design" | ... }
sessions.createSession({ boardId, cardId, employeeRole: body.employeeRole ?? "design" })
```

WS handler must load session.employeeRole when forwarding to worker (already on session row).

- [ ] **Step 1: Extend API createSession + board-web api.ts**

```ts
createSession: (boardId, cardId, employeeRole = "design") =>
  json(fetch(..., { method: "POST", body: JSON.stringify({ employeeRole }) })),

createBaJob: (cardId, body: { kind: "settle" | "deep_dive"; summary: string }) =>
  json(fetch(`${base}/cards/${cardId}/ba-jobs`, { method: "POST", ... })),
```

- [ ] **Step 2: Implement RequirementChat**

Clone DesignChat structure:
- Status line: `card.epicId` ? linked epic title from props : 「将新建 Epic + PRD」
- Bot label: `BA Bot`
- `startSession` → `createSession(boardId, cardId, "ba")`
- Settle: take last assistant body → `parseBaSettle` (duplicate thin regex in web OR share by copying parseBaSettle into web via importing from a tiny shared path — **MVP: duplicate parseBaSettle minimal check in RequirementChat** matching agent package, or add `packages/agent` dependency already present — board-web may not depend on agent; **inline the same parseBaSettle by depending on `@ai-workforce/agent` in board-web** if package.json allows, else duplicate). Prefer add dependency `"@ai-workforce/agent": "workspace:*"` to board-web if missing.
- On settle success path: `createBaJob(cardId, { kind: "settle", summary: lastAssistant.body })` then poll/refresh for ~5s OR show 「已提交沉淀 Job，请等 Worker」; close session via existing settleSession with artifacts from protocol (optional dual-write: session settle for UX + ba-job for files). **Spec order:** Job first; after job, Worker ba-settles. UI: createBaJob then `settleSession` with artifacts for session close only (session settle should NOT invent epic cards — only close session). So: `createBaJob` → `api.settleSession(sessionId, { comment: "ba settle enqueued" })` without relying on session settle for epic creation.

- [ ] **Step 3: Mount in CardDrawer when `type===requirement` && `column===requirements`**

Pass `epicTitle` from cards list.

- [ ] **Step 4: Fix sessionRunner role**

When handling message, `GET /sessions/:id` if needed for `employeeRole`, pass to `chatStream({ role: employeeRole })`.

- [ ] **Step 5: Manual typecheck**

Run: `pnpm --filter @ai-workforce/board-web exec tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add apps/board-web apps/board-api/src/routes.ts apps/board-api/src/sessions.ts apps/worker/src/sessionRunner.ts
git commit -m "feat(web): RequirementChat with BA settle job enqueue"
```

---

### Task 5: Deep-dive button + plan4 smoke + README

**Files:**
- Modify: `apps/board-web/src/RequirementChat.tsx` — button「在 Cursor 中深挖」→ `createBaJob({ kind: "deep_dive", summary: last messages joined or card title })`
- Create: `scripts/plan4-ba-smoke.sh`
- Modify: `README.md` — BA clarification section

- [ ] **Step 1: Deep-dive button**

Disabled when busy; on click enqueue deep_dive with payload = transcript text or `Deep dive for: ${title}`; show tip「完成后请再点沉淀」.

- [ ] **Step 2: Write plan4-ba-smoke.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
# start API if needed (copy plan3 pattern)
# BOARD with workspacePath=$TMP/ws
# create requirement (no epic)
# POST ba-jobs settle with full create protocol in summary
# run worker once.ts
# assert files exist under $TMP/ws/docs/epics/...
# assert requirement.epicId set and epic card present
# second requirement with epicId + link protocol → only PRD file
```

Ensure `once.ts` claims settle jobs (claimable includes settle trigger).

- [ ] **Step 3: Run smoke**

Run: `bash scripts/plan4-ba-smoke.sh`
Expected: exit 0; prints ok

- [ ] **Step 4: Run plan3 smoke still green**

Run: `bash scripts/plan3-smoke.sh`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add scripts/plan4-ba-smoke.sh README.md apps/board-web/src/RequirementChat.tsx
git commit -m "feat(ba): deep-dive entry and plan4 BA settle smoke"
```

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| BA Bot employee + watch requirements | T1 |
| Slim templates | T1 |
| Protocol parse | T2 |
| ba-settle create/link + idempotent epic | T2 |
| Write on Worker only | T3 |
| Force link when epicId set | T2/T3 |
| RequirementChat + settle | T4 |
| Session role ba | T4 |
| Cursor deep-dive job | T5 |
| Smoke | T5 |
| No TECH-DESIGN / no auto column | T3 outcomes no-op |

## Placeholder / consistency self-review

- Triggers and payload named consistently: `settle` | `deep_dive`
- `epicKey` in API = protocol `EPIC_ID`
- Epic description prefix `epic_id: ` exact
- Mock chat role `"ba"` aligned with sessionRunner

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-requirement-ba-epic-prd.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session executes tasks with checkpoints  

Which approach?
