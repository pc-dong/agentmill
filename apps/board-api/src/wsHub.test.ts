import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDb } from "./db.js";
import { BoardRepo } from "./repo.js";
import { SessionRepo } from "./sessions.js";
import { WsHub } from "./wsHub.js";

const tmpFiles: string[] = [];

afterEach(() => {
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  tmpFiles.length = 0;
});

type MockWs = WebSocket & {
  sent: string[];
  handlers: Record<string, Array<(...args: unknown[]) => void>>;
};

function createMockWs(): MockWs {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const ws = {
    sent: [] as string[],
    readyState: 1,
    send(data: string) {
      ws.sent.push(data);
    },
    on(event: string, cb: (...args: unknown[]) => void) {
      (handlers[event] ??= []).push(cb);
    },
    handlers,
  };
  return ws as MockWs;
}

function tempHub(): {
  hub: WsHub;
  sessions: SessionRepo;
  boardId: string;
  cardId: string;
  sessionId: string;
} {
  const file = path.join(
    os.tmpdir(),
    `aiw-wshub-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  tmpFiles.push(file);
  const db = openDb(file);
  migrate(db);
  const board = new BoardRepo(db);
  const sessions = new SessionRepo(db);
  const b = board.createBoard({ name: "D", workspacePath: "/tmp/w" });
  const card = board.createCard({
    boardId: b.id,
    type: "epic",
    title: "E",
    column: "design",
    description: "",
  });
  const session = sessions.createSession({
    boardId: b.id,
    cardId: card.id,
  });
  return {
    hub: new WsHub(sessions),
    sessions,
    boardId: b.id,
    cardId: card.id,
    sessionId: session.id,
  };
}

describe("WsHub", () => {
  it("broadcasts only to matching board and role", () => {
    const { hub, boardId } = tempHub();
    const worker = createMockWs();
    const ui = createMockWs();
    const otherBoardUi = createMockWs();

    hub.subscribe(worker, { role: "worker", boardId });
    hub.subscribe(ui, { role: "ui", boardId });
    hub.subscribe(otherBoardUi, { role: "ui", boardId: "other-board" });

    hub.broadcast(boardId, "ui", {
      type: "session.agent_delta",
      sessionId: "s1",
      text: "chunk",
    });

    expect(ui.sent).toHaveLength(1);
    expect(worker.sent).toHaveLength(0);
    expect(otherBoardUi.sent).toHaveLength(0);
    expect(JSON.parse(ui.sent[0]!).text).toBe("chunk");
  });

  it("persists user messages and fans out to workers", () => {
    const { hub, sessions, boardId, sessionId } = tempHub();
    const worker = createMockWs();
    hub.subscribe(worker, { role: "worker", boardId });

    hub.handleMessage(
      createMockWs(),
      JSON.stringify({
        type: "session.user_message",
        sessionId,
        text: "align on theme",
      }),
    );

    const messages = sessions.listMessages(sessionId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.body).toBe("align on theme");
    expect(worker.sent).toHaveLength(1);
    const payload = JSON.parse(worker.sent[0]!);
    expect(payload.type).toBe("session.user_message");
    expect(payload.text).toBe("align on theme");
  });

  it("unsubscribes on close", () => {
    const { hub, boardId } = tempHub();
    const ui = createMockWs();
    hub.subscribe(ui, { role: "ui", boardId });
    hub.unsubscribe(ui);

    hub.broadcast(boardId, "ui", {
      type: "session.agent_done",
      sessionId: "s1",
      summary: "done",
    });
    expect(ui.sent).toHaveLength(0);
  });
});
