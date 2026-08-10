import { isColumnAllowedForType } from "./columns.js";
import type { Actor, CardState, ColumnId } from "./types.js";

export type MoveRequest = {
  to: ColumnId;
  actor: Actor;
  humanApproved?: boolean;
};

export type MoveResult =
  | { ok: true; next: CardState; audit: string }
  | { ok: false; reason: string };

const HUMAN_GATES: ReadonlyArray<readonly [ColumnId, ColumnId]> = [
  ["design", "done"],
  ["accept", "done"],
];

function requiresHumanGate(from: ColumnId, to: ColumnId): boolean {
  return HUMAN_GATES.some(([a, b]) => a === from && b === to);
}

export function planMove(card: CardState, req: MoveRequest): MoveResult {
  if (card.frozen && req.actor === "bot") {
    return { ok: false, reason: "Card is frozen; bot cannot move it" };
  }
  if (card.frozen && req.actor === "human" && !req.humanApproved) {
    return {
      ok: false,
      reason: "Card is frozen; human must explicitly approve a decision move",
    };
  }
  if (!isColumnAllowedForType(card.type, req.to)) {
    return {
      ok: false,
      reason: `Type ${card.type} cannot occupy column ${req.to}`,
    };
  }
  if (
    card.type === "task" &&
    card.column === "design" &&
    req.to === "dev" &&
    req.actor === "bot"
  ) {
    return {
      ok: false,
      reason: "Move design → dev for tasks requires a human drag",
    };
  }
  if (requiresHumanGate(card.column, req.to)) {
    if (req.actor !== "human" || !req.humanApproved) {
      return {
        ok: false,
        reason: `Move ${card.column} → ${req.to} requires human approval`,
      };
    }
  }
  const next: CardState = { ...card, column: req.to };
  return {
    ok: true,
    next,
    audit: `${req.actor}: ${card.column} → ${req.to}`,
  };
}
