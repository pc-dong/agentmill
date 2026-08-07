import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type SessionRecord = {
  id: string;
  boardId: string;
  cardId: string;
  employeeRole: string;
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
};

export type SessionMessageRecord = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  body: string;
  createdAt: string;
};

type SessionRow = {
  id: string;
  boardId: string;
  cardId: string;
  employeeRole: string;
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
};

export class SessionRepo {
  constructor(private readonly db: Database.Database) {}

  createSession(input: {
    boardId: string;
    cardId: string;
    employeeRole?: string;
  }): SessionRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const employeeRole = input.employeeRole ?? "design";
    this.db
      .prepare(
        `INSERT INTO sessions (
           id, board_id, card_id, employee_role, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(id, input.boardId, input.cardId, employeeRole, now, now);
    return this.getSession(id)!;
  }

  getOpenSessionForCard(cardId: string): SessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, board_id as boardId, card_id as cardId,
                employee_role as employeeRole, status,
                created_at as createdAt, updated_at as updatedAt
         FROM sessions
         WHERE card_id = ? AND status = 'open'
         LIMIT 1`,
      )
      .get(cardId) as SessionRow | undefined;
    return row ?? null;
  }

  appendMessage(input: {
    sessionId: string;
    role: "user" | "assistant" | "system";
    body: string;
  }): SessionMessageRecord {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO session_messages (id, session_id, role, body, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.sessionId, input.role, input.body, createdAt);
    return {
      id,
      sessionId: input.sessionId,
      role: input.role,
      body: input.body,
      createdAt,
    };
  }

  listMessages(sessionId: string): SessionMessageRecord[] {
    return this.db
      .prepare(
        `SELECT id, session_id as sessionId, role, body, created_at as createdAt
         FROM session_messages
         WHERE session_id = ?
         ORDER BY created_at`,
      )
      .all(sessionId) as SessionMessageRecord[];
  }

  closeSession(sessionId: string): SessionRecord | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE sessions SET status = 'closed', updated_at = ?
         WHERE id = ? AND status = 'open'`,
      )
      .run(now, sessionId);
    if (result.changes !== 1) return null;
    return this.getSession(sessionId);
  }

  listOpenSessionCardIds(boardId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT card_id as cardId FROM sessions
         WHERE board_id = ? AND status = 'open'`,
      )
      .all(boardId) as Array<{ cardId: string }>;
    return rows.map((r) => r.cardId);
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, board_id as boardId, card_id as cardId,
                employee_role as employeeRole, status,
                created_at as createdAt, updated_at as updatedAt
         FROM sessions WHERE id = ?`,
      )
      .get(id) as SessionRow | undefined;
    return row ?? null;
  }
}
