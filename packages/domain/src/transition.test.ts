import { describe, expect, it } from "vitest";
import { planMove } from "./transition.js";
import type { CardState } from "./types.js";

const designInDesign = (): CardState => ({
  id: "d1",
  type: "design",
  column: "design",
  reworkCount: 0,
  frozen: false,
});

const taskInAccept = (): CardState => ({
  id: "t1",
  type: "task",
  column: "accept",
  reworkCount: 0,
  frozen: false,
});

describe("planMove", () => {
  it("blocks design → done without human approval", () => {
    const result = planMove(designInDesign(), {
      to: "done",
      actor: "human",
      humanApproved: false,
    });
    expect(result.ok).toBe(false);
  });

  it("allows design → done with human approval", () => {
    const result = planMove(designInDesign(), {
      to: "done",
      actor: "human",
      humanApproved: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.column).toBe("done");
      expect(result.audit).toMatch(/design → done/);
    }
  });

  it("blocks bot from design → done even with flag", () => {
    const result = planMove(designInDesign(), {
      to: "done",
      actor: "bot",
      humanApproved: true,
    });
    expect(result.ok).toBe(false);
  });

  it("allows accept → done with human approval", () => {
    const result = planMove(taskInAccept(), {
      to: "done",
      actor: "human",
      humanApproved: true,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects wrong occupancy (task into design)", () => {
    const result = planMove(taskInAccept(), {
      to: "design",
      actor: "human",
      humanApproved: true,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects design into split (removed column)", () => {
    const result = planMove(designInDesign(), {
      to: "split",
      actor: "human",
      humanApproved: true,
    });
    expect(result.ok).toBe(false);
  });
});
