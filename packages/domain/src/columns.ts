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
  // requirements = 主题组装区；进入设计后走 design→split→verify
  epic: ["requirements", "design", "split", "verify"],
  task: ["dev", "test", "accept", "done"],
};

export function isColumnAllowedForType(
  type: CardType,
  column: ColumnId,
): boolean {
  return OCCUPANCY[type].includes(column);
}
