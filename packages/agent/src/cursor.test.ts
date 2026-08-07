import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "./types.js";

const mockSend = vi.fn();
const mockAsyncDispose = vi.fn(async () => {});

vi.mock("@cursor/sdk", () => ({
  Agent: {
    prompt: vi.fn(async () => ({
      id: "run-1",
      status: "finished",
      result: "ok\nARTIFACT file docs/x.md X",
    })),
    create: vi.fn(async () => ({
      agentId: "agent-1",
      send: mockSend,
      [Symbol.asyncDispose]: mockAsyncDispose,
    })),
  },
}));

import { Agent } from "@cursor/sdk";
import { CursorDriver } from "./cursor.js";

async function collectEvents(
  stream: AsyncIterable<AgentEvent>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function assistantStream(text: string) {
  return async function* () {
    yield {
      type: "assistant" as const,
      agent_id: "agent-1",
      run_id: "run-1",
      message: {
        role: "assistant" as const,
        content: [{ type: "text" as const, text }],
      },
    };
  };
}

describe("CursorDriver", () => {
  beforeEach(() => {
    vi.mocked(Agent.prompt).mockClear();
    vi.mocked(Agent.create).mockClear();
    mockSend.mockReset();
    mockAsyncDispose.mockClear();
    mockSend.mockResolvedValue({
      stream: assistantStream("Hello\nARTIFACT file docs/x.md X"),
    });
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

  it("chatStream uses Agent.create, send, and stream", async () => {
    const d = new CursorDriver({ apiKey: "test-key", modelId: "composer-2.5" });
    const events = await collectEvents(
      d.chatStream({
        workspacePath: "/tmp/ws",
        role: "design",
        cardId: "c1",
        boardId: "b1",
        history: [{ role: "user", content: "hi" }],
        message: "tell me more",
      }),
    );

    expect(Agent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-key",
        local: { cwd: "/tmp/ws" },
      }),
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.stringContaining("tell me more"),
    );
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
    const done = events.find((e) => e.type === "done");
    expect(done?.type === "done" && done.summary).toContain("docs/x.md");
    expect(mockAsyncDispose).toHaveBeenCalled();
  });

  it("chatStream yields error when Agent.create throws", async () => {
    vi.mocked(Agent.create).mockRejectedValueOnce(new Error("create failed"));
    const d = new CursorDriver({ apiKey: "k", modelId: "m" });
    const events = await collectEvents(
      d.chatStream({
        workspacePath: "/tmp",
        role: "design",
        cardId: "c1",
        boardId: "b1",
        history: [],
        message: "hello",
      }),
    );
    expect(events).toEqual([{ type: "error", message: "create failed" }]);
  });
});
