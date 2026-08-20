import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tryBrokerInit } from "./workspaceInitBroker.js";

/** Locate scripts/workspace-init-broker.mjs by walking up from cwd. */
function findBrokerScript(): string {
  let cur = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(cur, "scripts/workspace-init-broker.mjs");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error("cannot locate scripts/workspace-init-broker.mjs");
}

const SCRIPT = findBrokerScript();

const tmpDirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
  for (const c of children) c.kill("SIGTERM");
  children.length = 0;
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
  delete process.env.AM_WORKSPACE_INIT_BROKER;
});

function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "wsbroker-"));
  tmpDirs.push(d);
  return d;
}

function makeTemplate(root: string): string {
  const tpl = path.join(root, "workspace-example");
  fs.mkdirSync(path.join(tpl, "docs/template"), { recursive: true });
  fs.mkdirSync(path.join(tpl, ".agents/skills"), { recursive: true });
  fs.writeFileSync(path.join(tpl, "docs/README.md"), "# tpl");
  fs.writeFileSync(path.join(tpl, "docs/template/EPIC模版.md"), "# epic");
  fs.writeFileSync(path.join(tpl, ".agents/skills/SKILL.md"), "---\n");
  fs.writeFileSync(path.join(tpl, ".DS_Store"), "junk");
  return tpl;
}

async function startBroker(): Promise<{ port: number; base: string }> {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const child = spawn("node", [SCRIPT], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const base = `http://127.0.0.1:${port}`;
  const spawnErrors: string[] = [];
  const stderr: string[] = [];
  child.on("error", (e) => spawnErrors.push(String(e)));
  child.stderr.on("data", (d) => stderr.push(d.toString()));
  // Wait for healthz.
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return { port, base };
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `broker did not start; spawnErrors=${spawnErrors.join(";")} stderr=${stderr.join("").slice(0, 400)}`,
  );
}

function postCopy(base: string, body: unknown) {
  return fetch(`${base}/copy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

describe("workspace-init broker", () => {
  it("copies missing files, never overwrites, skips noise", async () => {
    const { base } = await startBroker();
    const root = makeTmpDir();
    const tpl = makeTemplate(root);
    const ws = path.join(root, "ws");
    fs.mkdirSync(path.join(ws, "docs"), { recursive: true });
    fs.writeFileSync(path.join(ws, "docs/README.md"), "# user keeps this");

    const r = await postCopy(base, { templateRoot: tpl, workspacePath: ws });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.copied).toBe(2);
    expect(r.body.skipped).toBe(1);
    expect(fs.readFileSync(path.join(ws, "docs/README.md"), "utf8")).toBe(
      "# user keeps this",
    );
    expect(
      fs.readFileSync(path.join(ws, ".agents/skills/SKILL.md"), "utf8"),
    ).toBe("---\n");
    expect(fs.existsSync(path.join(ws, ".DS_Store"))).toBe(false);
  });

  it("refuses system roots and invalid templates", async () => {
    const { base } = await startBroker();
    const root = makeTmpDir();
    const tpl = makeTemplate(root);
    expect((await postCopy(base, { templateRoot: tpl, workspacePath: "/etc" })).status).toBe(400);
    expect(
      (await postCopy(base, { templateRoot: path.join(root, "nope"), workspacePath: root })).status,
    ).toBe(400);
  });

  it("tryBrokerInit succeeds via a healthy broker", async () => {
    const { base } = await startBroker();
    process.env.AM_WORKSPACE_INIT_BROKER = base;
    const root = makeTmpDir();
    const tpl = makeTemplate(root);
    const ws = path.join(root, "ws2");
    const out = await tryBrokerInit(ws, tpl);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.via).toBe("broker");
      expect(out.copied).toBe(3);
      expect(out.skipped).toBe(0);
    }
  });

  it("tryBrokerInit returns 403 needsAuthorization when broker is down", async () => {
    process.env.AM_WORKSPACE_INIT_BROKER = "http://127.0.0.1:1";
    const out = await tryBrokerInit("/tmp/whatever", "/tmp/tpl");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(403);
      expect(out.needsAuthorization).toBe(true);
      expect(out.error).toContain("代理");
    }
  });

  it("tryBrokerInit returns 403 needsAuthorization when broker refuses", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "refused by policy" }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    process.env.AM_WORKSPACE_INIT_BROKER = `http://127.0.0.1:${port}`;
    const out = await tryBrokerInit("/tmp/whatever", "/tmp/tpl");
    server.close();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.needsAuthorization).toBe(true);
  });
});
