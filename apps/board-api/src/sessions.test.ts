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

  it("editLastUserMessage updates body and truncates following messages", () => {
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
      body: "first",
    });
    sessions.appendMessage({
      sessionId: session.id,
      role: "assistant",
      body: "reply1",
    });
    sessions.appendMessage({
      sessionId: session.id,
      role: "user",
      body: "second",
    });
    sessions.appendMessage({
      sessionId: session.id,
      role: "assistant",
      body: "reply2",
    });

    const remaining = sessions.editLastUserMessage(session.id, "second edited");
    expect(remaining).toHaveLength(3);
    expect(remaining?.[2]?.role).toBe("user");
    expect(remaining?.[2]?.body).toBe("second edited");
    expect(sessions.listMessages(session.id)).toHaveLength(3);
  });

  it("reopenSession reopens a closed session", () => {
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
    sessions.closeSession(session.id);
    expect(sessions.getOpenSessionForCard(card.id)).toBeNull();

    const reopened = sessions.reopenSession(session.id);
    expect(reopened?.status).toBe("open");
    expect(sessions.getOpenSessionForCard(card.id)?.id).toBe(session.id);
  });
});
