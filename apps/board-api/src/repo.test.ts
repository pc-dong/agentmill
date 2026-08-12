import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDb } from "./db.js";
import { BoardRepo } from "./repo.js";
import { SessionRepo } from "./sessions.js";

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

function tempDb(): {
  repo: BoardRepo;
  sessions: SessionRepo;
  db: ReturnType<typeof openDb>;
} {
  const file = path.join(
    os.tmpdir(),
    `aiw-board-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  tmpFiles.push(file);
  const db = openDb(file);
  migrate(db);
  return { repo: new BoardRepo(db), sessions: new SessionRepo(db), db };
}

describe("BoardRepo", () => {
  it("creates a board and cards, lists by column", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({
      name: "Demo",
      workspacePath: "/tmp/demo-workspace",
    });
    expect(board.id).toBeTruthy();

    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Auth theme",
      column: "requirements",
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
    const { repo } = tempDb();
    const board = repo.createBoard({
      name: "Demo",
      workspacePath: "/tmp/ws",
    });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
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

  it("claims a job and locks the card; second claim fails", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
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
    expect(claimed?.progress).toBe("已认领，准备执行");
    expect(claimed?.progressAt).toBeTruthy();
    expect(repo.getCard(epic.id)?.lockedJobId).toBe(job.id);
    expect(repo.getCard(epic.id)?.activeJob?.progress).toBe("已认领，准备执行");
    expect(repo.getCard(epic.id)?.activeJob?.displayName).toBe("Design Bot");
    expect(repo.claimJob(job.id, "worker-2")).toBeNull();
  });

  it("setJobProgress updates claimed job and is visible on card.activeJob", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
      description: "",
    });
    const emp = repo.listEmployees(board.id).find((e) => e.role === "design")!;
    const job = repo.createJob({
      boardId: board.id,
      cardId: epic.id,
      employeeId: emp.id,
      trigger: "poll",
    });
    repo.claimJob(job.id, "worker-1");
    const updated = repo.setJobProgress(job.id, "执行中：调用 Cursor…");
    expect(updated?.progress).toBe("执行中：调用 Cursor…");
    expect(repo.getCard(epic.id)?.activeJob?.progress).toBe(
      "执行中：调用 Cursor…",
    );
    expect(repo.setJobProgress(job.id, "x")).not.toBeNull();
    repo.completeJob(job.id, { summary: "done", artifacts: [] });
    expect(repo.setJobProgress(job.id, "too late")).toBeNull();
  });

  it("claimJob returns null when card is frozen", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
      description: "",
    });
    repo.updateCard(epic.id, { frozen: true });
    const emp = repo.listEmployees(board.id).find((e) => e.role === "design")!;
    const job = repo.createJob({
      boardId: board.id,
      cardId: epic.id,
      employeeId: emp.id,
      trigger: "mention",
    });
    expect(repo.claimJob(job.id, "worker-1")).toBeNull();
    expect(repo.getCard(epic.id)?.lockedJobId).toBeNull();
    expect(repo.getJob(job.id)?.status).toBe("open");
  });

  it("failJob unlocks card, keeps column, adds comment, sets status failed", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
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
    const failed = repo.failJob(job.id, "something broke");
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("something broke");
    const card = repo.getCard(epic.id)!;
    expect(card.column).toBe("requirements");
    expect(card.lockedJobId).toBeNull();
    expect(
      repo.listComments(epic.id).some((c) => c.body === "something broke"),
    ).toBe(true);
  });

  it("createPollJobs skips frozen, locked, and busy cards; creates for idle watch-column card", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const designEmp = repo
      .listEmployees(board.id)
      .find((e) => e.role === "design")!;
    const theme = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Theme",
      column: "requirements",
      description: "",
    });

    const frozen = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "Frozen",
      column: "design",
      description: "",
      epicId: theme.id,
    });
    repo.updateCard(frozen.id, { frozen: true });

    const locked = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "Locked",
      column: "design",
      description: "",
      epicId: theme.id,
    });
    const lockJob = repo.createJob({
      boardId: board.id,
      cardId: locked.id,
      employeeId: designEmp.id,
      trigger: "mention",
    });
    repo.claimJob(lockJob.id, "worker-1");

    const openBusy = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "Open busy",
      column: "design",
      description: "",
      epicId: theme.id,
    });
    repo.createJob({
      boardId: board.id,
      cardId: openBusy.id,
      employeeId: designEmp.id,
      trigger: "mention",
    });

    const claimedBusy = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "Claimed busy",
      column: "design",
      description: "",
      epicId: theme.id,
    });
    const claimedJob = repo.createJob({
      boardId: board.id,
      cardId: claimedBusy.id,
      employeeId: designEmp.id,
      trigger: "mention",
    });
    repo.claimJob(claimedJob.id, "worker-2");

    const idle = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "Idle",
      column: "design",
      description: "",
      epicId: theme.id,
    });

    const created = repo.createPollJobs(board.id);
    expect(created).toBe(1);

    const idleJob = repo
      .listOpenJobs(board.id)
      .find((j) => (j as { cardId: string }).cardId === idle.id) as
      | { cardId: string; employeeId: string; trigger: string }
      | undefined;
    expect(idleJob?.employeeId).toBe(designEmp.id);
    expect(idleJob?.trigger).toBe("poll");
  });

  it("createPollJobs skips finished jobs from the same column visit", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const designEmp = repo
      .listEmployees(board.id)
      .find((e) => e.role === "design")!;
    const theme = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Theme",
      column: "requirements",
      description: "",
    });

    const doneCard = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "Done card",
      column: "design",
      description: "",
      epicId: theme.id,
    });
    const doneJob = repo.createJob({
      boardId: board.id,
      cardId: doneCard.id,
      employeeId: designEmp.id,
      trigger: "poll",
    });
    repo.claimJob(doneJob.id, "worker-1");
    repo.completeJob(doneJob.id, { summary: "finished", artifacts: [] });

    const failedCard = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "Failed card",
      column: "design",
      description: "",
      epicId: theme.id,
    });
    const failedJob = repo.createJob({
      boardId: board.id,
      cardId: failedCard.id,
      employeeId: designEmp.id,
      trigger: "mention",
    });
    repo.claimJob(failedJob.id, "worker-1");
    repo.failJob(failedJob.id, "boom");

    // Same column visit → still blocked
    expect(repo.createPollJobs(board.id)).toBe(0);
    expect(repo.listOpenJobs(board.id)).toHaveLength(0);
  });

  it("createPollJobs re-polls after rework re-enters watch column", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const testEmp = repo.listEmployees(board.id).find((e) => e.role === "test")!;
    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "Rework task",
      column: "test",
      description: "",
    });
    const first = repo.createJob({
      boardId: board.id,
      cardId: task.id,
      employeeId: testEmp.id,
      trigger: "poll",
    });
    repo.claimJob(first.id, "worker-1");
    repo.completeJob(first.id, { summary: "TEST fail", artifacts: [] });
    expect(repo.createPollJobs(board.id)).toBe(0);

    // Leave and re-enter test → new column visit → poll again
    // Ensure column_entered_at is strictly after the prior job timestamp.
    const before = Date.now();
    while (Date.now() <= before) {
      /* spin ~1ms */
    }
    repo.updateCard(task.id, { column: "dev" });
    while (Date.now() <= before + 1) {
      /* spin */
    }
    repo.updateCard(task.id, { column: "test" });
    expect(repo.createPollJobs(board.id)).toBe(1);
    const again = repo
      .listOpenJobs(board.id)
      .find((j) => j.cardId === task.id && j.employeeId === testEmp.id);
    expect(again?.trigger).toBe("poll");
    expect(again?.id).not.toBe(first.id);
  });

  it("createPollJobs creates Dev poll when ad-hoc task enters dev", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const devEmp = repo.listEmployees(board.id).find((e) => e.role === "dev")!;
    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "Ad-hoc",
      column: "design",
      description: "",
      frozen: false,
    });
    expect(repo.createPollJobs(board.id)).toBe(0);

    const before = Date.now();
    while (Date.now() <= before) {
      /* spin */
    }
    repo.updateCard(task.id, { column: "dev" });
    expect(repo.getCard(task.id)?.columnEnteredAt).toBeTruthy();
    expect(repo.createPollJobs(board.id)).toBe(1);
    const job = repo
      .listOpenJobs(board.id)
      .find((j) => j.cardId === task.id && j.employeeId === devEmp.id);
    expect(job?.trigger).toBe("poll");
  });

  it("completeJob writes artifacts and unlocks", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
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

  it("completeJob dedupes artifacts by kind and href", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const card = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      column: "dev",
      description: "",
      artifacts: [
        { kind: "file", href: "docs/a.md", label: "A" },
        { kind: "file", href: "docs/b.md", label: "B" },
      ],
    });
    const emp = repo.listEmployees(board.id).find((e) => e.role === "dev")!;
    const job = repo.createJob({
      boardId: board.id,
      cardId: card.id,
      employeeId: emp.id,
      trigger: "poll",
    });
    repo.claimJob(job.id, "worker-1");
    repo.completeJob(job.id, {
      summary: "SUMMARY: again",
      artifacts: [
        { kind: "file", href: "docs/a.md", label: "A-new" },
        { kind: "file", href: "docs/c.md", label: "C" },
      ],
    });
    const updated = repo.getCard(card.id)!;
    expect(updated.artifacts).toEqual([
      { kind: "file", href: "docs/a.md", label: "A-new" },
      { kind: "file", href: "docs/b.md", label: "B" },
      { kind: "file", href: "docs/c.md", label: "C" },
    ]);
  });

  it("getCard dedupes legacy duplicate artifacts on read", () => {
    const { repo, db } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const card = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      column: "design",
      description: "",
    });
    db.prepare(`UPDATE cards SET artifacts_json=? WHERE id=?`).run(
      JSON.stringify([
        { kind: "file", href: "docs/a.md", label: "A" },
        { kind: "file", href: "docs/a.md", label: "A2" },
        { kind: "file", href: "docs/b.md" },
      ]),
      card.id,
    );
    expect(repo.getCard(card.id)?.artifacts).toEqual([
      { kind: "file", href: "docs/a.md", label: "A2" },
      { kind: "file", href: "docs/b.md" },
    ]);
  });

  it("claimJob returns null when card has an open chat session", () => {
    const { repo, sessions } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
      description: "",
    });
    sessions.createSession({ boardId: board.id, cardId: epic.id });
    const emp = repo.listEmployees(board.id).find((e) => e.role === "design")!;
    const job = repo.createJob({
      boardId: board.id,
      cardId: epic.id,
      employeeId: emp.id,
      trigger: "mention",
    });
    expect(repo.claimJob(job.id, "worker-1")).toBeNull();
    expect(repo.getCard(epic.id)?.lockedJobId).toBeNull();
    expect(repo.getJob(job.id)?.status).toBe("open");
  });

  it("createPollJobs skips cards with open chat sessions", () => {
    const { repo, sessions } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const designEmp = repo
      .listEmployees(board.id)
      .find((e) => e.role === "design")!;
    const theme = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Theme",
      column: "requirements",
      description: "",
    });

    const sessionCard = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "In session",
      column: "design",
      description: "",
      epicId: theme.id,
    });
    sessions.createSession({
      boardId: board.id,
      cardId: sessionCard.id,
    });

    const idle = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "Idle",
      column: "design",
      description: "",
      epicId: theme.id,
    });

    expect(repo.createPollJobs(board.id)).toBe(1);
    const openJobs = repo.listOpenJobs(board.id);
    expect(openJobs.some((j) => (j as { cardId: string }).cardId === sessionCard.id)).toBe(
      false,
    );
    expect(openJobs.some((j) => (j as { cardId: string }).cardId === idle.id)).toBe(
      true,
    );
    expect(
      (openJobs.find((j) => (j as { cardId: string }).cardId === idle.id) as {
        employeeId: string;
      }).employeeId,
    ).toBe(designEmp.id);
  });

  it("listClaimableJobs excludes jobs for cards with open chat sessions", () => {
    const { repo, sessions } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const designEmp = repo
      .listEmployees(board.id)
      .find((e) => e.role === "design")!;

    const sessionCard = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "In session",
      column: "requirements",
      description: "",
    });
    sessions.createSession({
      boardId: board.id,
      cardId: sessionCard.id,
    });
    const sessionJob = repo.createJob({
      boardId: board.id,
      cardId: sessionCard.id,
      employeeId: designEmp.id,
      trigger: "mention",
    });

    const freeCard = repo.createCard({
      boardId: board.id,
      type: "requirement",
      title: "Free",
      column: "design",
      description: "",
      epicId: sessionCard.id,
    });
    const freeJob = repo.createJob({
      boardId: board.id,
      cardId: freeCard.id,
      employeeId: designEmp.id,
      trigger: "mention",
    });

    const claimable = repo.listClaimableJobs(board.id);
    expect(claimable.map((j) => j.id)).toEqual([freeJob.id]);
    expect(claimable.some((j) => j.id === sessionJob.id)).toBe(false);
  });

  it("listClaimableJobs allows settle/deep_dive even with open session", () => {
    const { repo, sessions } = tempDb();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const ba = repo.listEmployees(board.id).find((e) => e.role === "ba")!;
    const card = repo.createCard({
      boardId: board.id,
      type: "requirement",
      title: "In chat",
      column: "requirements",
      description: "",
    });
    sessions.createSession({
      boardId: board.id,
      cardId: card.id,
      employeeRole: "ba",
    });
    const deepDive = repo.createJob({
      boardId: board.id,
      cardId: card.id,
      employeeId: ba.id,
      trigger: "deep_dive",
      payload: "transcript",
    });
    const mention = repo.createJob({
      boardId: board.id,
      cardId: card.id,
      employeeId: ba.id,
      trigger: "mention",
    });

    const claimable = repo.listClaimableJobs(board.id);
    expect(claimable.map((j) => j.id)).toContain(deepDive.id);
    expect(claimable.map((j) => j.id)).not.toContain(mention.id);
  });

  it("seeds BA Bot watching requirements", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "b", workspacePath: "/tmp/x" });
    const ba = repo.listEmployees(board.id).find((e) => e.role === "ba");
    expect(ba?.displayName).toBe("BA Bot");
    expect(ba?.watchColumns).toEqual(["requirements"]);
  });

  it("migrates stranded epics in design/split/verify into design cards", () => {
    const file = path.join(
      os.tmpdir(),
      `aiw-mig-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
    tmpFiles.push(file);
    const db = openDb(file);
    migrate(db);
    const repo = new BoardRepo(db);
    const board = repo.createBoard({ name: "mig", workspacePath: "/tmp/m" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Old Theme",
      column: "requirements",
      description: "",
    });
    const req = repo.createCard({
      boardId: board.id,
      type: "requirement",
      title: "Req",
      column: "requirements",
      description: "",
      epicId: epic.id,
    });
    db.prepare(`UPDATE cards SET column_id = 'design' WHERE id = ?`).run(epic.id);
    expect(repo.getCard(epic.id)!.column).toBe("design");

    migrate(db);

    const epicAfter = repo.getCard(epic.id)!;
    expect(epicAfter.type).toBe("epic");
    expect(epicAfter.column).toBe("requirements");

    const designs = repo.listCards(board.id).filter((c) => c.type === "design");
    expect(designs).toHaveLength(1);
    expect(designs[0]!.column).toBe("design");
    expect(designs[0]!.epicId).toBe(epic.id);
    expect(designs[0]!.requirementIds).toContain(req.id);
    expect(repo.getCard(req.id)!.status).toBe("in_progress");
  });

  it("syncRequirementStatus marks done when designs and tasks are Done", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "b", workspacePath: "/tmp/x" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      description: "",
      column: "requirements",
    });
    const req = repo.createCard({
      boardId: board.id,
      type: "requirement",
      title: "R",
      description: "",
      column: "requirements",
      epicId: epic.id,
      status: "open",
    });
    const design = repo.createDesignRound({
      boardId: board.id,
      epicId: epic.id,
      title: "D",
      requirementIds: [req.id],
    });
    expect(repo.getCard(req.id)!.status).toBe("in_progress");

    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      description: "",
      column: "design",
      designId: design.id,
      epicId: epic.id,
    });

    repo.updateCard(task.id, { column: "done" });
    repo.updateCard(design.id, { column: "done" });
    repo.syncRequirementStatusesForCard(repo.getCard(design.id)!);
    expect(repo.getCard(req.id)!.status).toBe("done");

    repo.updateCard(task.id, { column: "dev" });
    repo.syncRequirementStatusesForCard(repo.getCard(task.id)!);
    expect(repo.getCard(req.id)!.status).toBe("in_progress");
  });

  it("listCards repairs stuck requirement status", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "b", workspacePath: "/tmp/x" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      description: "",
      column: "requirements",
    });
    const req = repo.createCard({
      boardId: board.id,
      type: "requirement",
      title: "R",
      description: "",
      column: "requirements",
      epicId: epic.id,
      status: "in_progress",
    });
    const design = repo.createDesignRound({
      boardId: board.id,
      epicId: epic.id,
      title: "D",
      requirementIds: [req.id],
    });
    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      description: "",
      column: "done",
      designId: design.id,
      epicId: epic.id,
    });
    repo.updateCard(design.id, { column: "done" });
    // Simulate pre-fix stuck state: delivery done but status not synced.
    expect(repo.getCard(req.id)!.status).toBe("in_progress");
    expect(repo.getCard(task.id)!.column).toBe("done");

    const cards = repo.listCards(board.id);
    const synced = cards.find((c) => c.id === req.id)!;
    expect(synced.status).toBe("done");
  });

  it("markDesignSplitVerified and Dirty round-trip", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "b", workspacePath: "/tmp/x" });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "D",
      description: "",
      column: "design",
    });
    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      description: "",
      column: "design",
      designId: design.id,
      frozen: false,
    });
    expect(repo.getCard(design.id)!.splitVerifiedAt).toBeNull();
    repo.markDesignSplitVerified(design.id);
    expect(repo.getCard(design.id)!.splitVerifiedAt).toBeTruthy();
    repo.markDesignSplitDirty(design.id);
    expect(repo.getCard(design.id)!.splitVerifiedAt).toBeNull();
    expect(repo.getCard(task.id)!.frozen).toBe(true);
  });

  it("markDesignSplitDirty does not freeze tasks outside design", () => {
    const { repo } = tempDb();
    const board = repo.createBoard({ name: "b", workspacePath: "/tmp/x" });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "D",
      description: "",
      column: "design",
    });
    const inflight = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      description: "",
      column: "dev",
      designId: design.id,
      frozen: false,
    });
    repo.markDesignSplitVerified(design.id);
    repo.markDesignSplitDirty(design.id);
    expect(repo.getCard(inflight.id)!.frozen).toBe(false);
    expect(repo.getCard(inflight.id)!.column).toBe("dev");
  });
});
