import fs from "node:fs";
import path from "node:path";

export type ResolvedUnderWorkspace =
  | { ok: true; root: string; abs: string; rel: string }
  | { ok: false; error: string };

/** Absolute, normalized workspace root (must exist as a directory). */
export function normalizeWorkspaceRoot(workspacePath: string): string {
  const root = path.resolve(workspacePath.trim());
  if (!root) {
    throw new Error("workspacePath is required");
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(root);
  } catch {
    throw new Error(`workspacePath does not exist: ${root}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`workspacePath is not a directory: ${root}`);
  }
  return root;
}

/**
 * Resolve a relative path under workspace root. Rejects absolute paths and
 * anything that escapes the root via `..`.
 */
export function resolveUnderWorkspace(
  workspacePath: string,
  relativePath: string,
): ResolvedUnderWorkspace {
  const root = path.resolve(workspacePath);
  let trimmed = relativePath.trim().replace(/\\/g, "/");
  while (trimmed.startsWith("./")) trimmed = trimmed.slice(2);
  if (!trimmed || trimmed === ".") {
    return { ok: false, error: "path is required" };
  }
  if (path.isAbsolute(trimmed) || trimmed.startsWith("/")) {
    return { ok: false, error: "absolute paths are not allowed" };
  }
  const abs = path.resolve(root, trimmed);
  const relToRoot = path.relative(root, abs);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    return { ok: false, error: "path escapes workspace" };
  }
  if (relToRoot === "") {
    return { ok: false, error: "path must be a file or subdirectory" };
  }
  return {
    ok: true,
    root,
    abs,
    rel: relToRoot.split(path.sep).join("/"),
  };
}

export function assertUnderWorkspace(
  workspacePath: string,
  relativePath: string,
): { root: string; abs: string; rel: string } {
  const resolved = resolveUnderWorkspace(workspacePath, relativePath);
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }
  return resolved;
}

/** True if absPath is the workspace root or a path inside it. */
export function isPathInsideWorkspace(
  workspacePath: string,
  absPath: string,
): boolean {
  const root = path.resolve(workspacePath);
  const abs = path.resolve(absPath);
  const rel = path.relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export const WORKSPACE_BOUNDARY_RULES = [
  "WORKSPACE BOUNDARY (HARD RULES — must obey):",
  "You may ONLY read, write, edit, delete, list, search, and run shell/git against files under the board Workspace root given below.",
  "NEVER leave that root: no absolute paths outside it, no `cd ..` / `../` escapes, no `git -C` targeting other directories.",
  "If another clone/copy of this codebase exists elsewhere on disk (sibling folder, parent monorepo checkout, other worktree), IGNORE it completely — do not open, edit, or run git there.",
  "Prefer relative paths from the Workspace root. ARTIFACT / REPORT / plan: / path= values must stay under the Workspace root.",
].join(" ");
