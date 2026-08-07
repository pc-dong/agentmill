import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@cursor/sdk", () => ({
  Agent: {
    prompt: vi.fn(async () => ({
      id: "run-1",
      status: "finished",
      result: "ok\nARTIFACT file docs/x.md X",
    })),
  },
}));

import { Agent } from "@cursor/sdk";
import { CursorDriver } from "./cursor.js";

describe("CursorDriver", () => {
  beforeEach(() => {
    vi.mocked(Agent.prompt).mockClear();
  });

  it("calls Agent.prompt with local cwd", async () => {
    const d = new CursorDriver({
      apiKey: "test-key",
      modelId: "composer-2.5",
    });
    const result = await d.oneshot({
      workspacePath: "/tmp/ws",
      prompt: "hello",
      role: "design",
      cardId: "c1",
      boardId: "b1",
    });
    expect(Agent.prompt).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({
        apiKey: "test-key",
        local: { cwd: "/tmp/ws" },
      }),
    );
    expect(result.status).toBe("ok");
    expect(result.artifacts[0]?.href).toBe("docs/x.md");
  });

  it("returns error when Agent.prompt throws", async () => {
    vi.mocked(Agent.prompt).mockRejectedValueOnce(new Error("sdk failed"));
    const d = new CursorDriver({ apiKey: "k", modelId: "m" });
    const result = await d.oneshot({
      workspacePath: "/tmp",
      prompt: "x",
      role: "design",
      cardId: "c1",
      boardId: "b1",
    });
    expect(result.status).toBe("error");
    expect(result.summary).toBe("sdk failed");
    expect(result.artifacts).toEqual([]);
  });

  it("returns error when run status is not finished", async () => {
    vi.mocked(Agent.prompt).mockResolvedValueOnce({
      id: "run-1",
      status: "error",
      error: { message: "agent error" },
    });
    const d = new CursorDriver({ apiKey: "k", modelId: "m" });
    const result = await d.oneshot({
      workspacePath: "/tmp",
      prompt: "x",
      role: "design",
      cardId: "c1",
      boardId: "b1",
    });
    expect(result.status).toBe("error");
    expect(result.summary).toBe("agent error");
  });
});
