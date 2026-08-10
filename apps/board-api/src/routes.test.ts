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
  it("blocks design → done until related tasks are done", async () => {
    const { app, repo } = appWithRepo();
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

    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Theme",
      column: "requirements",
      description: "",
    });
    const cardRes = await app.request(
      `http://localhost/boards/${board.id}/cards`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "design",
          title: "Theme · design",
          column: "design",
          description: "",
          epicId: epic.id,
        }),
      },
    );
    expect(cardRes.status).toBe(201);
    const card = await cardRes.json();

    const deniedCol = await app.request(`http://localhost/cards/${card.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: "split",
        actor: "human",
        humanApproved: true,
      }),
    });
    expect(deniedCol.status).toBe(400);

    const noTasks = await app.request(`http://localhost/cards/${card.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: "done",
        actor: "human",
        humanApproved: true,
      }),
    });
    expect(noTasks.status).toBe(400);

    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T1",
      column: "dev",
      description: "",
      epicId: epic.id,
      designId: card.id,
    });
    const stillOpen = await app.request(`http://localhost/cards/${card.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: "done",
        actor: "human",
        humanApproved: true,
      }),
    });
    expect(stillOpen.status).toBe(400);

    repo.updateCard(task.id, { column: "done" });
    const ok = await app.request(`http://localhost/cards/${card.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: "done",
        actor: "human",
        humanApproved: true,
      }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).column).toBe("done");
  });

  it("creates job when comment mentions a bot", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
      description: "",
    });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "D",
      column: "design",
      description: "",
      epicId: epic.id,
    });
    const res = await app.request(`http://localhost/cards/${design.id}/comments`, {
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
          column: "requirements",
          description: "",
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cannot occupy column requirements/);
  });

  it("rejects test-result on wrong column or type", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
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
      column: "requirements",
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

    const resumeRes = await app.request(
      `http://localhost/boards/${board.id}/cards/${req.id}/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeRole: "ba" }),
      },
    );
    expect(resumeRes.status).toBe(200);
    const resumed = (await resumeRes.json()) as { id: string; resumed: boolean };
    expect(resumed.id).toBe(id);
    expect(resumed.resumed).toBe(true);

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

  it("deletes a card and unlinks dependents", async () => {
    const { app, repo, sessions } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
      description: "epic_id: E-1\n",
    });
    const req = repo.createCard({
      boardId: board.id,
      type: "requirement",
      title: "R",
      column: "requirements",
      description: "",
      epicId: epic.id,
    });
    const session = sessions.createSession({
      boardId: board.id,
      cardId: epic.id,
      employeeRole: "design",
    });
    sessions.appendMessage({
      sessionId: session.id,
      role: "user",
      body: "hi",
    });

    const del = await app.request(`http://localhost/cards/${epic.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    expect(repo.getCard(epic.id)).toBeNull();
    expect(repo.getCard(req.id)?.epicId).toBeNull();
    expect(sessions.getSession(session.id)).toBeNull();
  });

  it("reads workspace files and rejects path escape", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-route-ws-"));
    tmpFiles.push(ws);
    fs.mkdirSync(path.join(ws, "docs/epics/E-1"), { recursive: true });
    fs.writeFileSync(path.join(ws, "docs/epics/E-1/EPIC.md"), "# Hello\n");
    fs.writeFileSync(path.join(ws, "docs/epics/E-1/A.java"), "class A {}");

    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "W", workspacePath: ws });

    const ok = await app.request(
      `http://localhost/boards/${board.id}/workspace-file?path=${encodeURIComponent("docs/epics/E-1/EPIC.md")}`,
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.content).toContain("# Hello");
    expect(body.language).toBe("markdown");

    const bad = await app.request(
      `http://localhost/boards/${board.id}/workspace-file?path=${encodeURIComponent("../../etc/passwd")}`,
    );
    expect(bad.status).toBe(400);

    const tree = await app.request(
      `http://localhost/boards/${board.id}/workspace-tree?root=${encodeURIComponent("docs/epics/E-1")}&depth=2`,
    );
    expect(tree.status).toBe(200);
    const treeBody = await tree.json();
    expect(treeBody.files.some((f: { path: string }) => f.path.endsWith("A.java"))).toBe(
      true,
    );

    fs.writeFileSync(
      path.join(ws, "docs/epics/E-1/demo.html"),
      "<html><body><h1>Hi</h1></body></html>",
    );
    const raw = await app.request(
      `http://localhost/boards/${board.id}/workspace-raw/docs/epics/E-1/demo.html`,
    );
    expect(raw.status).toBe(200);
    expect(raw.headers.get("content-type")).toMatch(/text\/html/);
    expect(await raw.text()).toContain("<h1>Hi</h1>");

    const rawEscape = await app.request(
      `http://localhost/boards/${board.id}/workspace-raw/docs/epics/E-1/../../../etc/passwd`,
    );
    expect(rawEscape.status).toBe(400);
  });

  it("blocks human design→dev when not verified", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
      description: "",
    });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "D",
      column: "design",
      description: "",
      epicId: epic.id,
    });
    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      column: "design",
      description: "",
      epicId: epic.id,
      designId: design.id,
      frozen: false,
    });

    const res = await app.request(`http://localhost/cards/${task.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "dev", actor: "human" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/校验|verif/i),
    });
  });

  it("blocks human design→dev with humanApproved when splitVerifiedAt missing", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
      description: "",
    });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "D",
      column: "design",
      description: "",
      epicId: epic.id,
    });
    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      column: "design",
      description: "",
      epicId: epic.id,
      designId: design.id,
      frozen: false,
    });

    const res = await app.request(`http://localhost/cards/${task.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: "dev",
        actor: "human",
        humanApproved: true,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/校验|verif|拆分/i),
    });
  });

  it("blocks human design→dev when frozen even with humanApproved", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
      description: "",
    });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "D",
      column: "design",
      description: "",
      epicId: epic.id,
    });
    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      column: "design",
      description: "",
      epicId: epic.id,
      designId: design.id,
      frozen: true,
    });
    repo.markDesignSplitVerified(design.id);

    const res = await app.request(`http://localhost/cards/${task.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: "dev",
        actor: "human",
        humanApproved: true,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/冻结|frozen/i),
    });
  });

  it("rejects human-decision return_dev for frozen design-column task", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
      description: "",
    });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "D",
      column: "design",
      description: "",
      epicId: epic.id,
    });
    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      column: "design",
      description: "",
      epicId: epic.id,
      designId: design.id,
      frozen: true,
    });

    const res = await app.request(
      `http://localhost/cards/${task.id}/human-decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "return_dev" }),
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/test column/i),
    });
    expect(repo.getCard(task.id)?.column).toBe("design");
    expect(repo.getCard(task.id)?.frozen).toBe(true);
  });

  it("allows human design→dev after verify mark", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
      description: "",
    });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "D",
      column: "design",
      description: "",
      epicId: epic.id,
    });
    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      column: "design",
      description: "",
      epicId: epic.id,
      designId: design.id,
      frozen: true,
    });
    repo.markDesignSplitVerified(design.id);
    repo.updateCard(task.id, { frozen: false });

    const res = await app.request(`http://localhost/cards/${task.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "dev", actor: "human" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).column).toBe("dev");
  });

  it("rejects delete of in-flight task without confirmDelete", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
      description: "",
    });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "D",
      column: "design",
      description: "",
      epicId: epic.id,
    });
    const inflight = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      column: "dev",
      description: "",
      epicId: epic.id,
      designId: design.id,
    });

    const res = await app.request(`http://localhost/cards/${inflight.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(409);
  });

  it("deletes in-flight task with confirmDelete and dirties design", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
      description: "",
    });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "D",
      column: "design",
      description: "",
      epicId: epic.id,
    });
    const inflight = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      column: "dev",
      description: "",
      epicId: epic.id,
      designId: design.id,
    });
    repo.markDesignSplitVerified(design.id);

    const res = await app.request(
      `http://localhost/cards/${inflight.id}?confirmDelete=true`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    expect(repo.getCard(design.id)!.splitVerifiedAt).toBeNull();
  });

  it("deletes design-column task without confirmDelete and dirties design", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
      description: "",
    });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "D",
      column: "design",
      description: "",
      epicId: epic.id,
    });
    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T",
      column: "design",
      description: "",
      epicId: epic.id,
      designId: design.id,
    });
    repo.markDesignSplitVerified(design.id);

    const res = await app.request(`http://localhost/cards/${task.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(repo.getCard(design.id)!.splitVerifiedAt).toBeNull();
  });

  it("creates design deep_dive job for design cards only", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/d" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Theme",
      column: "requirements",
      description: "",
    });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "Round 1",
      column: "design",
      description: "",
      epicId: epic.id,
    });
    const req = repo.createCard({
      boardId: board.id,
      type: "requirement",
      title: "R",
      column: "requirements",
      description: "",
      epicId: epic.id,
    });

    const ok = await app.request(`http://localhost/cards/${design.id}/design-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "deep_dive", summary: "design context" }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.job.id).toBeTruthy();
    const designEmp = repo.listEmployees(board.id).find((e) => e.role === "design")!;
    expect(body.job.employeeId).toBe(designEmp.id);
    expect(body.job.trigger).toBe("deep_dive");

    const split = await app.request(`http://localhost/cards/${design.id}/design-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "split" }),
    });
    expect(split.status).toBe(200);
    const splitBody = await split.json();
    const splitEmp = repo.listEmployees(board.id).find((e) => e.role === "split")!;
    expect(splitBody.job.employeeId).toBe(splitEmp.id);

    const bad = await app.request(`http://localhost/cards/${req.id}/design-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "deep_dive", summary: "nope" }),
    });
    expect(bad.status).toBe(400);
  });

  it("returns 409 when open split session blocks design-jobs split/verify", async () => {
    const { app, repo, sessions } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/d" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Theme",
      column: "requirements",
      description: "",
    });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "Round 1",
      column: "design",
      description: "",
      epicId: epic.id,
    });
    sessions.createSession({
      boardId: board.id,
      cardId: design.id,
      employeeRole: "split",
    });

    const split = await app.request(`http://localhost/cards/${design.id}/design-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "split" }),
    });
    expect(split.status).toBe(409);
    expect(await split.json()).toEqual({
      error: "请先结束拆分对齐会话（settle）后再拆分/校验",
    });

    const verify = await app.request(`http://localhost/cards/${design.id}/design-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "verify" }),
    });
    expect(verify.status).toBe(409);
    expect(await verify.json()).toEqual({
      error: "请先结束拆分对齐会话（settle）后再拆分/校验",
    });

    const deep = await app.request(`http://localhost/cards/${design.id}/design-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "deep_dive", summary: "still ok" }),
    });
    expect(deep.status).toBe(200);
  });

  it("POST split-verified marks design card verified", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/d" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Theme",
      column: "requirements",
      description: "",
    });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "Round 1",
      column: "design",
      description: "",
      epicId: epic.id,
    });
    expect(repo.getCard(design.id)!.splitVerifiedAt).toBeNull();

    const res = await app.request(
      `http://localhost/cards/${design.id}/split-verified`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    expect(repo.getCard(design.id)!.splitVerifiedAt).toBeTruthy();
  });

  it("POST split-dirty clears verified and re-freezes design-column tasks", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/d" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Theme",
      column: "requirements",
      description: "",
    });
    const design = repo.createCard({
      boardId: board.id,
      type: "design",
      title: "Round 1",
      column: "design",
      description: "",
      epicId: epic.id,
    });
    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "T1",
      column: "design",
      description: "",
      epicId: epic.id,
      designId: design.id,
      frozen: false,
    });
    repo.markDesignSplitVerified(design.id);

    const res = await app.request(
      `http://localhost/cards/${design.id}/split-dirty`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    expect(repo.getCard(design.id)!.splitVerifiedAt).toBeNull();
    expect(repo.getCard(task.id)!.frozen).toBe(true);
  });

  it("POST split-verified returns 404 for non-design cards", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/d" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Theme",
      column: "requirements",
      description: "",
    });
    const res = await app.request(
      `http://localhost/cards/${epic.id}/split-verified`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });
});
