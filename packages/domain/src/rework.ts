import type { MoveResult } from "./transition.js";
import type { CardState } from "./types.js";

export const REWORK_LIMIT = 3;

export type TestFailureResult =
  | { kind: "reopen_dev"; next: CardState; audit: string }
  | { kind: "freeze"; next: CardState; audit: string };

export type HumanDecision = "return_dev" | "force_accept" | "close_done";

export function applyTestFailure(card: CardState): TestFailureResult {
  if (card.type !== "task" || card.column !== "test") {
    throw new Error("applyTestFailure only valid for task cards in test");
  }
  const reworkCount = card.reworkCount + 1;
  if (reworkCount >= REWORK_LIMIT) {
    const next: CardState = {
      ...card,
      reworkCount,
      frozen: true,
    };
    return {
      kind: "freeze",
      next,
      audit: `test failed; reworkCount=${reworkCount}; frozen for human decision`,
    };
  }
  const next: CardState = {
    ...card,
    column: "dev",
    reworkCount,
    frozen: false,
  };
  return {
    kind: "reopen_dev",
    next,
    audit: `test failed; return to dev; reworkCount=${reworkCount}`,
  };
}

export function applyHumanDecision(
  card: CardState,
  decision: HumanDecision,
): MoveResult {
  if (!card.frozen) {
    return { ok: false, reason: "Card is not frozen" };
  }
  if (card.type !== "task") {
    return { ok: false, reason: "Only task cards support rework decisions" };
  }
  // Rework human-decisions only apply to frozen tasks in test (not design-column
  // freeze-for-verify, which must go through Verify before design→dev).
  if (card.column !== "test") {
    return {
      ok: false,
      reason:
        "Human rework decisions only apply to frozen tasks in test column",
    };
  }
  if (decision === "return_dev") {
    return {
      ok: true,
      next: { ...card, column: "dev", frozen: false },
      audit: "human: unfreeze → dev (reworkCount preserved)",
    };
  }
  if (decision === "force_accept") {
    return {
      ok: true,
      next: { ...card, column: "accept", frozen: false },
      audit: "human: unfreeze → accept",
    };
  }
  return {
    ok: true,
    next: { ...card, column: "done", frozen: false },
    audit: "human: unfreeze → done (closed)",
  };
}
