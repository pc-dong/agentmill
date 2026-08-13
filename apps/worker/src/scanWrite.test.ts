import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeScanReportFile } from "./scanWrite.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("writeScanReportFile", () => {
  it("writes under docs/scans", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-scan-ws-"));
    tmpDirs.push(dir);
    const out = writeScanReportFile({
      workspacePath: dir,
      relPath: "docs/scans/a.md",
      markdown: "# hi\n",
    });
    expect(out.relPath).toBe("docs/scans/a.md");
    expect(fs.readFileSync(out.absPath, "utf8")).toContain("# hi");
  });

  it("rejects path escape via ..", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-scan-ws-"));
    tmpDirs.push(dir);
    expect(() =>
      writeScanReportFile({
        workspacePath: dir,
        relPath: "docs/scans/../../outside.md",
        markdown: "x",
      }),
    ).toThrow(/escapes workspace|must be under docs\/scans/);
  });
});
