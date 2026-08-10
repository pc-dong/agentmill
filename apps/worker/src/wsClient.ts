import WebSocket from "ws";
import type { AgentDriver } from "@ai-workforce/agent";
import type { BoardClient } from "./boardClient.js";
import type { WorkerConfig } from "./config.js";
import {
  abortSessionChat,
  handleSessionUserMessage,
} from "./sessionRunner.js";

export type WsClientOutMsg =
  | { type: "session.agent_delta"; sessionId: string; text: string }
  | { type: "session.agent_done"; sessionId: string; summary: string }
  | { type: "session.agent_error"; sessionId: string; message: string };

export type WsServerInMsg =
  | {
      type: "session.user_message";
      sessionId: string;
      cardId: string;
      text: string;
    }
  | { type: "session.abort"; sessionId: string }
  | { type: "error"; message: string };

export function apiBaseToWsUrl(apiBase: string): string {
  const url = new URL(apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
}

export type WsClientDeps = {
  config: WorkerConfig;
  client: BoardClient;
  driver: AgentDriver;
  log?: (msg: string) => void;
};

export async function runWsClient(deps: WsClientDeps): Promise<never> {
  const log = deps.log ?? console.log;
  const wsUrl = apiBaseToWsUrl(deps.config.apiBase);
  let backoffMs = 1000;

  for (;;) {
    try {
      await connectOnce(deps, wsUrl, log);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log(`ws disconnected: ${message}`);
    }
    await new Promise((r) => setTimeout(r, backoffMs));
    backoffMs = Math.min(backoffMs * 2, 30_000);
  }
}

async function connectOnce(
  deps: WsClientDeps,
  wsUrl: string,
  log: (msg: string) => void,
): Promise<void> {
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  ws.send(
    JSON.stringify({
      type: "hello",
      role: "worker",
      boardId: deps.config.boardId,
      workerId: deps.config.workerId,
    }),
  );
  log(`ws connected ${wsUrl}`);

  await new Promise<void>((resolve, reject) => {
    ws.on("message", (data) => {
      void handleIncoming(deps, ws, data).catch((e) => {
        log(`ws message handler error: ${e instanceof Error ? e.message : String(e)}`);
      });
    });
    ws.on("close", () => resolve());
    ws.on("error", reject);
  });
}

async function handleIncoming(
  deps: WsClientDeps,
  ws: WebSocket,
  data: WebSocket.RawData,
): Promise<void> {
  const raw = typeof data === "string" ? data : data.toString();
  let msg: WsServerInMsg;
  try {
    msg = JSON.parse(raw) as WsServerInMsg;
  } catch {
    return;
  }

  if (msg.type === "error") {
    console.error(`ws server error: ${msg.message}`);
    return;
  }

  if (msg.type === "session.abort") {
    abortSessionChat(msg.sessionId);
    return;
  }

  if (msg.type === "session.user_message") {
    await handleSessionUserMessage(
      deps.client,
      deps.driver,
      {
        sessionId: msg.sessionId,
        cardId: msg.cardId,
        text: msg.text,
        boardId: deps.config.boardId,
      },
      (out) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(out));
        }
      },
    );
  }
}
