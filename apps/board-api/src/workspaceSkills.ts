import fs from "node:fs";
import path from "node:path";

export type WorkspaceSkillKind = "skill" | "command";

export type WorkspaceSkill = {
  name: string;
  description: string;
  path: string;
  kind: WorkspaceSkillKind;
  source: "agents" | "cursor-skills" | "cursor-commands";
};

const MAX_ITEMS = 200;
const MAX_DEPTH = 5;

function parseFrontmatter(raw: string): {
  name?: string;
  description?: string;
} {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const block = m[1]!;
  const out: { name?: string; description?: string } = {};

  // Simple YAML subset: name: value, description: value | folded
  const nameMatch = block.match(/^name:\s*(.+)$/m);
  if (nameMatch) {
    out.name = nameMatch[1]!.trim().replace(/^["']|["']$/g, "");
  }

  const descLine = block.match(/^description:\s*(.*)$/m);
  if (descLine) {
    const rest = descLine[1]!.trim();
    if (rest === "|" || rest === ">" || rest === "") {
      const after = block.slice(block.indexOf(descLine[0]!) + descLine[0]!.length);
      const lines: string[] = [];
      for (const line of after.split(/\r?\n/).slice(1)) {
        if (/^\S/.test(line) && !/^\s/.test(line)) break;
        if (/^[a-zA-Z_][\w-]*:/.test(line)) break;
        lines.push(line.replace(/^\s{2}/, "").trimEnd());
      }
      out.description = lines.join(" ").replace(/\s+/g, " ").trim();
    } else {
      out.description = rest.replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

function firstHeadingOrLine(raw: string): string {
  const withoutFm = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const h = withoutFm.match(/^#\s+(.+)$/m);
  if (h) return h[1]!.trim();
  for (const line of withoutFm.split(/\r?\n/)) {
    const t = line.trim();
    if (t) return t.slice(0, 200);
  }
  return "";
}

function walkSkillMd(
  absRoot: string,
  relRoot: string,
  source: WorkspaceSkill["source"],
  out: WorkspaceSkill[],
  depth: number,
): void {
  if (depth > MAX_DEPTH || out.length >= MAX_ITEMS) return;
  if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    if (out.length >= MAX_ITEMS) return;
    if (ent.name.startsWith(".")) continue;
    const abs = path.join(absRoot, ent.name);
    const rel = path.posix.join(relRoot.replace(/\\/g, "/"), ent.name);
    if (ent.isDirectory()) {
      walkSkillMd(abs, rel, source, out, depth + 1);
    } else if (ent.isFile() && ent.name === "SKILL.md") {
      let raw = "";
      try {
        raw = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const fm = parseFrontmatter(raw);
      const folderName = path.basename(path.dirname(abs));
      const name = (fm.name || folderName).trim();
      if (!name) continue;
      out.push({
        name,
        description: (fm.description || firstHeadingOrLine(raw)).slice(0, 300),
        path: rel.replace(/\\/g, "/"),
        kind: "skill",
        source,
      });
    }
  }
}

function listCommandFiles(
  absDir: string,
  relDir: string,
  out: WorkspaceSkill[],
): void {
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= MAX_ITEMS) return;
    if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
    const abs = path.join(absDir, ent.name);
    let raw = "";
    try {
      raw = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const name = ent.name.replace(/\.md$/i, "");
    const fm = parseFrontmatter(raw);
    out.push({
      name: (fm.name || name).trim(),
      description: (fm.description || firstHeadingOrLine(raw)).slice(0, 300),
      path: path.posix.join(relDir.replace(/\\/g, "/"), ent.name),
      kind: "command",
      source: "cursor-commands",
    });
  }
}

/**
 * Scan workspace for Cursor/agent skills and slash-command markdown files.
 * Roots: .agents/skills, .cursor/skills, .cursor/commands.
 */
export function scanWorkspaceSkills(workspacePath: string): WorkspaceSkill[] {
  const root = path.resolve(workspacePath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return [];
  }

  const out: WorkspaceSkill[] = [];
  walkSkillMd(
    path.join(root, ".agents", "skills"),
    ".agents/skills",
    "agents",
    out,
    0,
  );
  walkSkillMd(
    path.join(root, ".cursor", "skills"),
    ".cursor/skills",
    "cursor-skills",
    out,
    0,
  );
  listCommandFiles(
    path.join(root, ".cursor", "commands"),
    ".cursor/commands",
    out,
  );

  // Dedupe by kind+name (prefer agents > cursor-skills > commands)
  const rank: Record<WorkspaceSkill["source"], number> = {
    agents: 0,
    "cursor-skills": 1,
    "cursor-commands": 2,
  };
  const byKey = new Map<string, WorkspaceSkill>();
  for (const s of out) {
    const key = `${s.kind}:${s.name.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev || rank[s.source] < rank[prev.source]) {
      byKey.set(key, s);
    }
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "skill" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
