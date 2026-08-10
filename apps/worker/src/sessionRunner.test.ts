import { describe, expect, it, vi } from "vitest";
import type { AgentDriver } from "@ai-workforce/agent";
import { handleSessionUserMessage } from "./sessionRunner.js";

function fakeClient(overrides: {
  messages?: Array<{ role: string; body: string }>;
  employeeRole?: string;
  cardType?: string;
  column?: string;
} = {}) {
  return {
    getBoard: async () => ({ workspacePath: "/tmp/ws" }),
    getCard: async () => ({
      id: "c1",
      boardId: "b1",
      type: overrides.cardType ?? "epic",
      column: overrides.column ?? "design",
      title: "Card",
      description: "Desc",
    }),
    getSession: async () => ({
      id: "s1",
      boardId: "b1",
      cardId: "c1",
      employeeRole: overrides.employeeRole ?? "design",
      status: "open",
      createdAt: "t",
      updatedAt: "t",
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

  it("passes AbortSignal into chatStream", async () => {
    let seenSignal: AbortSignal | undefined;
    const driver: AgentDriver = {
      id: "mock",
      displayName: "Mock",
      oneshot: async () => ({ status: "ok", summary: "", artifacts: [] }),
      chatStream: async function* (input) {
        seenSignal = input.signal;
        yield { type: "done", summary: "ok" };
      },
    };

    await handleSessionUserMessage(
      fakeClient() as never,
      driver,
      {
        sessionId: "s-abort-signal",
        cardId: "c1",
        text: "hello",
        boardId: "b1",
      },
      vi.fn(),
    );

    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it("passes session employeeRole into chatStream", async () => {
    let seenRole: string | undefined;
    const driver: AgentDriver = {
      id: "mock",
      displayName: "Mock",
      oneshot: async () => ({ status: "ok", summary: "", artifacts: [] }),
      chatStream: async function* (input) {
        seenRole = input.role;
        yield { type: "done", summary: "ok" };
      },
    };

    await handleSessionUserMessage(
      fakeClient({ employeeRole: "ba", cardType: "requirement", column: "requirements" }) as never,
      driver,
      { sessionId: "s1", cardId: "c1", text: "hi", boardId: "b1" },
      vi.fn(),
    );

    expect(seenRole).toBe("ba");
  });

  it("falls back to ba for requirement when employeeRole empty", async () => {
    let seenRole: string | undefined;
    const driver: AgentDriver = {
      id: "mock",
      displayName: "Mock",
      oneshot: async () => ({ status: "ok", summary: "", artifacts: [] }),
      chatStream: async function* (input) {
        seenRole = input.role;
        yield { type: "done", summary: "ok" };
      },
    };

    await handleSessionUserMessage(
      fakeClient({
        employeeRole: "",
        cardType: "requirement",
        column: "requirements",
      }) as never,
      driver,
      { sessionId: "s1", cardId: "c1", text: "hi", boardId: "b1" },
      vi.fn(),
    );

    expect(seenRole).toBe("ba");
  });

  it("maps split session employeeRole to splitAlign for chatStream", async () => {
    let seenRole: string | undefined;
    const driver: AgentDriver = {
      id: "mock",
      displayName: "Mock",
      oneshot: async () => ({ status: "ok", summary: "", artifacts: [] }),
      chatStream: async function* (input) {
        seenRole = input.role;
        yield { type: "done", summary: "ok" };
      },
    };

    await handleSessionUserMessage(
      fakeClient({ employeeRole: "split", cardType: "design", column: "design" }) as never,
      driver,
      { sessionId: "s1", cardId: "c1", text: "align tasks", boardId: "b1" },
      vi.fn(),
    );

    expect(seenRole).toBe("splitAlign");
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
