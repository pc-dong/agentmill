#!/usr/bin/env node
/**
 * Workspace Init Broker
 * ---------------------
 * Narrow-purpose privileged helper for the board API.
 *
 * The board-api process runs least-privileged and cannot write to arbitrary
 * user directories. When a board registers a NEW workspace outside the API's
 * writable scope, the API calls this broker (loopback HTTP) to copy the
 * workspace-example template into that one directory.
 *
 * Capability is deliberately minimal:
 *   - Listens on 127.0.0.1 only (no network exposure).
 *   - Single endpoint: POST /copy { templateRoot, workspacePath }.
 *   - templateRoot MUST be a valid template dir (docs/ + .agents/ present).
 *   - Copies ONLY missing files — never overwrites anything.
 *   - Refuses system roots as workspacePath.
 *
 * Run: node scripts/workspace-init-broker.mjs            (default port 8790)
 *      PORT=8791 node scripts/workspace-init-broker.mjs
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 8790);
const SKIP_NAMES = new Set([".DS_Store", ".git", "node_modules", "dist", "build"]);
// System locations that must never become a workspace (case-insensitive).
// Note /var/folders (macOS temp) is NOT in the list.
const SYSTEM_ROOTS = [
  "/",
  "/system",
  "/library",
  "/usr",
  "/bin",
  "/sbin",
  "/etc",
  "/private/etc",
  "/private/var/db",
  "/var/db",
  "/applications",
  "/users/shared",
  "/dev",
  "/proc",
  "/sys",
  "/windows",
];

export function isWorkspaceTemplateDir(candidate) {
  try {
    return (
      fs.statSync(path.join(candidate, "docs")).isDirectory() &&
      fs.statSync(path.join(candidate, ".agents")).isDirectory()
    );
  } catch {
    return false;
  }
}

export function listTemplateFiles(templateRoot) {
  const root = path.resolve(templateRoot);
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (SKIP_NAMES.has(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) files.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  walk(root);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

export function copyTemplateInto(workspacePath, templateRoot) {
  const wsRoot = path.resolve(workspacePath);
  const tplRoot = path.resolve(templateRoot);

  if (!path.isAbsolute(wsRoot)) {
    return { ok: false, status: 400, error: "workspacePath must be absolute" };
  }
  // Refuse system roots; anything else (user dirs, temp) is fair game.
  const normalized = wsRoot.toLowerCase().replace(/\/+$/, "");
  const insideSystemRoot = SYSTEM_ROOTS.some(
    (r) => normalized === r || (r !== "/" && normalized.startsWith(r + "/")),
  );
  if (insideSystemRoot) {
    return { ok: false, status: 400, error: "refusing to write into a system directory" };
  }
  if (!isWorkspaceTemplateDir(tplRoot)) {
    return { ok: false, status: 400, error: "templateRoot is not a workspace template (needs docs/ and .agents/)" };
  }

  const files = listTemplateFiles(tplRoot);
  let copied = 0;
  let skipped = 0;
  const copiedSample = [];
  for (const rel of files) {
    const target = path.join(wsRoot, rel);
    if (fs.existsSync(target)) {
      skipped++;
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(tplRoot, rel), target);
    copied++;
    if (copiedSample.length < 20) copiedSample.push(rel);
  }
  return { ok: true, templatePath: tplRoot, totalFiles: files.length, copied, skipped, copiedSample };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const send = (status, payload) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
  };

  if (req.method === "GET" && req.url === "/healthz") {
    return send(200, { ok: true, service: "workspace-init-broker" });
  }

  if (req.method === "POST" && req.url === "/copy") {
    try {
      const body = JSON.parse(await readBody(req));
      const result = copyTemplateInto(String(body.workspacePath ?? ""), String(body.templateRoot ?? ""));
      return send(result.ok ? 200 : result.status, result);
    } catch (e) {
      return send(400, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return send(404, { ok: false, error: "not found" });
});

// Only start the server when executed directly (tests import the functions).
const isMain = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (isMain) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`workspace-init-broker listening on http://127.0.0.1:${PORT}`);
    console.log("capability: copy workspace template into a given directory, never overwrite");
  });
}
