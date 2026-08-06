import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ArtifactRef, CardType, ColumnId } from "@ai-workforce/domain";

export type Board = {
  id: string;
  name: string;
  workspacePath: string;
  createdAt: string;
};

export type CardRecord = {
  id: string;
  boardId: string;
  type: CardType;
  title: string;
  description: string;
  column: ColumnId;
  epicId: string | null;
  reworkCount: number;
  frozen: boolean;
  artifacts: ArtifactRef[];
  createdAt: string;
  updatedAt: string;
};

export type CommentRecord = {
  id: string;
  cardId: string;
  author: string;
  body: string;
  createdAt: string;
};

const DEFAULT_EMPLOYEES: Array<{
  role: string;
  displayName: string;
  watchColumns: ColumnId[];
}> = [
  { role: "design", displayName: "Design Bot", watchColumns: ["design"] },
  { role: "split", displayName: "Split Bot", watchColumns: ["split"] },
  { role: "verify", displayName: "Verify Bot", watchColumns: ["verify"] },
  { role: "dev", displayName: "Dev Bot", watchColumns: ["dev"] },
  { role: "test", displayName: "Test Bot", watchColumns: ["test"] },
  { role: "review", displayName: "Review Bot", watchColumns: ["accept"] },
];

export class BoardRepo {
  constructor(private readonly db: Database.Database) {}

  createBoard(input: { name: string; workspacePath: string }): Board {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO boards (id, name, workspace_path, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, input.name, input.workspacePath, createdAt);

    const insertEmp = this.db.prepare(
      `INSERT INTO employees (id, board_id, role, display_name, watch_columns_json, adapter)
       VALUES (?, ?, ?, ?, ?, 'cursor')`,
    );
    for (const emp of DEFAULT_EMPLOYEES) {
      insertEmp.run(
        randomUUID(),
        id,
        emp.role,
        emp.displayName,
        JSON.stringify(emp.watchColumns),
      );
    }

    return {
      id,
      name: input.name,
      workspacePath: input.workspacePath,
      createdAt,
    };
  }

  getBoard(id: string): Board | null {
    const row = this.db
      .prepare(
        `SELECT id, name, workspace_path as workspacePath, created_at as createdAt
         FROM boards WHERE id = ?`,
      )
      .get(id) as Board | undefined;
    return row ?? null;
  }

  createCard(input: {
    boardId: string;
    type: CardType;
    title: string;
    description: string;
    column: ColumnId;
    epicId?: string | null;
  }): CardRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO cards (
           id, board_id, type, title, description, column_id, epic_id,
           rework_count, frozen, artifacts_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, '[]', ?, ?)`,
      )
      .run(
        id,
        input.boardId,
        input.type,
        input.title,
        input.description,
        input.column,
        input.epicId ?? null,
        now,
        now,
      );
    return this.getCard(id)!;
  }

  getCard(id: string): CardRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, board_id as boardId, type, title, description,
                column_id as columnId, epic_id as epicId,
                rework_count as reworkCount, frozen, artifacts_json as artifactsJson,
                created_at as createdAt, updated_at as updatedAt
         FROM cards WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          boardId: string;
          type: CardType;
          title: string;
          description: string;
          columnId: ColumnId;
          epicId: string | null;
          reworkCount: number;
          frozen: number;
          artifactsJson: string;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      boardId: row.boardId,
      type: row.type,
      title: row.title,
      description: row.description,
      column: row.columnId,
      epicId: row.epicId,
      reworkCount: row.reworkCount,
      frozen: !!row.frozen,
      artifacts: JSON.parse(row.artifactsJson) as ArtifactRef[],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  listCards(boardId: string): CardRecord[] {
    const rows = this.db
      .prepare(`SELECT id FROM cards WHERE board_id = ? ORDER BY created_at`)
      .all(boardId) as Array<{ id: string }>;
    return rows.map((r) => this.getCard(r.id)!);
  }

  updateCard(
    id: string,
    patch: Partial<{
      title: string;
      description: string;
      column: ColumnId;
      epicId: string | null;
      reworkCount: number;
      frozen: boolean;
      artifacts: ArtifactRef[];
    }>,
  ): CardRecord {
    const current = this.getCard(id);
    if (!current) throw new Error(`Card not found: ${id}`);
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `UPDATE cards SET title=?, description=?, column_id=?, epic_id=?,
         rework_count=?, frozen=?, artifacts_json=?, updated_at=? WHERE id=?`,
      )
      .run(
        next.title,
        next.description,
        next.column,
        next.epicId,
        next.reworkCount,
        next.frozen ? 1 : 0,
        JSON.stringify(next.artifacts),
        next.updatedAt,
        id,
      );
    return this.getCard(id)!;
  }

  addComment(input: {
    cardId: string;
    author: string;
    body: string;
  }): CommentRecord {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO comments (id, card_id, author, body, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.cardId, input.author, input.body, createdAt);
    return { id, cardId: input.cardId, author: input.author, body: input.body, createdAt };
  }

  listComments(cardId: string): CommentRecord[] {
    return this.db
      .prepare(
        `SELECT id, card_id as cardId, author, body, created_at as createdAt
         FROM comments WHERE card_id = ? ORDER BY created_at`,
      )
      .all(cardId) as CommentRecord[];
  }

  listEmployees(boardId: string): Array<{
    id: string;
    boardId: string;
    role: string;
    displayName: string;
    watchColumns: ColumnId[];
    adapter: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, board_id as boardId, role, display_name as displayName,
                watch_columns_json as watchColumnsJson, adapter
         FROM employees WHERE board_id = ?`,
      )
      .all(boardId) as Array<{
      id: string;
      boardId: string;
      role: string;
      displayName: string;
      watchColumnsJson: string;
      adapter: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      boardId: r.boardId,
      role: r.role,
      displayName: r.displayName,
      watchColumns: JSON.parse(r.watchColumnsJson) as ColumnId[],
      adapter: r.adapter,
    }));
  }

  createJob(input: {
    boardId: string;
    cardId: string;
    employeeId: string;
    trigger: "mention" | "poll";
  }): { id: string; status: string } {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO jobs (id, board_id, card_id, employee_id, status, trigger, created_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(
        id,
        input.boardId,
        input.cardId,
        input.employeeId,
        input.trigger,
        createdAt,
      );
    return { id, status: "open" };
  }

  listOpenJobs(boardId: string) {
    return this.db
      .prepare(
        `SELECT id, board_id as boardId, card_id as cardId, employee_id as employeeId,
                status, trigger, created_at as createdAt, claimed_at as claimedAt
         FROM jobs WHERE board_id = ? AND status = 'open' ORDER BY created_at`,
      )
      .all(boardId);
  }
}
