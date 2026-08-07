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
  const file = path.join(os.tmpdir(), `aiw-api-${Date.now()}.sqlite`);
  tmpFiles.push(file);
  const db = openDb(file);
  migrate(db);
  const repo = new BoardRepo(db);
  const sessions = new SessionRepo(db);
  return { app: createApp(repo, sessions), repo, sessions };
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

  it("rejects create card with wrong column occupancy", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const res = await app.request(
      `http://localhost/boards/${board.id}/cards`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "task",
          title: "Bad placement",
          column: "design",
          description: "",
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cannot occupy column design/);
  });

  it("rejects test-result on wrong column or type", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "design",
      description: "",
    });
    const wrongType = await app.request(
      `http://localhost/cards/${epic.id}/test-result`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passed: false }),
      },
    );
    expect(wrongType.status).toBe(400);
    expect((await wrongType.json()).error).toMatch(/test-result only valid/);

    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      column: "dev",
      description: "",
    });
    const wrongColumn = await app.request(
      `http://localhost/cards/${task.id}/test-result`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passed: false }),
      },
    );
    expect(wrongColumn.status).toBe(400);
    expect((await wrongColumn.json()).error).toMatch(/test-result only valid/);
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

  it("claims and completes a job via HTTP", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "design",
      description: "",
    });
    await app.request(`http://localhost/cards/${epic.id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        author: "human",
        body: "@Design Bot please draft outline",
      }),
    });
    const jobs = repo.listOpenJobs(board.id);
    expect(jobs.length).toBe(1);
    const jobId = (jobs[0] as { id: string }).id;

    const claimRes = await app.request(
      `http://localhost/jobs/${jobId}/claim`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workerId: "worker-1" }),
      },
    );
    expect(claimRes.status).toBe(200);
    const claimed = await claimRes.json();
    expect(claimed.status).toBe("claimed");
    expect(repo.getCard(epic.id)?.lockedJobId).toBe(jobId);

    const completeRes = await app.request(
      `http://localhost/jobs/${jobId}/complete`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          summary: "done",
          artifacts: [{ kind: "file", href: "docs/a.md", label: "A" }],
        }),
      },
    );
    expect(completeRes.status).toBe(200);
    const card = repo.getCard(epic.id)!;
    expect(card.lockedJobId).toBeNull();
    expect(card.artifacts[0]?.href).toBe("docs/a.md");
  });

  it("creates session with employeeRole from body and GETs it", async () => {
    const { app, repo, sessions } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const req = repo.createCard({
      boardId: board.id,
      type: "requirement",
      title: "R",
      column: "requirements",
      description: "",
    });

    const createRes = await app.request(
      `http://localhost/boards/${board.id}/cards/${req.id}/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeRole: "ba" }),
      },
    );
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };
    expect(sessions.getSession(id)?.employeeRole).toBe("ba");

    const getRes = await app.request(`http://localhost/sessions/${id}`);
    expect(getRes.status).toBe(200);
    const session = await getRes.json();
    expect(session).toMatchObject({
      id,
      cardId: req.id,
      employeeRole: "ba",
      status: "open",
    });
  });
});
