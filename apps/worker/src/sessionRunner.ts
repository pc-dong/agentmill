import type { AgentDriver } from "@ai-workforce/agent";
import type { BoardClient } from "./boardClient.js";
import type { WsClientOutMsg } from "./wsClient.js";

export type SessionUserMessage = {
  sessionId: string;
  cardId: string;
  text: string;
  boardId: string;
};

export async function handleSessionUserMessage(
  client: BoardClient,
  driver: AgentDriver,
  msg: SessionUserMessage,
  send: (out: WsClientOutMsg) => void,
): Promise<void> {
  const board = await client.getBoard();
  const card = await client.getCard(msg.cardId);
  const rawMessages = await client.listSessionMessages(msg.sessionId);

  const history = rawMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, -1)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.body,
    }));

  try {
    for await (const event of driver.chatStream({
      workspacePath: board.workspacePath,
      role: card.column,
      cardId: msg.cardId,
      boardId: msg.boardId,
      history,
      message: msg.text,
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
    const message = e instanceof Error ? e.message : String(e);
    send({
      type: "session.agent_error",
      sessionId: msg.sessionId,
      message,
    });
  }
}
