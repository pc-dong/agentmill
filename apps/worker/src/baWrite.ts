import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  epicDirRel,
  prdRel,
  type BaSettleProtocol,
} from "@ai-workforce/agent";

export function resolveBaTemplatesDir(): string {
  if (process.env.AIW_BA_TEMPLATES) {
    return process.env.AIW_BA_TEMPLATES;
  }
  // apps/worker/src → repo root → packages/agent/templates/ba
  return fileURLToPath(
    new URL("../../../packages/agent/templates/ba", import.meta.url),
  );
}

function fillTemplate(
  tpl: string,
  vars: Record<string, string>,
): string {
  let out = tpl;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

function writeUtf8File(
  absPath: string,
  content: string,
  rel: string,
  written: string[],
  overwritten: string[],
): void {
  const existed = fs.existsSync(absPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
  if (existed) overwritten.push(rel);
  else written.push(rel);
}

function patchEpicIndex(
  epicAbs: string,
  protocol: BaSettleProtocol,
): void {
  const body = fs.readFileSync(epicAbs, "utf8");
  // Skip if a table row for this PRD already exists.
  const rowRe = new RegExp(
    `\\|\\s*${escapeRegExp(protocol.prdId)}\\s\\|`,
  );
  if (rowRe.test(body)) return;

  const row = `| ${protocol.prdId} | ${protocol.prdTitle} | Draft |`;
  const lines = body.split(/\r?\n/);
  let insertAt = -1;
  let inIndex = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^##\s+PRD Index/i.test(line)) {
      inIndex = true;
      continue;
    }
    if (inIndex && /^##\s+/.test(line)) break;
    if (inIndex && /^\|/.test(line) && !/^\|\s*-+/.test(line)) {
      insertAt = i + 1;
    }
  }

  if (insertAt >= 0) {
    lines.splice(insertAt, 0, row);
  } else if (inIndex) {
    lines.push(row);
  } else {
    lines.push("", "## PRD Index", "", "| PRD ID | Title | Status |", "|--------|-------|--------|", row);
  }
  fs.writeFileSync(epicAbs, lines.join("\n"), "utf8");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function writeBaDocuments(input: {
  workspacePath: string;
  protocol: BaSettleProtocol;
  summaryMarkdown: string;
  templatesDir: string;
}): Promise<{ written: string[]; overwritten: string[] }> {
  const { workspacePath, protocol, summaryMarkdown, templatesDir } = input;
  const written: string[] = [];
  const overwritten: string[] = [];
  const dirRel = epicDirRel(protocol);
  const epicRel = `${dirRel}/EPIC.md`;
  const sharedRel = `${dirRel}/shared-context.md`;
  const prdPathRel = prdRel(protocol);

  const common = {
    EPIC_TITLE: protocol.epicTitle,
    EPIC_ID: protocol.epicId,
    PRD_ID: protocol.prdId,
    PRD_TITLE: protocol.prdTitle,
    SUMMARY: summaryMarkdown,
  };

  if (protocol.mode === "create") {
    const epicTpl = fs.readFileSync(
      path.join(templatesDir, "EPIC.md.tpl"),
      "utf8",
    );
    const sharedTpl = fs.readFileSync(
      path.join(templatesDir, "shared-context.md.tpl"),
      "utf8",
    );
    const prdTpl = fs.readFileSync(
      path.join(templatesDir, "PRD.md.tpl"),
      "utf8",
    );

    writeUtf8File(
      path.join(workspacePath, epicRel),
      fillTemplate(epicTpl, { ...common, SLUG: protocol.epicSlug }),
      epicRel,
      written,
      overwritten,
    );
    writeUtf8File(
      path.join(workspacePath, sharedRel),
      fillTemplate(sharedTpl, { ...common, SLUG: protocol.epicSlug }),
      sharedRel,
      written,
      overwritten,
    );
    writeUtf8File(
      path.join(workspacePath, prdPathRel),
      fillTemplate(prdTpl, { ...common, SLUG: protocol.prdSlug }),
      prdPathRel,
      written,
      overwritten,
    );
  } else {
    const prdTpl = fs.readFileSync(
      path.join(templatesDir, "PRD.md.tpl"),
      "utf8",
    );
    writeUtf8File(
      path.join(workspacePath, prdPathRel),
      fillTemplate(prdTpl, { ...common, SLUG: protocol.prdSlug }),
      prdPathRel,
      written,
      overwritten,
    );

    const epicAbs = path.join(workspacePath, epicRel);
    // Link mode: if EPIC.md is missing, skip index patch (do not create EPIC).
    if (fs.existsSync(epicAbs)) {
      patchEpicIndex(epicAbs, protocol);
    }
  }

  return { written, overwritten };
}
