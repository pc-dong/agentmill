import { describe, expect, it } from "vitest";
import { parseOutcome } from "./parseOutcome.js";
import { MockDriver } from "./mock.js";

describe("MockDriver", () => {
  it("returns canned summary and parsed artifacts", async () => {
    const d = new MockDriver();
    const result = await d.oneshot({
      workspacePath: "/tmp/ws",
      prompt: "design please",
      role: "design",
      cardId: "c1",
      boardId: "b1",
    });
    expect(result.status).toBe("ok");
    expect(result.artifacts.some((a) => a.kind === "file")).toBe(true);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("returns role-aware outcome lines for split/verify/test", async () => {
    const d = new MockDriver();
    const split = await d.oneshot({
      workspacePath: "/tmp/ws",
      prompt: "split",
      role: "split",
      cardId: "e1",
      boardId: "b1",
    });
    expect(parseOutcome(split.summary).tasks).toHaveLength(2);

    const verify = await d.oneshot({
      workspacePath: "/tmp/ws",
      prompt: "verify",
      role: "verify",
      cardId: "e1",
      boardId: "b1",
    });
    expect(parseOutcome(verify.summary).verify).toBe("pass");

    const test = await d.oneshot({
      workspacePath: "/tmp/ws",
      prompt: "test",
      role: "test",
      cardId: "t1",
      boardId: "b1",
    });
    expect(parseOutcome(test.summary).test).toBe("pass");
  });
});
