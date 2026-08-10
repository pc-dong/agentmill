import { api, type Card } from "./api";

export type PreviewGroup = "epic" | "prd" | "design" | "code" | "other";

export type PreviewSource = {
  path: string;
  label: string;
  group: PreviewGroup;
  from: "artifact" | "discovered";
};

const CODE_EXT =
  /\.(java|kt|kts|ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|html|htm|json|vue|xml|yml|yaml|toml|properties|gradle|txt)$/i;

export function classifyPath(filePath: string): PreviewGroup {
  const p = filePath.replace(/\\/g, "/");
  if (/EPIC\.md$/i.test(p)) return "epic";
  if (/\/prds\//i.test(p)) return "prd";
  if (CODE_EXT.test(p)) return "code";
  if (/\.md$/i.test(p)) {
    if (/\/design\//i.test(p) || /design/i.test(p)) return "design";
    return "design";
  }
  return "other";
}

export function groupLabel(group: PreviewGroup): string {
  switch (group) {
    case "epic":
      return "Epic";
    case "prd":
      return "PRD";
    case "design":
      return "设计文档";
    case "code":
      return "代码";
    default:
      return "其他";
  }
}

function fileName(p: string): string {
  const n = p.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

export function collectArtifactPaths(card: Card, all: Card[]): string[] {
  const paths = new Set<string>();
  const add = (c: Card | undefined) => {
    if (!c) return;
    for (const a of c.artifacts) {
      if (a.kind === "file" && a.href) paths.add(a.href.replace(/\\/g, "/"));
    }
  };

  add(card);

  const themeEpicId = card.type === "epic" ? card.id : card.epicId;
  if (themeEpicId) {
    add(all.find((c) => c.id === themeEpicId && c.type === "epic"));
  }

  if (card.type === "design") {
    for (const rid of card.requirementIds ?? []) {
      add(all.find((c) => c.id === rid));
    }
  }

  if (card.type === "requirement") {
    for (const d of all) {
      if (
        d.type === "design" &&
        (d.requirementIds ?? []).includes(card.id)
      ) {
        add(d);
      }
    }
  }

  if (card.type === "epic") {
    for (const c of all) {
      if (c.epicId === card.id) add(c);
    }
  }

  return [...paths];
}

export function inferEpicDocsRoots(paths: string[]): string[] {
  const roots = new Set<string>();
  for (const p of paths) {
    const m = p.replace(/\\/g, "/").match(/^(docs\/epics\/[^/]+)/);
    if (m?.[1]) roots.add(m[1]);
  }
  return [...roots];
}

const GROUP_ORDER: PreviewGroup[] = [
  "epic",
  "prd",
  "design",
  "code",
  "other",
];

export async function buildPreviewSources(
  boardId: string,
  card: Card,
  all: Card[],
): Promise<PreviewSource[]> {
  const artifactPaths = collectArtifactPaths(card, all);
  const byPath = new Map<string, PreviewSource>();

  for (const p of artifactPaths) {
    byPath.set(p, {
      path: p,
      label: fileName(p),
      group: classifyPath(p),
      from: "artifact",
    });
  }

  for (const root of inferEpicDocsRoots(artifactPaths)) {
    try {
      const tree = await api.listWorkspaceTree(boardId, root, 3);
      for (const f of tree.files) {
        const p = f.path.replace(/\\/g, "/");
        if (byPath.has(p)) continue;
        byPath.set(p, {
          path: p,
          label: f.name,
          group: classifyPath(p),
          from: "discovered",
        });
      }
    } catch {
      /* tree may 404 if dir missing */
    }
  }

  return [...byPath.values()].sort((a, b) => {
    const gi = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    if (gi !== 0) return gi;
    return a.path.localeCompare(b.path);
  });
}

export function groupSources(
  sources: PreviewSource[],
): Array<{ group: PreviewGroup; items: PreviewSource[] }> {
  const map = new Map<PreviewGroup, PreviewSource[]>();
  for (const s of sources) {
    const list = map.get(s.group) ?? [];
    list.push(s);
    map.set(s.group, list);
  }
  return GROUP_ORDER.filter((g) => map.has(g)).map((group) => ({
    group,
    items: map.get(group)!,
  }));
}
