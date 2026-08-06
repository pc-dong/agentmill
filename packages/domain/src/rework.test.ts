import { describe, expect, it } from "vitest";
import { applyHumanDecision, applyTestFailure, REWORK_LIMIT } from "./rework.js";
import type { CardState } from "./types.js";

function taskInTest(reworkCount: number, frozen = false): CardState {
  return {
    id: "t1",
    type: "task",
    column: "test",
    reworkCount,
    frozen,
    epicId: "e1",
  };
}

describe("applyTestFailure", () => {
  it("returns to dev and increments reworkCount when below limit", () => {
    const result = applyTestFailure(taskInTest(0));
    expect(result.kind).toBe("reopen_dev");
    if (result.kind === "reopen_dev") {
      expect(result.next.column).toBe("dev");
      expect(result.next.reworkCount).toBe(1);
      expect(result.next.frozen).toBe(false);
    }
  });

  it("freezes when reworkCount would reach REWORK_LIMIT", () => {
    const result = applyTestFailure(taskInTest(REWORK_LIMIT - 1));
    expect(result.kind).toBe("freeze");
    if (result.kind === "freeze") {
      expect(result.next.reworkCount).toBe(REWORK_LIMIT);
      expect(result.next.frozen).toBe(true);
      expect(result.next.column).toBe("test");
    }
  });
});

describe("applyHumanDecision", () => {
  it("return_dev unfreezes stay count and moves to dev", () => {
    const card = taskInTest(3, true);
    const result = applyHumanDecision(card, "return_dev");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.column).toBe("dev");
      expect(result.next.frozen).toBe(false);
      expect(result.next.reworkCount).toBe(3);
    }
  });

  it("force_accept moves frozen card to accept", () => {
    const result = applyHumanDecision(taskInTest(3, true), "force_accept");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.column).toBe("accept");
      expect(result.next.frozen).toBe(false);
    }
  });

  it("close_done requires going to done with human semantics", () => {
    const result = applyHumanDecision(taskInTest(3, true), "close_done");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.column).toBe("done");
      expect(result.next.frozen).toBe(false);
    }
  });
});
