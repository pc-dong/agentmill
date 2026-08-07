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
  lockedJobId: string | null;
  lockedAt: string | null;
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

export type JobRecord = {
  id: string;
  boardId: string;
  cardId: string;
  employeeId: string;
  status: string;
  trigger: string;
  workerId: string | null;
  error: string | null;
  createdAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
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
                locked_job_id as lockedJobId, locked_at as lockedAt,
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
          lockedJobId: string | null;
          lockedAt: string | null;
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
      lockedJobId: row.lockedJobId || null,
      lockedAt: row.lockedAt || null,
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
  }): JobRecord {
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
    return this.getJob(id)!;
  }

  getJob(id: string): JobRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, board_id as boardId, card_id as cardId, employee_id as employeeId,
                status, trigger, worker_id as workerId, error,
                created_at as createdAt, claimed_at as claimedAt, finished_at as finishedAt
         FROM jobs WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          boardId: string;
          cardId: string;
          employeeId: string;
          status: string;
          trigger: string;
          workerId: string | null;
          error: string | null;
          createdAt: string;
          claimedAt: string | null;
          finishedAt: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      boardId: row.boardId,
      cardId: row.cardId,
      employeeId: row.employeeId,
      status: row.status,
      trigger: row.trigger,
      workerId: row.workerId ?? null,
      error: row.error ?? null,
      createdAt: row.createdAt,
      claimedAt: row.claimedAt ?? null,
      finishedAt: row.finishedAt ?? null,
    };
  }

  claimJob(jobId: string, workerId: string): JobRecord | null {
    const claim = this.db.transaction(() => {
      const job = this.db
        .prepare(`SELECT * FROM jobs WHERE id = ?`)
        .get(jobId) as
        | {
            id: string;
            status: string;
            card_id: string;
            board_id: string;
            employee_id: string;
          }
        | undefined;
      if (!job || job.status !== "open") return null;
      const card = this.getCard(job.card_id);
      if (!card || card.frozen || card.lockedJobId) return null;
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE jobs SET status='claimed', claimed_at=?, worker_id=? WHERE id=? AND status='open'`,
        )
        .run(now, workerId, jobId);
      this.db
        .prepare(
          `UPDATE cards SET locked_job_id=?, locked_at=?, updated_at=? WHERE id=?`,
        )
        .run(jobId, now, now, job.card_id);
      return this.getJob(jobId);
    });
    return claim();
  }

  completeJob(
    jobId: string,
    input: { summary: string; artifacts: ArtifactRef[] },
  ): JobRecord | null {
    const finish = this.db.transaction(() => {
      const job = this.getJob(jobId);
      if (!job || job.status !== "claimed") return null;
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE jobs SET status='done', finished_at=? WHERE id=? AND status='claimed'`,
        )
        .run(now, jobId);
      const card = this.getCard(job.cardId)!;
      const merged = [...card.artifacts, ...input.artifacts];
      this.db
        .prepare(
          `UPDATE cards SET locked_job_id=NULL, locked_at=NULL, artifacts_json=?, updated_at=? WHERE id=?`,
        )
        .run(JSON.stringify(merged), now, job.cardId);
      const emp = this.listEmployees(job.boardId).find(
        (e) => e.id === job.employeeId,
      );
      this.addComment({
        cardId: job.cardId,
        author: emp?.displayName ?? "bot",
        body: input.summary,
      });
      return this.getJob(jobId);
    });
    return finish();
  }

  failJob(jobId: string, message: string): JobRecord | null {
    const finish = this.db.transaction(() => {
      const job = this.getJob(jobId);
      if (!job || job.status !== "claimed") return null;
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE jobs SET status='failed', error=?, finished_at=? WHERE id=? AND status='claimed'`,
        )
        .run(message, now, jobId);
      this.db
        .prepare(
          `UPDATE cards SET locked_job_id=NULL, locked_at=NULL, updated_at=? WHERE id=?`,
        )
        .run(now, job.cardId);
      const emp = this.listEmployees(job.boardId).find(
        (e) => e.id === job.employeeId,
      );
      this.addComment({
        cardId: job.cardId,
        author: emp?.displayName ?? "bot",
        body: message,
      });
      return this.getJob(jobId);
    });
    return finish();
  }

  listClaimableJobs(boardId: string): JobRecord[] {
    const rows = this.db
      .prepare(
        `SELECT j.id FROM jobs j
         JOIN cards c ON c.id = j.card_id
         WHERE j.board_id = ? AND j.status = 'open'
           AND c.frozen = 0
           AND (c.locked_job_id IS NULL OR c.locked_job_id = '')
         ORDER BY j.created_at`,
      )
      .all(boardId) as Array<{ id: string }>;
    return rows.map((r) => this.getJob(r.id)!);
  }

  createPollJobs(boardId: string): number {
    let created = 0;
    const employees = this.listEmployees(boardId);
    for (const emp of employees) {
      for (const col of emp.watchColumns) {
        const cards = this.listCards(boardId).filter((c) => c.column === col);
        for (const card of cards) {
          if (card.frozen || card.lockedJobId) continue;
          const existing = this.db
            .prepare(
              `SELECT id FROM jobs
               WHERE card_id = ? AND employee_id = ?
                 AND status IN ('open', 'claimed')`,
            )
            .get(card.id, emp.id);
          if (existing) continue;
          this.createJob({
            boardId,
            cardId: card.id,
            employeeId: emp.id,
            trigger: "poll",
          });
          created++;
        }
      }
    }
    return created;
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
