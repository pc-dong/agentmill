import type { Card } from "./api";

const ACTIVE_DESIGN_COLS = new Set(["design", "split", "verify"]);

/** Read-only derived badges for requirement cards (not persisted). */
export function requirementDerivedBadges(
  card: Card,
  all: Card[],
): string[] {
  if (card.type !== "requirement") return [];
  const badges: string[] = [];

  const linkedDesigns = all.filter(
    (c) =>
      c.type === "design" &&
      (c.requirementIds ?? []).includes(card.id),
  );
  const activeDesign = linkedDesigns.find((d) =>
    ACTIVE_DESIGN_COLS.has(d.column),
  );
  if (activeDesign) {
    badges.push(`设计中: ${activeDesign.title}`);
  } else if (linkedDesigns.length > 0) {
    badges.push(`已挂设计 ${linkedDesigns.length} 轮`);
  }

  if (card.epicId) {
    const tasks = all.filter(
      (c) => c.type === "task" && c.epicId === card.epicId,
    );
    if (tasks.length > 0) {
      const done = tasks.filter((t) => t.column === "done").length;
      badges.push(`任务 ${done}/${tasks.length} Done`);
    }
  }

  return badges;
}

export function statusLabel(
  status: Card["status"],
): string {
  switch (status) {
    case "open":
      return "开放";
    case "in_progress":
      return "进行中";
    case "done":
      return "完成";
    default:
      return "";
  }
}
