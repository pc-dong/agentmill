import type { WebSocket } from "ws";
import type { SessionRepo } from "./sessions.js";

const WS_OPEN = 1;

export type WsClientRole = "ui" | "worker";

export type WsClientMsg =
  | {
      type: "hello";
      role: WsClientRole;
      /** Legacy single-board subscription; ignored when boardIds is present. */
      boardId?: string;
      /** Boards to subscribe to; "*" subscribes to every board. */
      boardIds?: string[];
      workerId?: string;
    }
  | { type: "session.user_message"; sessionId: string; text: string }
  | { type: "session.abort"; sessionId: string }
  | { type: "session.retry"; sessionId: string }
  | { type: "session.agent_delta"; sessionId: string; text: string }
  | { type: "session.agent_done"; sessionId: string; summary: string }
  | { type: "session.agent_error"; sessionId: string; message: string };

export type WsServerMsg =
  | {
      type: "session.user_message";
      sessionId: string;
      cardId: string;
      /** Board that owns the session — workers use it to scope workspace access. */
      boardId: string;
      text: string;
    }
  | { type: "session.abort"; sessionId: string }
  | { type: "session.agent_delta"; sessionId: string; text: string }
  | { type: "session.agent_done"; sessionId: string; summary: string }
  | { type: "session.agent_error"; sessionId: string; message: string }
  | { type: "error"; message: string };

type ClientState = {
  role: WsClientRole;
  boardIds: string[];
  workerId?: string;
};

/** Normalize hello payload into a board subscription list. */
function subscriptionFromHello(msg: {
  boardId?: string;
  boardIds?: string[];
}): string[] {
  if (Array.isArray(msg.boardIds) && msg.boardIds.length > 0) {
    const ids = msg.boardIds.filter((id) => typeof id === "string" && id);
    if (ids.includes("*")) return ["*"];
    return ids;
  }
  return msg.boardId ? [msg.boardId] : [];
}

function isSubscribed(state: ClientState, boardId: string): boolean {
  return state.boardIds.includes("*") || state.boardIds.includes(boardId);
}

export class WsHub {
  private readonly clients = new Map<WebSocket, ClientState>();

  constructor(private readonly sessions: SessionRepo) {}

  handleConnection(ws: WebSocket): void {
    ws.on("message", (data) => {
      const raw = typeof data === "string" ? data : data.toString();
      this.handleMessage(ws, raw);
    });
    ws.on("close", () => this.unsubscribe(ws));
  }

  subscribe(ws: WebSocket, state: ClientState): void {
    this.clients.set(ws, state);
  }

  unsubscribe(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  broadcast(boardId: string, role: WsClientRole, msg: WsServerMsg): void {
    const payload = JSON.stringify(msg);
    for (const [ws, state] of this.clients) {
      if (
        isSubscribed(state, boardId) &&
        state.role === role &&
        ws.readyState === WS_OPEN
      ) {
        ws.send(payload);
      }
    }
  }

  handleMessage(ws: WebSocket, raw: string): void {
    let msg: WsClientMsg;
    try {
      msg = JSON.parse(raw) as WsClientMsg;
    } catch {
      this.sendError(ws, "invalid json");
      return;
    }

    switch (msg.type) {
      case "hello":
        this.subscribe(ws, {
          role: msg.role,
          boardIds: subscriptionFromHello(msg),
          workerId: msg.workerId,
        });
        break;

      case "session.user_message": {
        const session = this.sessions.getSession(msg.sessionId);
        if (!session || session.status !== "open") {
          this.sendError(ws, "session not open");
          return;
        }
        this.sessions.appendMessage({
          sessionId: msg.sessionId,
          role: "user",
          body: msg.text,
        });
        this.broadcast(session.boardId, "worker", {
          type: "session.user_message",
          sessionId: msg.sessionId,
          cardId: session.cardId,
          boardId: session.boardId,
          text: msg.text,
        });
        break;
      }

      case "session.abort": {
        const session = this.sessions.getSession(msg.sessionId);
        if (!session || session.status !== "open") {
          this.sendError(ws, "session not open");
          return;
        }
        this.broadcast(session.boardId, "worker", {
          type: "session.abort",
          sessionId: msg.sessionId,
        });
        break;
      }

      case "session.retry": {
        const session = this.sessions.getSession(msg.sessionId);
        if (!session || session.status !== "open") {
          this.sendError(ws, "session not open");
          return;
        }
        const messages = this.sessions.listMessages(msg.sessionId);
        let lastUser: { body: string } | undefined;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i]?.role === "user") {
            lastUser = messages[i];
            break;
          }
        }
        if (!lastUser) {
          this.sendError(ws, "no user message to retry");
          return;
        }
        this.broadcast(session.boardId, "worker", {
          type: "session.user_message",
          sessionId: msg.sessionId,
          cardId: session.cardId,
          boardId: session.boardId,
          text: lastUser.body,
        });
        break;
      }

      case "session.agent_delta": {
        const session = this.sessions.getSession(msg.sessionId);
        if (!session) {
          this.sendError(ws, "session not found");
          return;
        }
        this.broadcast(session.boardId, "ui", {
          type: "session.agent_delta",
          sessionId: msg.sessionId,
          text: msg.text,
        });
        break;
      }

      case "session.agent_done": {
        const session = this.sessions.getSession(msg.sessionId);
        if (!session) {
          this.sendError(ws, "session not found");
          return;
        }
        this.sessions.appendMessage({
          sessionId: msg.sessionId,
          role: "assistant",
          body: msg.summary,
        });
        this.broadcast(session.boardId, "ui", {
          type: "session.agent_done",
          sessionId: msg.sessionId,
          summary: msg.summary,
        });
        break;
      }

      case "session.agent_error": {
        const session = this.sessions.getSession(msg.sessionId);
        if (!session) {
          this.sendError(ws, "session not found");
          return;
        }
        this.broadcast(session.boardId, "ui", {
          type: "session.agent_error",
          sessionId: msg.sessionId,
          message: msg.message,
        });
        break;
      }

      default:
        this.sendError(ws, "unknown message type");
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    if (ws.readyState === WS_OPEN) {
      ws.send(JSON.stringify({ type: "error", message } satisfies WsServerMsg));
    }
  }
}
