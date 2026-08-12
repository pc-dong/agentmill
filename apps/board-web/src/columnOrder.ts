import type { Card, RequirementStatus } from "./api";

function cardTime(c: Card): number {
  const iso = c.updatedAt ?? c.columnEnteredAt ?? c.createdAt ?? "";
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function matchesQuery(c: Card, q: string): boolean {
  if (!q) return true;
  const hay = `${c.title}\n${c.description ?? ""}`.toLowerCase();
  return hay.includes(q);
}

function reqStatusRank(status: RequirementStatus | null | undefined): number {
  switch (status) {
    case "in_progress":
      return 0;
    case "done":
      return 2;
    case "open":
    default:
      return 1;
  }
}

function compareTimeDesc(a: Card, b: Card): number {
  return cardTime(b) - cardTime(a);
}

/** Requirements column: search + epic grouping + status order. */
export function orderRequirementsColumn(
  allCards: Card[],
  query: string,
): Card[] {
  const inCol = allCards.filter((c) => c.column === "requirements");
  const q = query.trim().toLowerCase();

  const epics = inCol.filter((c) => c.type === "epic");
  const reqs = inCol.filter((c) => c.type === "requirement");

  let visibleEpics = epics;
  let visibleReqs = reqs;

  if (q) {
    const matchedEpicIds = new Set(
      epics.filter((e) => matchesQuery(e, q)).map((e) => e.id),
    );
    const matchedReqs = reqs.filter(
      (r) =>
        matchesQuery(r, q) ||
        (r.epicId != null && matchedEpicIds.has(r.epicId)),
    );
    const keepEpicIds = new Set<string>();
    for (const r of matchedReqs) {
      if (r.epicId) keepEpicIds.add(r.epicId);
    }
    for (const id of matchedEpicIds) keepEpicIds.add(id);

    visibleReqs = matchedReqs;
    visibleEpics = epics.filter((e) => keepEpicIds.has(e.id));
  }

  type Unit = {
    priority: number;
    freshness: number;
    cards: Card[];
  };

  const byEpic = new Map<string, { epic: Card | null; reqs: Card[] }>();
  for (const epic of visibleEpics) {
    byEpic.set(epic.id, { epic, reqs: [] });
  }

  const orphanReqs: Card[] = [];
  for (const r of visibleReqs) {
    if (!r.epicId) {
      orphanReqs.push(r);
      continue;
    }
    let g = byEpic.get(r.epicId);
    if (!g) {
      g = {
        epic: visibleEpics.find((e) => e.id === r.epicId) ?? null,
        reqs: [],
      };
      byEpic.set(r.epicId, g);
    }
    g.reqs.push(r);
  }

  const units: Unit[] = [];

  for (const g of byEpic.values()) {
    g.reqs.sort((a, b) => {
      const sr = reqStatusRank(a.status) - reqStatusRank(b.status);
      if (sr !== 0) return sr;
      return compareTimeDesc(a, b);
    });
    if (!g.epic && g.reqs.length === 0) continue;
    const priority =
      g.reqs.length === 0
        ? 1
        : Math.min(...g.reqs.map((r) => reqStatusRank(r.status)));
    const freshness = Math.max(
      0,
      ...(g.epic ? [cardTime(g.epic)] : []),
      ...g.reqs.map(cardTime),
    );
    units.push({
      priority,
      freshness,
      cards: [...(g.epic ? [g.epic] : []), ...g.reqs],
    });
  }

  for (const r of orphanReqs) {
    units.push({
      priority: reqStatusRank(r.status),
      freshness: cardTime(r),
      cards: [r],
    });
  }

  units.sort((a, b) => {
    const pr = a.priority - b.priority;
    if (pr !== 0) return pr;
    return b.freshness - a.freshness;
  });

  return units.flatMap((u) => u.cards);
}

/** Done column: search + epic groups; design above its tasks; time desc. */
export function orderDoneColumn(allCards: Card[], query: string): Card[] {
  const inCol = allCards.filter((c) => c.column === "done");
  const q = query.trim().toLowerCase();

  let visible = inCol;
  if (q) {
    const matched = inCol.filter((c) => matchesQuery(c, q));
    const keep = new Set(matched.map((c) => c.id));
    for (const c of matched) {
      if (c.type === "task" && c.designId) {
        const design = inCol.find(
          (d) => d.type === "design" && d.id === c.designId,
        );
        if (design) keep.add(design.id);
      }
      if (c.type === "design") {
        for (const t of inCol) {
          if (t.type === "task" && t.designId === c.id) keep.add(t.id);
        }
      }
    }
    visible = inCol.filter((c) => keep.has(c.id));
  }

  const designs = visible.filter((c) => c.type === "design");
  const tasks = visible.filter((c) => c.type === "task");
  const others = visible.filter(
    (c) => c.type !== "design" && c.type !== "task",
  );

  type EpicBucket = {
    epicId: string | null;
    designs: Card[];
    orphanTasks: Card[];
  };

  const buckets = new Map<string | null, EpicBucket>();
  function bucket(epicId: string | null): EpicBucket {
    let b = buckets.get(epicId);
    if (!b) {
      b = { epicId, designs: [], orphanTasks: [] };
      buckets.set(epicId, b);
    }
    return b;
  }

  for (const d of designs) {
    bucket(d.epicId ?? null).designs.push(d);
  }

  const designIds = new Set(designs.map((d) => d.id));
  for (const t of tasks) {
    if (t.designId && designIds.has(t.designId)) {
      // attached under design later
      continue;
    }
    bucket(t.epicId ?? null).orphanTasks.push(t);
  }

  for (const b of buckets.values()) {
    b.designs.sort(compareTimeDesc);
    b.orphanTasks.sort(compareTimeDesc);
  }

  const orderedBuckets = [...buckets.values()].sort((a, b) => {
    const aOrphan = a.epicId == null ? 1 : 0;
    const bOrphan = b.epicId == null ? 1 : 0;
    if (aOrphan !== bOrphan) return aOrphan - bOrphan;
    const aTime = Math.max(
      0,
      ...a.designs.map(cardTime),
      ...a.orphanTasks.map(cardTime),
      ...tasks
        .filter(
          (t) =>
            t.designId &&
            a.designs.some((d) => d.id === t.designId),
        )
        .map(cardTime),
    );
    const bTime = Math.max(
      0,
      ...b.designs.map(cardTime),
      ...b.orphanTasks.map(cardTime),
      ...tasks
        .filter(
          (t) =>
            t.designId &&
            b.designs.some((d) => d.id === t.designId),
        )
        .map(cardTime),
    );
    return bTime - aTime;
  });

  const tasksByDesign = new Map<string, Card[]>();
  for (const t of tasks) {
    if (!t.designId || !designIds.has(t.designId)) continue;
    const list = tasksByDesign.get(t.designId) ?? [];
    list.push(t);
    tasksByDesign.set(t.designId, list);
  }
  for (const list of tasksByDesign.values()) {
    list.sort(compareTimeDesc);
  }

  const out: Card[] = [];
  for (const b of orderedBuckets) {
    for (const d of b.designs) {
      out.push(d);
      out.push(...(tasksByDesign.get(d.id) ?? []));
    }
    out.push(...b.orphanTasks);
  }
  others.sort(compareTimeDesc);
  out.push(...others);
  return out;
}

export function cardsForColumn(
  allCards: Card[],
  columnId: string,
  queries: { requirements: string; done: string },
): Card[] {
  if (columnId === "requirements") {
    return orderRequirementsColumn(allCards, queries.requirements);
  }
  if (columnId === "done") {
    return orderDoneColumn(allCards, queries.done);
  }
  return allCards.filter((c) => c.column === columnId);
}
