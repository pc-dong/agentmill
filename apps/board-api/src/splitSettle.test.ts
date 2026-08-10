import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./routes.js";
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

function appWithRepo() {
  const file = path.join(os.tmpdir(), `aiw-split-settle-${Date.now()}.sqlite`);
  tmpFiles.push(file);
  const db = openDb(file);
  migrate(db);
  const repo = new BoardRepo(db);
  const sessions = new SessionRepo(db);
  return { app: createApp(repo, sessions), repo, sessions };
}

function designFixture(repo: BoardRepo) {
  const board = repo.createBoard({ name: "b", workspacePath: "/tmp/ws" });
  const epic = repo.createCard({
    boardId: board.id,
    type: "epic",
    title: "Epic",
    description: "",
    column: "requirements",
  });
  const design = repo.createCard({
    boardId: board.id,
    type: "design",
    title: "Design",
    description: "",
    column: "design",
    epicId: epic.id,
  });
  return { board, epic, design };
}

describe("split-settle", () => {
  it("create adds frozen task in design column", async () => {
    const { app, repo } = appWithRepo();
    const { design } = designFixture(repo);

    const res = await app.request(`/cards/${design.id}/split-settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ops: [
          {
            kind: "create",
            title: "Login API",
            description: "implement oauth",
            planPath: "docs/plans/login.md",
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toHaveLength(1);
    expect(body.applied[0].kind).toBe("create");
    const created = repo.getCard(body.applied[0].cardId);
    expect(created!.type).toBe("task");
    expect(created!.column).toBe("design");
    expect(created!.designId).toBe(design.id);
    expect(created!.frozen).toBe(true);
    expect(created!.description).toContain("plan: docs/plans/login.md");
  });

  it("resolves designId from task card", async () => {
    const { app, repo } = appWithRepo();
    const { design, epic, board } = designFixture(repo);
    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "Existing",
      description: "",
      column: "design",
      epicId: epic.id,
      designId: design.id,
      frozen: true,
    });

    const res = await app.request(`/cards/${task.id}/split-settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ops: [{ kind: "create", title: "New task", description: "scope" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.design.id).toBe(design.id);
    expect(body.applied[0].kind).toBe("create");
  });

  it("update succeeds on design-column task and dirties parent", async () => {
    const { app, repo } = appWithRepo();
    const { design, epic, board } = designFixture(repo);
    const sibling = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "Login API",
      description: "old scope",
      column: "design",
      epicId: epic.id,
      designId: design.id,
      frozen: true,
    });
    repo.markDesignSplitVerified(design.id);

    const res = await app.request(`/cards/${design.id}/split-settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ops: [
          {
            kind: "update",
            cardId: sibling.id,
            title: "Login API v2",
            description: "revised scope",
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toHaveLength(1);
    expect(body.applied[0].kind).toBe("update");
    expect(body.skipped).toHaveLength(0);
    expect(repo.getCard(sibling.id)!.title).toBe("Login API v2");
    expect(body.design.splitVerifiedAt).toBeNull();
  });

  it("update skips in-flight task not in design column", async () => {
    const { app, repo } = appWithRepo();
    const { design, epic, board } = designFixture(repo);
    const inflight = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "In dev",
      description: "old",
      column: "dev",
      epicId: epic.id,
      designId: design.id,
    });
    repo.markDesignSplitVerified(design.id);

    const res = await app.request(`/cards/${design.id}/split-settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ops: [
          {
            kind: "update",
            cardId: inflight.id,
            title: "Revised",
            description: "new scope",
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toHaveLength(0);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0].kind).toBe("update");
    expect(body.skipped[0].reason).toMatch(/design/i);
    expect(repo.getCard(inflight.id)!.title).toBe("In dev");
    expect(repo.getCard(design.id)!.splitVerifiedAt).toBeTruthy();
  });

  it("delete succeeds on design-column task without confirmDelete and dirties parent", async () => {
    const { app, repo } = appWithRepo();
    const { design, epic, board } = designFixture(repo);
    const sibling = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "Login API",
      description: "",
      column: "design",
      epicId: epic.id,
      designId: design.id,
      frozen: true,
    });
    repo.markDesignSplitVerified(design.id);

    const res = await app.request(`/cards/${design.id}/split-settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ops: [{ kind: "delete", cardId: sibling.id }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toHaveLength(1);
    expect(body.applied[0].kind).toBe("delete");
    expect(body.skipped).toHaveLength(0);
    expect(repo.getCard(sibling.id)).toBeNull();
    expect(body.design.splitVerifiedAt).toBeNull();
  });

  it("delete skips in-flight task without confirmDelete", async () => {
    const { app, repo } = appWithRepo();
    const { design, epic, board } = designFixture(repo);
    const inflight = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "In dev",
      description: "",
      column: "dev",
      epicId: epic.id,
      designId: design.id,
    });
    repo.markDesignSplitVerified(design.id);

    const res = await app.request(`/cards/${design.id}/split-settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ops: [{ kind: "delete", cardId: inflight.id }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0].kind).toBe("delete");
    expect(body.skipped[0].reason).toMatch(/confirm/i);
    expect(repo.getCard(inflight.id)).toBeTruthy();
    expect(repo.getCard(design.id)!.splitVerifiedAt).toBeTruthy();
  });

  it("delete with confirmDelete removes in-flight task and dirties design", async () => {
    const { app, repo } = appWithRepo();
    const { design, epic, board } = designFixture(repo);
    const inflight = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "In dev",
      description: "",
      column: "dev",
      epicId: epic.id,
      designId: design.id,
    });
    repo.markDesignSplitVerified(design.id);

    const res = await app.request(`/cards/${design.id}/split-settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ops: [{ kind: "delete", cardId: inflight.id, confirmDelete: true }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toHaveLength(1);
    expect(body.applied[0].kind).toBe("delete");
    expect(repo.getCard(inflight.id)).toBeNull();
    expect(body.design.splitVerifiedAt).toBeNull();
  });

  it("structural create clears splitVerifiedAt", async () => {
    const { app, repo } = appWithRepo();
    const { design } = designFixture(repo);
    repo.markDesignSplitVerified(design.id);

    const res = await app.request(`/cards/${design.id}/split-settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ops: [{ kind: "create", title: "T", description: "d" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.design.splitVerifiedAt).toBeNull();
  });

  it("structural create re-freezes unverified sibling in design column", async () => {
    const { app, repo } = appWithRepo();
    const { design, epic, board } = designFixture(repo);
    const sibling = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "Existing",
      description: "",
      column: "design",
      epicId: epic.id,
      designId: design.id,
      frozen: true,
    });
    repo.markDesignSplitVerified(design.id);
    repo.updateCard(sibling.id, { frozen: false });
    expect(repo.getCard(sibling.id)!.frozen).toBe(false);

    const res = await app.request(`/cards/${design.id}/split-settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ops: [{ kind: "create", title: "New task", description: "scope" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toHaveLength(1);
    expect(body.applied[0].kind).toBe("create");
    expect(body.design.splitVerifiedAt).toBeNull();
    expect(repo.getCard(sibling.id)!.frozen).toBe(true);
  });

  it("note alone does not dirty verify state", async () => {
    const { app, repo } = appWithRepo();
    const { design } = designFixture(repo);
    repo.markDesignSplitVerified(design.id);

    const res = await app.request(`/cards/${design.id}/split-settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ops: [{ kind: "note", text: "merged duplicate tasks" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toHaveLength(1);
    expect(body.applied[0].kind).toBe("note");
    expect(body.design.splitVerifiedAt).toBeTruthy();
  });

  it("returns 404 for unsupported card type", async () => {
    const { app, repo } = appWithRepo();
    const { board } = designFixture(repo);
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      description: "",
      column: "requirements",
    });

    const res = await app.request(`/cards/${epic.id}/split-settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops: [] }),
    });
    expect(res.status).toBe(404);
  });
});
