import { parseArtifactHints } from "./parse.js";
import type { ArtifactHint } from "./types.js";

export type BaSettleProtocol = {
  mode: "create" | "link";
  epicId: string;
  epicSlug: string;
  epicTitle: string;
  prdId: string;
  prdSlug: string;
  prdTitle: string;
  artifacts: ArtifactHint[];
};

const MODE_RE = /^EPIC_MODE\s+(create|link)\b/i;
const EPIC_ID_RE = /^EPIC_ID\s+(\S+)/i;
const EPIC_SLUG_RE = /^EPIC_SLUG\s+(\S+)/i;
const EPIC_TITLE_RE = /^EPIC_TITLE\s+(.+)$/i;
const PRD_ID_RE = /^PRD_ID\s+(\S+)/i;
const PRD_SLUG_RE = /^PRD_SLUG\s+(\S+)/i;
const PRD_TITLE_RE = /^PRD_TITLE\s+(.+)$/i;

/** Strip markdown bullets/backticks/colons so models' slight formatting still parses. */
export function normalizeProtocolLine(raw: string): string {
  let line = raw.trim();
  if (!line || /^```/.test(line)) return "";
  line = line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "");
  line = line.replace(/^`+/, "").replace(/`+$/, "").trim();
  line = line.replace(
    /^(EPIC_MODE|EPIC_ID|EPIC_SLUG|EPIC_TITLE|PRD_ID|PRD_SLUG|PRD_TITLE|ARTIFACT)\s*[:：]\s*/i,
    "$1 ",
  );
  return line;
}

function isPrdPathArtifact(a: ArtifactHint): boolean {
  return a.kind === "file" && /\/prds\//.test(a.href);
}

export function parseBaSettle(
  summary: string,
): BaSettleProtocol | { error: string } {
  let mode: "create" | "link" | undefined;
  let epicId: string | undefined;
  let epicSlug: string | undefined;
  let epicTitle: string | undefined;
  let prdId: string | undefined;
  let prdSlug: string | undefined;
  let prdTitle: string | undefined;

  const normalized = summary
    .split(/\r?\n/)
    .map(normalizeProtocolLine)
    .filter(Boolean)
    .join("\n");

  for (const line of normalized.split("\n")) {
    let m = line.match(MODE_RE);
    if (m) {
      mode = m[1]!.toLowerCase() as "create" | "link";
      continue;
    }
    m = line.match(EPIC_ID_RE);
    if (m) {
      epicId = m[1]!;
      continue;
    }
    m = line.match(EPIC_SLUG_RE);
    if (m) {
      epicSlug = m[1]!;
      continue;
    }
    m = line.match(EPIC_TITLE_RE);
    if (m) {
      epicTitle = m[1]!.trim();
      continue;
    }
    m = line.match(PRD_ID_RE);
    if (m) {
      prdId = m[1]!;
      continue;
    }
    m = line.match(PRD_SLUG_RE);
    if (m) {
      prdSlug = m[1]!;
      continue;
    }
    m = line.match(PRD_TITLE_RE);
    if (m) {
      prdTitle = m[1]!.trim();
      continue;
    }
  }

  if (!mode) return { error: "missing EPIC_MODE" };
  if (!epicId) return { error: "missing EPIC_ID" };
  if (!epicSlug) return { error: "missing EPIC_SLUG" };
  if (!epicTitle) return { error: "missing EPIC_TITLE" };
  if (!prdId) return { error: "missing PRD_ID" };
  if (!prdSlug) return { error: "missing PRD_SLUG" };
  if (!prdTitle) return { error: "missing PRD_TITLE" };

  const artifacts = parseArtifactHints(normalized);
  const fileArtifacts = artifacts.filter((a) => a.kind === "file");

  if (mode === "create") {
    if (fileArtifacts.length < 1) {
      return { error: "create mode requires at least one ARTIFACT file" };
    }
  } else if (!fileArtifacts.some(isPrdPathArtifact)) {
    return { error: "link mode requires at least one PRD path ARTIFACT file" };
  }

  return {
    mode,
    epicId,
    epicSlug,
    epicTitle,
    prdId,
    prdSlug,
    prdTitle,
    artifacts,
  };
}

export function epicDirRel(p: BaSettleProtocol): string {
  return `docs/epics/${p.epicId}-${p.epicSlug}`;
}

export function prdRel(p: BaSettleProtocol): string {
  return `${epicDirRel(p)}/prds/${p.prdId}-${p.prdSlug}.md`;
}

/**
 * Always attach Epic + PRD (and shared-context on create) file links to the card,
 * even if the model omitted or mangled ARTIFACT lines.
 */
export function canonicalBaSettleArtifacts(
  protocol: BaSettleProtocol,
): ArtifactHint[] {
  const dir = epicDirRel(protocol);
  const base: ArtifactHint[] = [
    {
      kind: "file",
      href: `${dir}/EPIC.md`,
      label: `Epic ${protocol.epicId}`,
    },
  ];
  if (protocol.mode === "create") {
    base.push({
      kind: "file",
      href: `${dir}/shared-context.md`,
      label: "Shared context",
    });
  }
  base.push({
    kind: "file",
    href: prdRel(protocol),
    label: `PRD ${protocol.prdId}`,
  });

  const seen = new Set(base.map((a) => a.href));
  for (const a of protocol.artifacts) {
    if (seen.has(a.href)) continue;
    seen.add(a.href);
    base.push(a);
  }
  return base;
}
