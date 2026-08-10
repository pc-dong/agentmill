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

  getLatestSessionForCard(
    cardId: string,
    employeeRole?: string,
  ): SessionRecord | null {
    const row = employeeRole
      ? (this.db
          .prepare(
            `SELECT id, board_id as boardId, card_id as cardId,
                    employee_role as employeeRole, status,
                    created_at as createdAt, updated_at as updatedAt
             FROM sessions
             WHERE card_id = ? AND employee_role = ?
             ORDER BY updated_at DESC
             LIMIT 1`,
          )
          .get(cardId, employeeRole) as SessionRow | undefined)
      : (this.db
          .prepare(
            `SELECT id, board_id as boardId, card_id as cardId,
                    employee_role as employeeRole, status,
                    created_at as createdAt, updated_at as updatedAt
             FROM sessions
             WHERE card_id = ?
             ORDER BY updated_at DESC
             LIMIT 1`,
          )
          .get(cardId) as SessionRow | undefined);
    return row ?? null;
  }

  /**
   * Prefer the newest session that still has chat messages.
   * Avoids an empty "new round" session hiding prior clarification history.
   */
  getLatestSessionWithMessages(
    cardId: string,
    employeeRole?: string,
  ): SessionRecord | null {
    const rows = employeeRole
      ? (this.db
          .prepare(
            `SELECT s.id, s.board_id as boardId, s.card_id as cardId,
                    s.employee_role as employeeRole, s.status,
                    s.created_at as createdAt, s.updated_at as updatedAt
             FROM sessions s
             WHERE s.card_id = ? AND s.employee_role = ?
               AND EXISTS (
                 SELECT 1 FROM session_messages m WHERE m.session_id = s.id
               )
             ORDER BY s.updated_at DESC
             LIMIT 1`,
          )
          .all(cardId, employeeRole) as SessionRow[])
      : (this.db
          .prepare(
            `SELECT s.id, s.board_id as boardId, s.card_id as cardId,
                    s.employee_role as employeeRole, s.status,
                    s.created_at as createdAt, s.updated_at as updatedAt
             FROM sessions s
             WHERE s.card_id = ?
               AND EXISTS (
                 SELECT 1 FROM session_messages m WHERE m.session_id = s.id
               )
             ORDER BY s.updated_at DESC
             LIMIT 1`,
          )
          .all(cardId) as SessionRow[]);
    return rows[0] ?? null;
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

  /**
   * Update the last user message body and delete all messages after it
   * (typically the trailing assistant reply). Returns the remaining messages.
   */
  editLastUserMessage(
    sessionId: string,
    body: string,
  ): SessionMessageRecord[] | null {
    const messages = this.listMessages(sessionId);
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return null;

    const lastUser = messages[lastUserIdx]!;
    const toDelete = messages.slice(lastUserIdx + 1).map((m) => m.id);
    if (toDelete.length > 0) {
      const placeholders = toDelete.map(() => "?").join(",");
      this.db
        .prepare(
          `DELETE FROM session_messages WHERE id IN (${placeholders})`,
        )
        .run(...toDelete);
    }
    this.db
      .prepare(`UPDATE session_messages SET body = ? WHERE id = ?`)
      .run(body, lastUser.id);
    this.db
      .prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), sessionId);

    return this.listMessages(sessionId);
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

  /** Re-open a closed session when the card has no other open session. */
  reopenSession(sessionId: string): SessionRecord | null {
    const session = this.getSession(sessionId);
    if (!session || session.status !== "closed") return null;
    if (this.getOpenSessionForCard(session.cardId)) return null;
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE sessions SET status = 'open', updated_at = ?
         WHERE id = ? AND status = 'closed'`,
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
