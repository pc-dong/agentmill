import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDb } from "./db.js";
import { BoardRepo } from "./repo.js";
import { SessionRepo } from "./sessions.js";

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

function tempRepos(): { board: BoardRepo; sessions: SessionRepo } {
  const file = path.join(
    os.tmpdir(),
    `aiw-sessions-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  tmpFiles.push(file);
  const db = openDb(file);
  migrate(db);
  return { board: new BoardRepo(db), sessions: new SessionRepo(db) };
}

describe("SessionRepo", () => {
  it("creates an open session and retrieves it by card", () => {
    const { board, sessions } = tempRepos();
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
      employeeRole: "design",
    });
    expect(session.status).toBe("open");
    expect(session.boardId).toBe(b.id);
    expect(session.cardId).toBe(card.id);
    expect(session.employeeRole).toBe("design");

    const open = sessions.getOpenSessionForCard(card.id);
    expect(open?.id).toBe(session.id);
  });

  it("appends messages and lists them in order", () => {
    const { board, sessions } = tempRepos();
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

    sessions.appendMessage({
      sessionId: session.id,
      role: "user",
      body: "hello",
    });
    sessions.appendMessage({
      sessionId: session.id,
      role: "assistant",
      body: "hi there",
    });

    const messages = sessions.listMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.body).toBe("hello");
    expect(messages[1]?.role).toBe("assistant");
  });

  it("closeSession clears open lookup and listOpenSessionCardIds", () => {
    const { board, sessions } = tempRepos();
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

    expect(sessions.listOpenSessionCardIds(b.id)).toEqual([card.id]);

    const closed = sessions.closeSession(session.id);
    expect(closed?.status).toBe("closed");
    expect(sessions.getOpenSessionForCard(card.id)).toBeNull();
    expect(sessions.listOpenSessionCardIds(b.id)).toEqual([]);
  });

  it("defaults employeeRole to design", () => {
    const { board, sessions } = tempRepos();
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
    expect(session.employeeRole).toBe("design");
  });
});
