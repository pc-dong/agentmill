import fs from "node:fs";
import path from "node:path";
import { assertUnderWorkspace } from "@agentmill/agent";

/** Ensure docs/scans exists and write report markdown if missing or overwrite. */
export function writeScanReportFile(input: {
  workspacePath: string;
  relPath: string;
  markdown: string;
}): { absPath: string; relPath: string } {
  const rel = input.relPath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!rel.startsWith("docs/scans/") || rel.split("/").includes("..")) {
    throw new Error(`scan report must be under docs/scans/: ${rel}`);
  }
  const resolved = assertUnderWorkspace(input.workspacePath, rel);
  if (!resolved.rel.startsWith("docs/scans/")) {
    throw new Error(`scan report must be under docs/scans/: ${resolved.rel}`);
  }
  fs.mkdirSync(path.dirname(resolved.abs), { recursive: true });
  fs.writeFileSync(resolved.abs, input.markdown, "utf8");
  return { absPath: resolved.abs, relPath: resolved.rel };
}

export function defaultScanReportPath(runCardId: string, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const short = runCardId.slice(0, 8);
  return `docs/scans/${day}-${short}.md`;
}
