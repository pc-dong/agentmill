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

function tempDb(): { repo: BoardRepo; sessions: SessionRepo } {
  const file = path.join(
    os.tmpdir(),
    `aiw-board-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  tmpFiles.push(file);
  const db = openDb(file);
  migrate(db);
  return { repo: new BoardRepo(db), sessions: new SessionRepo(db) };
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
    expect(repo.getCard(epic.id)?.lockedJobId).toBe(job.id);
    expect(repo.claimJob(job.id, "worker-2")).toBeNull();
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

  it("createPollJobs skips card+employee pairs with any prior job (done/failed)", () => {
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

    expect(repo.createPollJobs(board.id)).toBe(0);
    expect(repo.listOpenJobs(board.id)).toHaveLength(0);
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
