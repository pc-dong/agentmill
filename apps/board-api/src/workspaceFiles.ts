import fs from "node:fs";
import path from "node:path";

export const PREVIEW_EXTENSIONS = new Set([
  ".md",
  ".java",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".json",
  ".vue",
  ".kt",
  ".kts",
  ".xml",
  ".yml",
  ".yaml",
  ".toml",
  ".properties",
  ".gradle",
  ".txt",
]);

export const MAX_FILE_BYTES = 1_000_000;
/** Slightly larger for static HTML assets when opened in browser. */
export const MAX_RAW_FILE_BYTES = 5_000_000;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

/** Extensions allowed for browser raw serving (HTML + common relative assets). */
export const RAW_EXTENSIONS = new Set([
  ...PREVIEW_EXTENSIONS,
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".map",
]);

const EXT_LANGUAGE: Record<string, string> = {
  ".md": "markdown",
  ".java": "java",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".html": "html",
  ".htm": "html",
  ".json": "json",
  ".vue": "vue",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".xml": "xml",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".properties": "properties",
  ".gradle": "groovy",
  ".txt": "text",
};

export type ResolvedWorkspacePath =
  | { ok: true; abs: string; rel: string; ext: string }
  | { ok: false; error: string; status: 400 };

/**
 * Resolve a relative path under workspacePath. Rejects absolute paths,
 * empty paths, and anything that escapes the workspace root.
 */
export function resolveUnderWorkspace(
  workspacePath: string,
  relativePath: string,
): ResolvedWorkspacePath {
  const trimmed = relativePath.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === ".") {
    return { ok: false, error: "path is required", status: 400 };
  }
  if (path.isAbsolute(trimmed) || trimmed.startsWith("/")) {
    return { ok: false, error: "absolute paths are not allowed", status: 400 };
  }

  const root = path.resolve(workspacePath);
  const abs = path.resolve(root, trimmed);
  const relToRoot = path.relative(root, abs);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    return { ok: false, error: "path escapes workspace", status: 400 };
  }
  if (relToRoot === "") {
    return { ok: false, error: "path must be a file or subdirectory", status: 400 };
  }

  const ext = path.extname(abs).toLowerCase();
  const rel = relToRoot.split(path.sep).join("/");
  return { ok: true, abs, rel, ext };
}

export function languageForExt(ext: string): string {
  return EXT_LANGUAGE[ext.toLowerCase()] ?? "text";
}

export function isAllowedPreviewExt(ext: string): boolean {
  return PREVIEW_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * root must be under workspace and look like an epic docs dir or an ancestor
 * of a known artifact (caller validates allowlist of roots).
 */
export function isAllowedTreeRoot(relRoot: string): boolean {
  const n = relRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!n || n.includes("..")) return false;
  if (n === "docs/epics" || n.startsWith("docs/epics/")) return true;
  // Also allow any path that is clearly under docs/ (design docs)
  if (n === "docs" || n.startsWith("docs/")) return true;
  return false;
}

export function readWorkspaceFile(
  workspacePath: string,
  relativePath: string,
):
  | { ok: true; path: string; content: string; language: string }
  | { ok: false; error: string; status: 400 | 404 | 413 } {
  const resolved = resolveUnderWorkspace(workspacePath, relativePath);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, status: resolved.status };
  }
  if (!isAllowedPreviewExt(resolved.ext)) {
    return {
      ok: false,
      error: `extension ${resolved.ext || "(none)"} is not previewable`,
      status: 400,
    };
  }
  if (!fs.existsSync(resolved.abs)) {
    return { ok: false, error: "file not found", status: 404 };
  }
  const st = fs.statSync(resolved.abs);
  if (!st.isFile()) {
    return { ok: false, error: "not a file", status: 400 };
  }
  if (st.size > MAX_FILE_BYTES) {
    return { ok: false, error: "file too large", status: 413 };
  }
  const content = fs.readFileSync(resolved.abs, "utf8");
  return {
    ok: true,
    path: resolved.rel,
    content,
    language: languageForExt(resolved.ext),
  };
}

export function isAllowedRawExt(ext: string): boolean {
  return RAW_EXTENSIONS.has(ext.toLowerCase());
}

export function contentTypeForExt(ext: string): string {
  return CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";
}

export function readWorkspaceRaw(
  workspacePath: string,
  relativePath: string,
):
  | { ok: true; path: string; body: Buffer; contentType: string }
  | { ok: false; error: string; status: 400 | 404 | 413 } {
  const resolved = resolveUnderWorkspace(workspacePath, relativePath);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, status: resolved.status };
  }
  if (!isAllowedRawExt(resolved.ext)) {
    return {
      ok: false,
      error: `extension ${resolved.ext || "(none)"} cannot be served`,
      status: 400,
    };
  }
  if (!fs.existsSync(resolved.abs)) {
    return { ok: false, error: "file not found", status: 404 };
  }
  const st = fs.statSync(resolved.abs);
  if (!st.isFile()) {
    return { ok: false, error: "not a file", status: 400 };
  }
  if (st.size > MAX_RAW_FILE_BYTES) {
    return { ok: false, error: "file too large", status: 413 };
  }
  return {
    ok: true,
    path: resolved.rel,
    body: fs.readFileSync(resolved.abs),
    contentType: contentTypeForExt(resolved.ext),
  };
}

export type TreeEntry = { path: string; name: string };

export function listWorkspaceTree(
  workspacePath: string,
  relativeRoot: string,
  depth = 2,
):
  | { ok: true; root: string; files: TreeEntry[] }
  | { ok: false; error: string; status: 400 | 404 } {
  const maxDepth = Math.min(Math.max(depth, 0), 4);
  const trimmed = relativeRoot.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!isAllowedTreeRoot(trimmed)) {
    return {
      ok: false,
      error: "root must be under docs/ (typically docs/epics/...)",
      status: 400,
    };
  }

  const resolved = resolveUnderWorkspace(workspacePath, trimmed);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, status: resolved.status };
  }
  // resolveUnderWorkspace treats directory root oddly when rel is empty for workspace root;
  // for a subdir, abs should exist as directory.
  if (!fs.existsSync(resolved.abs)) {
    return { ok: false, error: "root not found", status: 404 };
  }
  if (!fs.statSync(resolved.abs).isDirectory()) {
    return { ok: false, error: "root is not a directory", status: 400 };
  }

  const rootAbs = path.resolve(workspacePath);
  const files: TreeEntry[] = [];

  function walk(dirAbs: string, depthLeft: number) {
    if (depthLeft < 0) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const childAbs = path.join(dirAbs, ent.name);
      const rel = path.relative(rootAbs, childAbs).split(path.sep).join("/");
      if (ent.isDirectory()) {
        walk(childAbs, depthLeft - 1);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (isAllowedPreviewExt(ext)) {
          files.push({ path: rel, name: ent.name });
        }
      }
    }
  }

  walk(resolved.abs, maxDepth);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { ok: true, root: trimmed, files };
}

/** Infer epic docs directory from an artifact path like docs/epics/E-x-slug/EPIC.md */
export function inferEpicDocsRoot(filePath: string): string | null {
  const n = filePath.replace(/\\/g, "/");
  const m = n.match(/^(docs\/epics\/[^/]+)/);
  return m?.[1] ?? null;
}
