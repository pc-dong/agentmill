export type SplitSettleOp =
  | { kind: "create"; title: string; description: string; planPath?: string }
  | {
      kind: "update";
      cardId: string;
      title: string;
      description: string;
      planPath?: string;
    }
  | { kind: "delete"; cardId: string }
  | { kind: "note"; text: string };

const TASK_CREATE = /^TASK\s+create\s*\|/i;
const TASK_UPDATE = /^TASK\s+update\s*\|/i;
const TASK_DELETE = /^TASK\s+delete\s*\|/i;
const SPLIT_NOTE = /^SPLIT\s+note\s*\|/i;

function parsePlanAndDescription(parts: string[]): {
  description: string;
  planPath?: string;
} {
  let description = "";
  let planPath: string | undefined;
  for (const p of parts) {
    const plan = p.match(/^plan:(.+)$/i);
    if (plan) {
      planPath = plan[1]!.trim();
    } else if (!description) {
      description = p;
    } else {
      description = `${description} | ${p}`;
    }
  }
  return { description, planPath };
}

export function parseSplitSettle(text: string): SplitSettleOp[] {
  const ops: SplitSettleOp[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (TASK_CREATE.test(line)) {
      const rest = line.replace(/^TASK\s+create\s*\|\s*/i, "");
      const parts = rest.split("|").map((p) => p.trim());
      const title = parts[0] ?? "";
      if (!title) continue;
      const { description, planPath } = parsePlanAndDescription(parts.slice(1));
      ops.push({ kind: "create", title, description, planPath });
      continue;
    }

    if (TASK_UPDATE.test(line)) {
      const rest = line.replace(/^TASK\s+update\s*\|\s*/i, "");
      const parts = rest.split("|").map((p) => p.trim());
      const cardId = parts[0] ?? "";
      const title = parts[1] ?? "";
      if (!cardId || !title) continue;
      const { description, planPath } = parsePlanAndDescription(parts.slice(2));
      ops.push({ kind: "update", cardId, title, description, planPath });
      continue;
    }

    if (TASK_DELETE.test(line)) {
      const rest = line.replace(/^TASK\s+delete\s*\|\s*/i, "").trim();
      if (!rest) continue;
      ops.push({ kind: "delete", cardId: rest });
      continue;
    }

    if (SPLIT_NOTE.test(line)) {
      const rest = line.replace(/^SPLIT\s+note\s*\|\s*/i, "");
      ops.push({ kind: "note", text: rest.trim() });
    }
  }

  return ops;
}
