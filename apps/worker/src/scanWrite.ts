import fs from "node:fs";
import path from "node:path";

/** Ensure docs/scans exists and write report markdown if missing or overwrite. */
export function writeScanReportFile(input: {
  workspacePath: string;
  relPath: string;
  markdown: string;
}): { absPath: string; relPath: string } {
  const rel = input.relPath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!rel.startsWith("docs/scans/")) {
    throw new Error(`scan report must be under docs/scans/: ${rel}`);
  }
  const abs = path.join(input.workspacePath, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, input.markdown, "utf8");
  return { absPath: abs, relPath: rel };
}

export function defaultScanReportPath(runCardId: string, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const short = runCardId.slice(0, 8);
  return `docs/scans/${day}-${short}.md`;
}
