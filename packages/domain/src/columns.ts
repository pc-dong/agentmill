import type { CardType, ColumnId } from "./types.js";

export const COLUMN_ORDER: ColumnId[] = [
  "requirements",
  "design",
  "dev",
  "test",
  "accept",
  "done",
];

/** Legacy columns kept in the type union for migration; not shown on the board. */
export const LEGACY_COLUMNS: readonly ColumnId[] = ["split", "verify"];

const OCCUPANCY: Record<CardType, readonly ColumnId[]> = {
  requirement: ["requirements"],
  epic: ["requirements"],
  // Design stays in design until related tasks are done, then may move to done.
  design: ["design", "done"],
  task: ["dev", "test", "accept", "done"],
};

export function isColumnAllowedForType(
  type: CardType,
  column: ColumnId,
): boolean {
  return OCCUPANCY[type].includes(column);
}
