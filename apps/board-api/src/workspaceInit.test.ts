import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyWorkspaceInit,
  findTemplateDirUpFrom,
  isWorkspaceTemplateDir,
  listTemplateFiles,
  locateWorkspaceTemplate,
  previewWorkspaceInit,
} from "./workspaceInit.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
  delete process.env.AM_WORKSPACE_TEMPLATE;
});

function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "wsinit-"));
  tmpDirs.push(d);
  return d;
}

/** Build a mini workspace-example template under a temp root. */
function makeTemplate(root: string): string {
  const tpl = path.join(root, "workspace-example");
  fs.mkdirSync(path.join(tpl, "docs/template"), { recursive: true });
  fs.mkdirSync(path.join(tpl, ".agents/skills/demo"), { recursive: true });
  fs.writeFileSync(path.join(tpl, "docs/README.md"), "# readme");
  fs.writeFileSync(path.join(tpl, "docs/template/EPIC模版.md"), "# epic");
  fs.writeFileSync(path.join(tpl, ".agents/skills/demo/SKILL.md"), "---\n---\n");
  fs.writeFileSync(path.join(tpl, "skills-lock.json"), "{}");
  // Noise that must never be copied.
  fs.writeFileSync(path.join(tpl, ".DS_Store"), "junk");
  return tpl;
}

describe("workspaceInit", () => {
  it("isWorkspaceTemplateDir requires docs/ and .agents/", () => {
    const root = makeTmpDir();
    const tpl = makeTemplate(root);
    expect(isWorkspaceTemplateDir(tpl)).toBe(true);
    expect(isWorkspaceTemplateDir(path.join(root, "nope"))).toBe(false);
  });

  it("findTemplateDirUpFrom walks up to locate the template", () => {
    const root = makeTmpDir();
    const tpl = makeTemplate(root);
    const deep = path.join(root, "a/b/c");
    fs.mkdirSync(deep, { recursive: true });
    expect(findTemplateDirUpFrom(deep)).toBe(tpl);
  });

  it("locateWorkspaceTemplate honours AM_WORKSPACE_TEMPLATE", () => {
    const root = makeTmpDir();
    const tpl = makeTemplate(root);
    process.env.AM_WORKSPACE_TEMPLATE = tpl;
    expect(locateWorkspaceTemplate()).toBe(path.resolve(tpl));
    process.env.AM_WORKSPACE_TEMPLATE = path.join(root, "missing");
    expect(locateWorkspaceTemplate()).toBeNull();
  });

  it("listTemplateFiles returns rel paths and skips noise", () => {
    const root = makeTmpDir();
    const tpl = makeTemplate(root);
    expect(listTemplateFiles(tpl)).toEqual([
      ".agents/skills/demo/SKILL.md",
      "docs/README.md",
      "docs/template/EPIC模版.md",
      "skills-lock.json",
    ]);
  });

  it("preview counts new vs existing files", () => {
    const root = makeTmpDir();
    const tpl = makeTemplate(root);
    const ws = path.join(root, "ws");
    fs.mkdirSync(path.join(ws, "docs"), { recursive: true });
    fs.writeFileSync(path.join(ws, "docs/README.md"), "# user version");

    const p = previewWorkspaceInit(ws, tpl);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.totalFiles).toBe(4);
    expect(p.existingFiles).toBe(1);
    expect(p.newFiles).toBe(3);
    expect(p.existingSample).toEqual(["docs/README.md"]);
  });

  it("apply copies missing files and never replaces existing ones", () => {
    const root = makeTmpDir();
    const tpl = makeTemplate(root);
    const ws = path.join(root, "ws");
    fs.mkdirSync(path.join(ws, "docs"), { recursive: true });
    fs.writeFileSync(path.join(ws, "docs/README.md"), "# user version");

    const r = applyWorkspaceInit(ws, tpl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.copied).toBe(3);
    expect(r.skipped).toBe(1);
    // Existing file untouched.
    expect(fs.readFileSync(path.join(ws, "docs/README.md"), "utf8")).toBe(
      "# user version",
    );
    // Missing files copied with directory structure.
    expect(
      fs.readFileSync(path.join(ws, ".agents/skills/demo/SKILL.md"), "utf8"),
    ).toBe("---\n---\n");
    expect(fs.existsSync(path.join(ws, ".DS_Store"))).toBe(false);
  });

  it("apply into a non-existent workspace creates it", () => {
    const root = makeTmpDir();
    const tpl = makeTemplate(root);
    const ws = path.join(root, "brand-new-ws");
    const r = applyWorkspaceInit(ws, tpl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.copied).toBe(4);
    expect(r.skipped).toBe(0);
    expect(fs.readFileSync(path.join(ws, "skills-lock.json"), "utf8")).toBe(
      "{}",
    );
  });

  it("second apply is a no-op (everything skipped)", () => {
    const root = makeTmpDir();
    const tpl = makeTemplate(root);
    const ws = path.join(root, "ws");
    applyWorkspaceInit(ws, tpl);
    const r2 = applyWorkspaceInit(ws, tpl);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.copied).toBe(0);
    expect(r2.skipped).toBe(4);
  });

  it("preview flags non-writable workspace when files are missing", () => {
    const root = makeTmpDir();
    const tpl = makeTemplate(root);
    const ws = path.join(root, "ro-ws");
    fs.mkdirSync(ws, { recursive: true });
    fs.chmodSync(ws, 0o555);
    try {
      const p = previewWorkspaceInit(ws, tpl);
      expect(p.ok).toBe(true);
      if (!p.ok) return;
      expect(p.newFiles).toBe(4);
      expect(p.writable).toBe(false);
    } finally {
      fs.chmodSync(ws, 0o755);
    }
  });

  it("apply returns 403 needsAuthorization on non-writable workspace, no partial writes", () => {
    const root = makeTmpDir();
    const tpl = makeTemplate(root);
    const ws = path.join(root, "ro-ws2");
    fs.mkdirSync(ws, { recursive: true });
    fs.chmodSync(ws, 0o555);
    try {
      const r = applyWorkspaceInit(ws, tpl);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.status).toBe(403);
      expect(r.needsAuthorization).toBe(true);
      expect(fs.readdirSync(ws)).toEqual([]); // nothing half-copied
    } finally {
      fs.chmodSync(ws, 0o755);
    }
  });

  it("already-initialized workspace syncs with zero writes (works read-only)", () => {
    const root = makeTmpDir();
    const tpl = makeTemplate(root);
    const ws = path.join(root, "done-ws");
    applyWorkspaceInit(ws, tpl); // populate while writable
    fs.chmodSync(ws, 0o555);
    try {
      const p = previewWorkspaceInit(ws, tpl);
      expect(p.ok && p.newFiles === 0 && p.writable).toBe(true);
      const r = applyWorkspaceInit(ws, tpl);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.copied).toBe(0);
      expect(r.skipped).toBe(4);
    } finally {
      fs.chmodSync(ws, 0o755);
    }
  });
});
