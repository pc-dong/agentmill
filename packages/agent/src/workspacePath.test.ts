import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertUnderWorkspace,
  isPathInsideWorkspace,
  normalizeWorkspaceRoot,
  resolveUnderWorkspace,
} from "./workspacePath.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("workspacePath", () => {
  it("normalizes an existing directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-ws-"));
    tmpDirs.push(dir);
    expect(normalizeWorkspaceRoot(dir)).toBe(path.resolve(dir));
  });

  it("rejects path escape and absolute paths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-ws-"));
    tmpDirs.push(dir);
    expect(resolveUnderWorkspace(dir, "../outside").ok).toBe(false);
    expect(resolveUnderWorkspace(dir, "/etc/passwd").ok).toBe(false);
    expect(assertUnderWorkspace(dir, "docs/a.md").rel).toBe("docs/a.md");
    expect(isPathInsideWorkspace(dir, path.join(dir, "x"))).toBe(true);
    expect(isPathInsideWorkspace(dir, path.join(dir, "..", "y"))).toBe(false);
  });
});
