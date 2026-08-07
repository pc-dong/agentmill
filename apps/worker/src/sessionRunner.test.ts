import { describe, expect, it, vi } from "vitest";
import type { AgentDriver } from "@ai-workforce/agent";
import { handleSessionUserMessage } from "./sessionRunner.js";

function fakeClient(overrides: {
  messages?: Array<{ role: string; body: string }>;
} = {}) {
  return {
    getBoard: async () => ({ workspacePath: "/tmp/ws" }),
    getCard: async () => ({
      id: "c1",
      boardId: "b1",
      column: "design",
      title: "Card",
      description: "Desc",
    }),
    listSessionMessages: async () =>
      overrides.messages ?? [
        { role: "user", body: "hello" },
      ],
  };
}

describe("handleSessionUserMessage", () => {
  it("emits agent_delta chunks then agent_done", async () => {
    const driver: AgentDriver = {
      id: "mock",
      displayName: "Mock",
      oneshot: async () => ({ status: "ok", summary: "", artifacts: [] }),
      chatStream: async function* () {
        yield { type: "text_delta", text: "Mock " };
        yield { type: "text_delta", text: "reply" };
        yield { type: "done", summary: "Mock reply done" };
      },
    };

    const send = vi.fn();
    await handleSessionUserMessage(
      fakeClient() as never,
      driver,
      {
        sessionId: "s1",
        cardId: "c1",
        text: "hello",
        boardId: "b1",
      },
      send,
    );

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0]![0]).toEqual({
      type: "session.agent_delta",
      sessionId: "s1",
      text: "Mock ",
    });
    expect(send.mock.calls[1]![0]).toEqual({
      type: "session.agent_delta",
      sessionId: "s1",
      text: "reply",
    });
    expect(send.mock.calls[2]![0]).toEqual({
      type: "session.agent_done",
      sessionId: "s1",
      summary: "Mock reply done",
    });
  });

  it("emits agent_error on driver error event", async () => {
    const driver: AgentDriver = {
      id: "mock",
      displayName: "Mock",
      oneshot: async () => ({ status: "ok", summary: "", artifacts: [] }),
      chatStream: async function* () {
        yield { type: "error", message: "boom" };
      },
    };

    const send = vi.fn();
    await handleSessionUserMessage(
      fakeClient() as never,
      driver,
      { sessionId: "s1", cardId: "c1", text: "hi", boardId: "b1" },
      send,
    );

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toEqual({
      type: "session.agent_error",
      sessionId: "s1",
      message: "boom",
    });
  });
});
