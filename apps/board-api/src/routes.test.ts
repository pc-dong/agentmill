import fs from "node:fs";
import http from "node:http";
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
  it("GET /boards lists every board with workspace paths", async () => {
    const { app } = appWithRepo();
    const res = await app.request("http://localhost/boards");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);

    await app.request("http://localhost/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "A", workspacePath: "/tmp/ws-a" }),
    });
    await app.request("http://localhost/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "B", workspacePath: "/tmp/ws-b" }),
    });

    const res2 = await app.request("http://localhost/boards");
    const list2 = (await res2.json()) as Array<{
      name: string;
      workspacePath: string;
    }>;
    expect(list2.map((b) => b.name)).toEqual(["A", "B"]);
    expect(list2.map((b) => b.workspacePath)).toEqual([
      "/tmp/ws-a",
      "/tmp/ws-b",
    ]);
  });

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
    const job = repo.getJob((jobs[0] as { id: string }).id)!;
    const payload = JSON.parse(job.payload ?? "{}") as {
      mentionBody: string;
      includeCommentHistory: boolean;
      triggerCommentId: string;
    };
    expect(payload.mentionBody).toBe("@Design Bot please draft outline");
    expect(payload.includeCommentHistory).toBe(false);
    expect(payload.triggerCommentId).toBeTruthy();
  });

  it("stores includeCommentHistory on mention job payload", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      column: "requirements",
      description: "",
    });
    const res = await app.request(`http://localhost/cards/${epic.id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        author: "human",
        body: "@Dev Bot 当前分支？",
        includeCommentHistory: true,
      }),
    });
    expect(res.status).toBe(201);
    const open = repo.listOpenJobs(board.id)[0] as { id: string };
    const job = repo.getJob(open.id)!;
    const payload = JSON.parse(job.payload ?? "{}") as {
      includeCommentHistory: boolean;
      mentionBody: string;
    };
    expect(payload.includeCommentHistory).toBe(true);
    expect(payload.mentionBody).toContain("当前分支");
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

    const progressRes = await app.request(
      `http://localhost/jobs/${jobId}/progress`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "执行中：流式摘要…" }),
      },
    );
    expect(progressRes.status).toBe(200);
    const cardsRes = await app.request(
      `http://localhost/boards/${board.id}/cards`,
    );
    expect(cardsRes.status).toBe(200);
    const cards = (await cardsRes.json()) as Array<{
      id: string;
      activeJob?: { progress: string | null; trigger: string; displayName: string };
    }>;
    const locked = cards.find((c) => c.id === epic.id)!;
    expect(locked.activeJob?.progress).toBe("执行中：流式摘要…");
    expect(locked.activeJob?.trigger).toBe("mention");
    expect(locked.activeJob?.displayName).toBe("Design Bot");

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

    // URL parsing collapses `..` before the request reaches the handler, so the
    // handler sees `etc/passwd` and misses. Escapes are rejected one layer down,
    // in resolveUnderWorkspace (see workspaceFiles.test.ts).
    const rawEscape = await app.request(
      `http://localhost/boards/${board.id}/workspace-raw/docs/epics/E-1/../../../etc/passwd`,
    );
    expect(rawEscape.status).not.toBe(200);
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

  it("allows human design→dev for ad-hoc task without designId", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "D", workspacePath: "/tmp/w" });
    const task = repo.createCard({
      boardId: board.id,
      type: "task",
      title: "Ad-hoc",
      column: "design",
      description: "manual todo",
      frozen: false,
    });

    const res = await app.request(`http://localhost/cards/${task.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "dev", actor: "human" }),
    });
    expect(res.status).toBe(200);
    expect(repo.getCard(task.id)?.column).toBe("dev");
    expect(repo.getCard(task.id)?.designId).toBeNull();
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

  it("workspace-init previews and copies template without replacing files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-wsinit-"));
    tmpFiles.push(root);
    const tpl = path.join(root, "workspace-example");
    fs.mkdirSync(path.join(tpl, "docs"), { recursive: true });
    fs.mkdirSync(path.join(tpl, ".agents/skills/demo"), { recursive: true });
    fs.writeFileSync(path.join(tpl, "docs/README.md"), "# tpl");
    fs.writeFileSync(path.join(tpl, ".agents/skills/demo/SKILL.md"), "skill");
    fs.writeFileSync(path.join(tpl, ".DS_Store"), "junk");
    process.env.AM_WORKSPACE_TEMPLATE = tpl;

    const ws = path.join(root, "ws");
    fs.mkdirSync(path.join(ws, "docs"), { recursive: true });
    fs.writeFileSync(path.join(ws, "docs/README.md"), "# user keeps this");

    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "W", workspacePath: ws });

    const preview = await app.request(
      `http://localhost/boards/${board.id}/workspace-init`,
    );
    expect(preview.status).toBe(200);
    const pbody = await preview.json();
    expect(pbody.totalFiles).toBe(2);
    expect(pbody.existingFiles).toBe(1);
    expect(pbody.newFiles).toBe(1);

    const apply = await app.request(
      `http://localhost/boards/${board.id}/workspace-init`,
      { method: "POST" },
    );
    expect(apply.status).toBe(200);
    const abody = await apply.json();
    expect(abody.copied).toBe(1);
    expect(abody.skipped).toBe(1);

    // User file untouched, new file present, noise not copied.
    expect(fs.readFileSync(path.join(ws, "docs/README.md"), "utf8")).toBe(
      "# user keeps this",
    );
    expect(
      fs.readFileSync(path.join(ws, ".agents/skills/demo/SKILL.md"), "utf8"),
    ).toBe("skill");
    expect(fs.existsSync(path.join(ws, ".DS_Store"))).toBe(false);

    delete process.env.AM_WORKSPACE_TEMPLATE;
  });

  it("workspace-init returns 403 needsAuthorization for non-writable workspace", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-ws-ro-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-wsinit-ro-"));
    tmpFiles.push(ws, root);
    const tpl = path.join(root, "workspace-example");
    fs.mkdirSync(path.join(tpl, "docs"), { recursive: true });
    fs.mkdirSync(path.join(tpl, ".agents"), { recursive: true });
    fs.writeFileSync(path.join(tpl, "docs/README.md"), "# tpl");
    fs.writeFileSync(path.join(tpl, ".agents/SKILL.md"), "skill");
    process.env.AM_WORKSPACE_TEMPLATE = tpl;
    fs.chmodSync(ws, 0o555);

    try {
      const { app, repo } = appWithRepo();
      const board = repo.createBoard({ name: "RO", workspacePath: ws });
      const res = await app.request(
        `http://localhost/boards/${board.id}/workspace-init`,
        { method: "POST" },
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as {
        error: string;
        needsAuthorization: boolean;
      };
      expect(body.needsAuthorization).toBe(true);
      expect(body.error).toContain("不可写");
      expect(fs.readdirSync(ws)).toEqual([]);
    } finally {
      fs.chmodSync(ws, 0o755);
      delete process.env.AM_WORKSPACE_TEMPLATE;
    }
  });

  it("workspace-init routes through broker for non-writable workspaces", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-ws-broker-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-wsinit-bk-"));
    tmpFiles.push(ws, root);
    const tpl = path.join(root, "workspace-example");
    fs.mkdirSync(path.join(tpl, "docs"), { recursive: true });
    fs.mkdirSync(path.join(tpl, ".agents"), { recursive: true });
    fs.writeFileSync(path.join(tpl, "docs/README.md"), "# tpl");
    fs.writeFileSync(path.join(tpl, ".agents/SKILL.md"), "skill");
    process.env.AM_WORKSPACE_TEMPLATE = tpl;
    fs.chmodSync(ws, 0o555);

    // Stub broker that reports a successful copy.
    const broker = http.createServer((req, res) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            templatePath: tpl,
            totalFiles: 2,
            copied: 2,
            skipped: 0,
            copiedSample: ["docs/README.md", ".agents/SKILL.md"],
          }),
        );
      });
    });
    await new Promise<void>((resolve) => broker.listen(0, "127.0.0.1", resolve));
    const addr = broker.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    process.env.AM_WORKSPACE_INIT_BROKER = `http://127.0.0.1:${port}`;

    try {
      const { app, repo } = appWithRepo();
      const board = repo.createBoard({ name: "BK", workspacePath: ws });
      const res = await app.request(
        `http://localhost/boards/${board.id}/workspace-init`,
        { method: "POST" },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { copied: number; via: string };
      expect(body.copied).toBe(2);
      expect(body.via).toBe("broker");
    } finally {
      broker.close();
      fs.chmodSync(ws, 0o755);
      delete process.env.AM_WORKSPACE_TEMPLATE;
      delete process.env.AM_WORKSPACE_INIT_BROKER;
    }
  });

  it("workspace-init returns 503 when template cannot be located", async () => {
    const prev = process.env.AM_WORKSPACE_TEMPLATE;
    process.env.AM_WORKSPACE_TEMPLATE = "/definitely/not/here";
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "W", workspacePath: "/tmp/w" });
    const res = await app.request(
      `http://localhost/boards/${board.id}/workspace-init`,
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(String(body.error)).toContain("workspace-example");
    if (prev === undefined) delete process.env.AM_WORKSPACE_TEMPLATE;
    else process.env.AM_WORKSPACE_TEMPLATE = prev;
  });
});
