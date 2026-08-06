import { describe, expect, it } from "vitest";
import { planMove } from "./transition.js";
import type { CardState } from "./types.js";

const epicDesign = (): CardState => ({
  id: "e1",
  type: "epic",
  column: "design",
  reworkCount: 0,
  frozen: false,
});

const taskAccept = (): CardState => ({
  id: "t1",
  type: "task",
  column: "accept",
  reworkCount: 0,
  frozen: false,
  epicId: "e1",
});

describe("planMove gates", () => {
  it("blocks design → split without human approval", () => {
    const result = planMove(epicDesign(), {
      to: "split",
      actor: "human",
      humanApproved: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/human approval/i);
  });

  it("allows design → split with human approval", () => {
    const result = planMove(epicDesign(), {
      to: "split",
      actor: "human",
      humanApproved: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.column).toBe("split");
      expect(result.audit).toMatch(/design → split/);
    }
  });

  it("blocks bot from design → split even with flag", () => {
    const result = planMove(epicDesign(), {
      to: "split",
      actor: "bot",
      humanApproved: true,
    });
    expect(result.ok).toBe(false);
  });

  it("blocks accept → done without human approval", () => {
    const result = planMove(taskAccept(), {
      to: "done",
      actor: "human",
      humanApproved: false,
    });
    expect(result.ok).toBe(false);
  });

  it("allows bot auto-move dev → test when not frozen", () => {
    const card: CardState = {
      id: "t2",
      type: "task",
      column: "dev",
      reworkCount: 0,
      frozen: false,
    };
    const result = planMove(card, { to: "test", actor: "bot" });
    expect(result.ok).toBe(true);
  });

  it("rejects wrong occupancy (task into design)", () => {
    const card: CardState = {
      id: "t3",
      type: "task",
      column: "dev",
      reworkCount: 0,
      frozen: false,
    };
    const result = planMove(card, {
      to: "design",
      actor: "human",
      humanApproved: true,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects any move when frozen unless human unfreeze path handled elsewhere", () => {
    const card: CardState = {
      id: "t4",
      type: "task",
      column: "test",
      reworkCount: 3,
      frozen: true,
    };
    const result = planMove(card, { to: "accept", actor: "bot" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/frozen/i);
  });
});
