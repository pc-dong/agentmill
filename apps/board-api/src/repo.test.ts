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
});
