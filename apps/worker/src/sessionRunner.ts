import type { AgentDriver } from "@ai-workforce/agent";
import type { BoardClient } from "./boardClient.js";
import type { WsClientOutMsg } from "./wsClient.js";

export type SessionUserMessage = {
  sessionId: string;
  cardId: string;
  text: string;
  boardId: string;
};

/** In-flight chat streams keyed by sessionId — aborted on session.abort. */
const activeControllers = new Map<string, AbortController>();

export function abortSessionChat(sessionId: string): boolean {
  const ctrl = activeControllers.get(sessionId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

export async function handleSessionUserMessage(
  client: BoardClient,
  driver: AgentDriver,
  msg: SessionUserMessage,
  send: (out: WsClientOutMsg) => void,
): Promise<void> {
  // Replace any in-flight generation for this session.
  abortSessionChat(msg.sessionId);
  const controller = new AbortController();
  activeControllers.set(msg.sessionId, controller);

  try {
    const board = await client.getBoard();
    const card = await client.getCard(msg.cardId);
    const session = await client.getSession(msg.sessionId);
    const rawMessages = await client.listSessionMessages(msg.sessionId);

    const history = rawMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(0, -1)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.body,
      }));

    const employeeRole =
      session.employeeRole ||
      (card.type === "requirement" ? "ba" : "design");
    const promptRole = employeeRole === "split" ? "splitAlign" : employeeRole;

    for await (const event of driver.chatStream({
      workspacePath: board.workspacePath,
      role: promptRole,
      cardId: msg.cardId,
      boardId: msg.boardId,
      history,
      message: msg.text,
      signal: controller.signal,
    })) {
      switch (event.type) {
        case "text_delta":
          send({
            type: "session.agent_delta",
            sessionId: msg.sessionId,
            text: event.text,
          });
          break;
        case "done":
          send({
            type: "session.agent_done",
            sessionId: msg.sessionId,
            summary: event.summary,
          });
          return;
        case "error":
          send({
            type: "session.agent_error",
            sessionId: msg.sessionId,
            message: event.message,
          });
          return;
        default:
          break;
      }
    }
  } catch (e) {
    if (controller.signal.aborted) {
      send({
        type: "session.agent_done",
        sessionId: msg.sessionId,
        summary: "*(已打断)*",
      });
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    send({
      type: "session.agent_error",
      sessionId: msg.sessionId,
      message,
    });
  } finally {
    if (activeControllers.get(msg.sessionId) === controller) {
      activeControllers.delete(msg.sessionId);
    }
  }
}
