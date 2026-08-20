import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Entries never copied from the template (OS noise / VCS / build output). */
const SKIP_NAMES = new Set([".DS_Store", ".git", "node_modules", "dist", "build"]);

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_WALK_UP = 8;
const MAX_SAMPLE = 20;

/** A valid template root must carry both `docs/` and `.agents/`. */
export function isWorkspaceTemplateDir(candidate: string): boolean {
  try {
    return (
      fs.statSync(path.join(candidate, "docs")).isDirectory() &&
      fs.statSync(path.join(candidate, ".agents")).isDirectory()
    );
  } catch {
    return false;
  }
}

/** Find `<name>` template dir by walking up from `start` (bounded). */
export function findTemplateDirUpFrom(
  start: string,
  name = "workspace-example",
): string | null {
  let cur = path.resolve(start);
  for (let i = 0; i < MAX_WALK_UP; i++) {
    const candidate = path.join(cur, name);
    if (isWorkspaceTemplateDir(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

/**
 * Locate the workspace-example template directory.
 * Order: explicit env override, then walk up from cwd and from this module
 * (covers `pnpm dev` from repo root, package cwd, and `node dist/index.js`).
 */
export function locateWorkspaceTemplate(): string | null {
  const explicit =
    process.env.AM_WORKSPACE_TEMPLATE ?? process.env.AIW_WORKSPACE_TEMPLATE;
  if (explicit) {
    const p = path.resolve(explicit);
    if (isWorkspaceTemplateDir(p)) return p;
    return null;
  }
  return (
    findTemplateDirUpFrom(process.cwd()) ?? findTemplateDirUpFrom(MODULE_DIR)
  );
}

/** All template files as workspace-relative POSIX paths (sorted, deterministic). */
export function listTemplateFiles(templateRoot: string): string[] {
  const root = path.resolve(templateRoot);
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (SKIP_NAMES.has(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
      } else if (ent.isFile()) {
        files.push(path.relative(root, abs).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

export type WorkspaceInitPreview =
  | {
      ok: true;
      templatePath: string;
      totalFiles: number;
      /** Files missing in the workspace — what apply would copy. */
      newFiles: number;
      /** Files already present in the workspace — never replaced. */
      existingFiles: number;
      existingSample: string[];
      /**
       * Whether apply can complete with this process's current permissions.
       * true when nothing needs writing; otherwise requires a successful
       * write probe at the workspace root.
       */
      writable: boolean;
    }
  | { ok: false; error: string; status: 400 };

/** OS-level error codes meaning "this path is not writable by us". */
const WRITE_DENIED_CODES = new Set(["EPERM", "EACCES", "EROFS"]);

/**
 * Probe whether this process may create files under rootDir.
 * Creates and removes a uniquely named probe directory — no residue.
 */
export function probeWorkspaceWritable(rootDir: string): boolean {
  const probe = path.join(
    rootDir,
    `.wsinit-probe-${process.pid}-${Date.now()}`,
  );
  try {
    fs.mkdirSync(probe, { recursive: true });
    fs.writeFileSync(path.join(probe, "probe"), "ok");
    return true;
  } catch {
    return false;
  } finally {
    try {
      fs.rmSync(probe, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/** Dry-run: count template files missing vs already present in the workspace. */
export function previewWorkspaceInit(
  workspacePath: string,
  templateRoot: string,
): WorkspaceInitPreview {
  const wsRoot = path.resolve(workspacePath);
  if (!wsRoot) {
    return { ok: false, error: "workspace path is required", status: 400 };
  }
  const files = listTemplateFiles(templateRoot);
  let existingFiles = 0;
  const existingSample: string[] = [];
  for (const rel of files) {
    if (fs.existsSync(path.join(wsRoot, rel))) {
      existingFiles++;
      if (existingSample.length < MAX_SAMPLE) existingSample.push(rel);
    }
  }
  const newFiles = files.length - existingFiles;
  return {
    ok: true,
    templatePath: path.resolve(templateRoot),
    totalFiles: files.length,
    newFiles,
    existingFiles,
    existingSample,
    // Nothing to write → writable by definition (idempotent re-sync).
    writable: newFiles === 0 ? true : probeWorkspaceWritable(wsRoot),
  };
}

export type WorkspaceInitResult =
  | {
      ok: true;
      templatePath: string;
      totalFiles: number;
      /** Files actually copied (were missing). */
      copied: number;
      /** Files skipped because they already existed (never replaced). */
      skipped: number;
      copiedSample: string[];
    }
  | {
      ok: false;
      error: string;
      status: 400 | 403 | 500;
      /** true → the OS denies writes to this workspace; a per-directory grant is needed. */
      needsAuthorization?: boolean;
    };

/**
 * Copy template files into the workspace. Files that already exist are
 * skipped untouched — this operation never overwrites user content.
 *
 * When nothing is missing, no filesystem write happens at all, so already
 * initialized workspaces stay servable under a least-privilege (read-only
 * outside sandbox) process. When writes are needed but the OS denies them
 * (EPERM/EACCES/EROFS), returns 403 + needsAuthorization instead of a
 * partial-copy 500.
 */
export function applyWorkspaceInit(
  workspacePath: string,
  templateRoot: string,
): WorkspaceInitResult {
  const wsRoot = path.resolve(workspacePath);
  if (!wsRoot) {
    return { ok: false, error: "workspace path is required", status: 400 };
  }
  const files = listTemplateFiles(templateRoot);
  const missing = files.filter((rel) => !fs.existsSync(path.join(wsRoot, rel)));
  if (missing.length === 0) {
    return {
      ok: true,
      templatePath: path.resolve(templateRoot),
      totalFiles: files.length,
      copied: 0,
      skipped: files.length,
      copiedSample: [],
    };
  }
  if (!probeWorkspaceWritable(wsRoot)) {
    return {
      ok: false,
      error: `该 workspace 目录当前不可写（最小权限沙箱）：还有 ${missing.length} 个模版文件待复制，需要对该目录一次性授权写入`,
      status: 403,
      needsAuthorization: true,
    };
  }
  let copied = 0;
  let skipped = files.length - missing.length;
  const copiedSample: string[] = [];
  try {
    for (const rel of missing) {
      const target = path.join(wsRoot, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(templateRoot, rel), target);
      copied++;
      if (copiedSample.length < MAX_SAMPLE) copiedSample.push(rel);
    }
  } catch (e) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code?: unknown }).code)
        : "";
    const message = e instanceof Error ? e.message : String(e);
    const denied = WRITE_DENIED_CODES.has(code);
    return {
      ok: false,
      error: `写入 workspace 失败（已复制 ${copied} 个文件后中止）：${code ? `${code} ` : ""}${message}`,
      status: denied ? 403 : 500,
      ...(denied ? { needsAuthorization: true } : {}),
    };
  }
  return {
    ok: true,
    templatePath: path.resolve(templateRoot),
    totalFiles: files.length,
    copied,
    skipped,
    copiedSample,
  };
}
