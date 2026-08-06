import type { CardType, ColumnId } from "./types.js";

export const COLUMN_ORDER: ColumnId[] = [
  "requirements",
  "design",
  "split",
  "verify",
  "dev",
  "test",
  "accept",
  "done",
];

const OCCUPANCY: Record<CardType, readonly ColumnId[]> = {
  requirement: ["requirements"],
  epic: ["design", "split", "verify"],
  task: ["dev", "test", "accept", "done"],
};

export function isColumnAllowedForType(
  type: CardType,
  column: ColumnId,
): boolean {
  return OCCUPANCY[type].includes(column);
}
