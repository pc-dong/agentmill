import { describe, expect, it } from "vitest";
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
});
