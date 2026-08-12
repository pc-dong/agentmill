import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inferEpicDocsRoot,
  listWorkspaceTree,
  readWorkspaceFile,
  resolveUnderWorkspace,
} from "./workspaceFiles.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  dirs.length = 0;
});

function tempWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-ws-"));
  dirs.push(dir);
  return dir;
}

describe("workspaceFiles", () => {
  it("resolves relative paths under workspace", () => {
    const ws = tempWs();
    const r = resolveUnderWorkspace(ws, "docs/epics/E-1/EPIC.md");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rel).toBe("docs/epics/E-1/EPIC.md");
      expect(r.ext).toBe(".md");
    }
  });

  it("rejects path escape and absolute paths", () => {
    const ws = tempWs();
    expect(resolveUnderWorkspace(ws, "../outside").ok).toBe(false);
    expect(resolveUnderWorkspace(ws, "/etc/passwd").ok).toBe(false);
    expect(resolveUnderWorkspace(ws, "docs/../../etc/passwd").ok).toBe(false);
  });

  it("reads markdown and java files", () => {
    const ws = tempWs();
    const epicDir = path.join(ws, "docs/epics/E-DEMO-001-login");
    fs.mkdirSync(path.join(epicDir, "prds"), { recursive: true });
    fs.writeFileSync(path.join(epicDir, "EPIC.md"), "# Epic\n");
    fs.writeFileSync(
      path.join(epicDir, "prds/P-001.md"),
      "# PRD\n",
    );
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "src/App.java"), "class App {}");

    const md = readWorkspaceFile(ws, "docs/epics/E-DEMO-001-login/EPIC.md");
    expect(md.ok).toBe(true);
    if (md.ok) {
      expect(md.content).toContain("# Epic");
      expect(md.language).toBe("markdown");
    }

    const java = readWorkspaceFile(ws, "src/App.java");
    expect(java.ok).toBe(true);
    if (java.ok) {
      expect(java.language).toBe("java");
    }
  });

  it("rejects disallowed extensions and missing files", () => {
    const ws = tempWs();
    fs.writeFileSync(path.join(ws, "x.bin"), "\0");
    expect(readWorkspaceFile(ws, "x.bin").ok).toBe(false);
    expect(readWorkspaceFile(ws, "missing.md").ok).toBe(false);
  });

  it("lists epic tree with whitelist extensions", () => {
    const ws = tempWs();
    const epicDir = path.join(ws, "docs/epics/E-DEMO-001-login");
    fs.mkdirSync(path.join(epicDir, "prds"), { recursive: true });
    fs.mkdirSync(path.join(epicDir, "design"), { recursive: true });
    fs.writeFileSync(path.join(epicDir, "EPIC.md"), "# E");
    fs.writeFileSync(path.join(epicDir, "prds/P-1.md"), "# P");
    fs.writeFileSync(path.join(epicDir, "design/plan.md"), "# D");
    fs.writeFileSync(path.join(epicDir, "Foo.java"), "class Foo {}");
    fs.writeFileSync(path.join(epicDir, "x.bin"), "bin");

    const tree = listWorkspaceTree(ws, "docs/epics/E-DEMO-001-login", 2);
    expect(tree.ok).toBe(true);
    if (tree.ok) {
      const paths = tree.files.map((f) => f.path);
      expect(paths).toContain("docs/epics/E-DEMO-001-login/EPIC.md");
      expect(paths).toContain("docs/epics/E-DEMO-001-login/prds/P-1.md");
      expect(paths).toContain("docs/epics/E-DEMO-001-login/design/plan.md");
      expect(paths).toContain("docs/epics/E-DEMO-001-login/Foo.java");
      expect(paths.some((p) => p.endsWith(".bin"))).toBe(false);
    }

    expect(listWorkspaceTree(ws, "src", 2).ok).toBe(false);
  });

  it("infers epic docs root", () => {
    expect(
      inferEpicDocsRoot("docs/epics/E-DEMO-001-login/prds/P-1.md"),
    ).toBe("docs/epics/E-DEMO-001-login");
    expect(inferEpicDocsRoot("src/App.java")).toBeNull();
  });

  it("resolves nested-repo-relative paths under workspace root", () => {
    const ws = tempWs();
    const nested = path.join(
      ws,
      "up-masterdata-service/productms-commerce/domain/lib/src/test/java",
    );
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "FooTest.java"), "class FooTest {}");

    const missingDirect = readWorkspaceFile(
      ws,
      "productms-commerce/domain/lib/src/test/java/FooTest.java",
    );
    expect(missingDirect.ok).toBe(true);
    if (missingDirect.ok) {
      expect(missingDirect.path).toBe(
        "up-masterdata-service/productms-commerce/domain/lib/src/test/java/FooTest.java",
      );
      expect(missingDirect.content).toContain("FooTest");
    }
  });

  it("still rejects path escape when searching by suffix", () => {
    const ws = tempWs();
    expect(readWorkspaceFile(ws, "../outside.java").ok).toBe(false);
    expect(resolveUnderWorkspace(ws, "../outside.java").ok).toBe(false);
  });
});
