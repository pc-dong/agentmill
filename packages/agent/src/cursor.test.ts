import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "./types.js";

const mockSend = vi.fn();
const mockAsyncDispose = vi.fn(async () => {});

vi.mock("@cursor/sdk", () => ({
  Agent: {
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

const tmpDirs: string[] = [];

function makeWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-cursor-ws-"));
  tmpDirs.push(dir);
  return dir;
}

describe("CursorDriver", () => {
  beforeEach(() => {
    vi.mocked(Agent.create).mockClear();
    mockSend.mockReset();
    mockAsyncDispose.mockClear();
    mockSend.mockResolvedValue({
      stream: assistantStream("Hello\nARTIFACT file docs/x.md X"),
    });
  });

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("oneshot uses Agent.create, send, and stream", async () => {
    const ws = makeWs();
    const d = new CursorDriver({
      apiKey: "test-key",
      modelId: "composer-2.5",
    });
    const onProgress = vi.fn();
    const result = await d.oneshot({
      workspacePath: ws,
      prompt: "hello",
      role: "design",
      cardId: "c1",
      boardId: "b1",
      onProgress,
    });
    expect(Agent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-key",
        local: expect.objectContaining({
          cwd: ws,
          dirs: [ws],
          sandboxOptions: { enabled: true },
        }),
      }),
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.stringContaining("WORKSPACE BOUNDARY"),
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.stringContaining(`Workspace root (absolute): ${ws}`),
    );
    expect(result.status).toBe("ok");
    expect(result.artifacts[0]?.href).toBe("docs/x.md");
    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls.some((c) => String(c[0]).includes("执行中"))).toBe(
      true,
    );
  });

  it("returns error when Agent.create throws", async () => {
    const ws = makeWs();
    vi.mocked(Agent.create).mockRejectedValueOnce(new Error("sdk failed"));
    const d = new CursorDriver({ apiKey: "k", modelId: "m" });
    const result = await d.oneshot({
      workspacePath: ws,
      prompt: "x",
      role: "design",
      cardId: "c1",
      boardId: "b1",
    });
    expect(result.status).toBe("error");
    expect(result.summary).toBe("sdk failed");
    expect(result.artifacts).toEqual([]);
  });

  it("returns error when stream yields no assistant text", async () => {
    const ws = makeWs();
    mockSend.mockResolvedValueOnce({
      stream: async function* () {},
    });
    const d = new CursorDriver({ apiKey: "k", modelId: "m" });
    const result = await d.oneshot({
      workspacePath: ws,
      prompt: "x",
      role: "design",
      cardId: "c1",
      boardId: "b1",
    });
    expect(result.status).toBe("error");
    expect(result.summary).toMatch(/empty/i);
  });

  it("chatStream uses Agent.create, send, and stream", async () => {
    const ws = makeWs();
    const d = new CursorDriver({ apiKey: "test-key", modelId: "composer-2.5" });
    const events = await collectEvents(
      d.chatStream({
        workspacePath: ws,
        role: "design",
        cardId: "c1",
        boardId: "b1",
        history: [],
        message: "hi",
      }),
    );
    expect(Agent.create).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalled();
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
    expect(mockAsyncDispose).toHaveBeenCalled();
  });

  it("chatStream yields error when Agent.create throws", async () => {
    const ws = makeWs();
    vi.mocked(Agent.create).mockRejectedValueOnce(new Error("create failed"));
    const d = new CursorDriver({ apiKey: "k", modelId: "m" });
    const events = await collectEvents(
      d.chatStream({
        workspacePath: ws,
        role: "design",
        cardId: "c1",
        boardId: "b1",
        history: [],
        message: "hi",
      }),
    );
    expect(events).toEqual([{ type: "error", message: "create failed" }]);
  });

  it("chatStream yields error when send throws", async () => {
    const ws = makeWs();
    mockSend.mockRejectedValueOnce(new Error("send failed"));
    const d = new CursorDriver({ apiKey: "k", modelId: "m" });
    const events = await collectEvents(
      d.chatStream({
        workspacePath: ws,
        role: "design",
        cardId: "c1",
        boardId: "b1",
        history: [],
        message: "hi",
      }),
    );
    expect(events).toEqual([{ type: "error", message: "send failed" }]);
  });
});
