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
  const file = path.join(os.tmpdir(), `aiw-ba-settle-${Date.now()}.sqlite`);
  tmpFiles.push(file);
  const db = openDb(file);
  migrate(db);
  const repo = new BoardRepo(db);
  const sessions = new SessionRepo(db);
  return { app: createApp(repo, sessions), repo, sessions };
}

describe("ba-settle", () => {
  it("ba-settle create creates epic card and links requirement", async () => {
    const { app, repo } = appWithRepo();
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
          {
            kind: "file",
            href: "docs/epics/E-DEMO-001-login/EPIC.md",
            label: "Epic",
          },
          {
            kind: "file",
            href: "docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md",
            label: "PRD",
          },
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
        artifacts: [
          {
            kind: "file",
            href: "docs/epics/E-DEMO-001-login/EPIC.md",
            label: "Epic",
          },
        ],
      }),
    });
    const body2 = await res2.json();
    expect(body2.epic.id).toBe(body.epic.id);
  });

  it("ba-settle create with existing epicId forces link and warning", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "b", workspacePath: "/tmp/ws" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Login",
      description: "epic_id: E-DEMO-001\n",
      column: "requirements",
    });
    const req = repo.createCard({
      boardId: board.id,
      type: "requirement",
      title: "Need SSO",
      description: "",
      column: "requirements",
      epicId: epic.id,
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
          {
            kind: "file",
            href: "docs/epics/E-DEMO-001-login/prds/P-001-02-sso.md",
            label: "PRD",
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warning).toBeTruthy();
    expect(body.epic.id).toBe(epic.id);
    expect(body.requirement.epicId).toBe(epic.id);
    expect(
      body.epic.artifacts.some(
        (a: { href: string }) =>
          a.href === "docs/epics/E-DEMO-001-login/prds/P-001-02-sso.md",
      ),
    ).toBe(true);
  });

  it("ba-settle link returns 400 when epicKey mismatches linked epic", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "b", workspacePath: "/tmp/ws" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Login",
      description: "epic_id: E-DEMO-001\n",
      column: "requirements",
    });
    const req = repo.createCard({
      boardId: board.id,
      type: "requirement",
      title: "Need SSO",
      description: "",
      column: "requirements",
      epicId: epic.id,
    });
    const res = await app.request(`/cards/${req.id}/ba-settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "link",
        epicKey: "E-OTHER-999",
        epicTitle: "Other",
        epicSlug: "other",
        artifacts: [
          {
            kind: "file",
            href: "docs/epics/E-OTHER-999-other/prds/P-999-01-x.md",
            label: "PRD",
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/epicKey mismatch/);
    expect(body.error).toContain("E-OTHER-999");
    expect(body.error).toContain("E-DEMO-001");
  });

  it("ba-settle create→force-link returns 400 when epicKey mismatches", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "b", workspacePath: "/tmp/ws" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "Login",
      description: "epic_id: E-DEMO-001\n",
      column: "requirements",
    });
    const req = repo.createCard({
      boardId: board.id,
      type: "requirement",
      title: "Need SSO",
      description: "",
      column: "requirements",
      epicId: epic.id,
    });
    const res = await app.request(`/cards/${req.id}/ba-settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "create",
        epicKey: "E-WRONG-002",
        epicTitle: "Wrong",
        epicSlug: "wrong",
        artifacts: [],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/epicKey mismatch/);
  });

  it("ba-jobs creates settle job with payload", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "b", workspacePath: "/tmp/ws" });
    const req = repo.createCard({
      boardId: board.id,
      type: "requirement",
      title: "Need login",
      description: "",
      column: "requirements",
    });
    const summary = "EPIC_MODE create\nEPIC_ID E-DEMO-001";
    const res = await app.request(`/cards/${req.id}/ba-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "settle", summary }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job.trigger).toBe("settle");
    expect(body.job.payload).toBe(summary);
    expect(body.job.status).toBe("open");
    const ba = repo.listEmployees(board.id).find((e) => e.role === "ba");
    expect(body.job.employeeId).toBe(ba!.id);
  });

  it("ba-settle returns 404 for non-requirement", async () => {
    const { app, repo } = appWithRepo();
    const board = repo.createBoard({ name: "b", workspacePath: "/tmp/ws" });
    const epic = repo.createCard({
      boardId: board.id,
      type: "epic",
      title: "E",
      description: "",
      column: "requirements",
    });
    const res = await app.request(`/cards/${epic.id}/ba-settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "create",
        epicKey: "E-DEMO-001",
        epicTitle: "Login",
        epicSlug: "login",
        artifacts: [],
      }),
    });
    expect(res.status).toBe(404);
  });
});
