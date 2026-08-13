import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ArtifactRef, CardType, ColumnId, RequirementStatus } from "@ai-workforce/domain";
import { dedupeArtifacts } from "@ai-workforce/domain";
import {
  assertValidCron,
  cronFromIntervalHours,
  estimateIntervalHoursFromCron,
  nextCronRunAt,
} from "./cron.js";
import { SessionRepo } from "./sessions.js";

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
  /** Task cards created from a design round point back here. */
  designId: string | null;
  /** Requirement coarse status; null for non-requirement cards. */
  status: RequirementStatus | null;
  reworkCount: number;
  frozen: boolean;
  lockedJobId: string | null;
  lockedAt: string | null;
  /** Employee display name when a claimed job locks this card. */
  processingBy: string | null;
  /** Claimed locking job progress for board "Bot 处理中" UI. */
  activeJob?: {
    id: string;
    status: string;
    trigger: string;
    role: string;
    displayName: string;
    claimedAt: string | null;
    progress: string | null;
    progressAt: string | null;
  };
  /**
   * ISO time when the card last entered its current column.
   * Used so poll jobs re-fire after rework (leave + re-enter watch column).
   */
  columnEnteredAt: string;
  artifacts: ArtifactRef[];
  /** Populated for design cards when listing with links. */
  requirementIds?: string[];
  splitVerifiedAt: string | null;
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
  payload: string | null;
  workerId: string | null;
  error: string | null;
  progress: string | null;
  progressAt: string | null;
  createdAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
};

export type ScheduleConfig = {
  focusHint?: string;
  autoCreateTasks?: boolean;
  maxDefects?: number;
};

export type ScheduleRecord = {
  id: string;
  boardId: string;
  name: string;
  template: string;
  enabled: boolean;
  /** 5-field cron (minute hour dom month dow), local timezone. */
  cron: string;
  /** Legacy / display hint; derived from cron when possible. */
  intervalHours: number;
  nextRunAt: string;
  lastRunAt: string | null;
  config: ScheduleConfig;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleRunRecord = {
  id: string;
  scheduleId: string;
  boardId: string;
  runCardId: string | null;
  jobId: string | null;
  status: "queued" | "running" | "done" | "failed";
  trigger: "due" | "manual";
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  /** Joined for UI convenience. */
  runCardTitle?: string | null;
  scheduleName?: string | null;
};

export type JobTrigger =
  | "mention"
  | "poll"
  | "settle"
  | "deep_dive"
  | "schedule";

const JOB_PROGRESS_MAX = 500;
const CLAIM_PROGRESS = "已认领，准备执行";

function clipJobProgress(text: string): string {
  const t = text.trim();
  if (t.length <= JOB_PROGRESS_MAX) return t;
  return `${t.slice(0, JOB_PROGRESS_MAX - 1)}…`;
}

const DEFAULT_EMPLOYEES: Array<{
  role: string;
  displayName: string;
  watchColumns: ColumnId[];
}> = [
  { role: "design", displayName: "Design Bot", watchColumns: ["design"] },
  { role: "split", displayName: "Split Bot", watchColumns: [] },
  { role: "verify", displayName: "Verify Bot", watchColumns: [] },
  { role: "dev", displayName: "Dev Bot", watchColumns: ["dev"] },
  { role: "test", displayName: "Test Bot", watchColumns: ["test"] },
  { role: "review", displayName: "Review Bot", watchColumns: ["accept"] },
  { role: "ba", displayName: "BA Bot", watchColumns: ["requirements"] },
  { role: "scanner", displayName: "Scanner Bot", watchColumns: [] },
];

export class BoardRepo {
  constructor(private readonly db: Database.Database) {}

  private sessionRepo(): SessionRepo {
    return new SessionRepo(this.db);
  }

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
    designId?: string | null;
    status?: RequirementStatus | null;
    frozen?: boolean;
    artifacts?: ArtifactRef[];
  }): CardRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    const status =
      input.type === "requirement"
        ? (input.status ?? "open")
        : (input.status ?? null);
    this.db
      .prepare(
        `INSERT INTO cards (
           id, board_id, type, title, description, column_id, epic_id, design_id,
           rework_count, frozen, artifacts_json, status,
           column_entered_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.boardId,
        input.type,
        input.title,
        input.description,
        input.column,
        input.epicId ?? null,
        input.designId ?? null,
        input.frozen ? 1 : 0,
        JSON.stringify(dedupeArtifacts(input.artifacts ?? [])),
        status,
        now,
        now,
        now,
      );
    return this.getCard(id)!;
  }

  getCard(id: string): CardRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, board_id as boardId, type, title, description,
                column_id as columnId, epic_id as epicId, design_id as designId, status,
                rework_count as reworkCount, frozen, artifacts_json as artifactsJson,
                locked_job_id as lockedJobId, locked_at as lockedAt,
                split_verified_at as splitVerifiedAt,
                column_entered_at as columnEnteredAt,
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
          designId: string | null;
          status: string | null;
          reworkCount: number;
          frozen: number;
          artifactsJson: string;
          lockedJobId: string | null;
          lockedAt: string | null;
          splitVerifiedAt: string | null;
          columnEnteredAt: string | null;
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
      designId: row.designId ?? null,
      status:
        row.type === "requirement"
          ? ((row.status as RequirementStatus) || "open")
          : null,
      reworkCount: row.reworkCount,
      frozen: !!row.frozen,
      lockedJobId: row.lockedJobId || null,
      lockedAt: row.lockedAt || null,
      processingBy: this.resolveProcessingBy(row.lockedJobId || null),
      activeJob: this.resolveActiveJob(row.lockedJobId || null),
      columnEnteredAt: row.columnEnteredAt || row.createdAt,
      splitVerifiedAt: row.splitVerifiedAt ?? null,
      artifacts: dedupeArtifacts(
        JSON.parse(row.artifactsJson) as ArtifactRef[],
      ),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Who holds the claimed lock on this card (for board "Bot 处理中" badges). */
  private resolveProcessingBy(lockedJobId: string | null): string | null {
    if (!lockedJobId) return null;
    return this.resolveActiveJob(lockedJobId)?.displayName ?? "Bot";
  }

  private resolveActiveJob(
    lockedJobId: string | null,
  ): CardRecord["activeJob"] | undefined {
    if (!lockedJobId) return undefined;
    const row = this.db
      .prepare(
        `SELECT j.id as id, j.status as status, j.trigger as trigger,
                j.claimed_at as claimedAt, j.progress as progress,
                j.progress_at as progressAt,
                e.role as role, e.display_name as displayName
         FROM jobs j
         JOIN employees e ON e.id = j.employee_id
         WHERE j.id = ? AND j.status = 'claimed'`,
      )
      .get(lockedJobId) as
      | {
          id: string;
          status: string;
          trigger: string;
          claimedAt: string | null;
          progress: string | null;
          progressAt: string | null;
          role: string;
          displayName: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      status: row.status,
      trigger: row.trigger,
      role: row.role,
      displayName: row.displayName || "Bot",
      claimedAt: row.claimedAt ?? null,
      progress: row.progress ?? null,
      progressAt: row.progressAt ?? null,
    };
  }

  listCards(boardId: string): CardRecord[] {
    // Keep requirement.status aligned with linked design/task Done state.
    // Also repairs cards stuck at in_progress after delivery already finished.
    this.syncRequirementStatusesForBoard(boardId);
    const rows = this.db
      .prepare(`SELECT id FROM cards WHERE board_id = ? ORDER BY created_at`)
      .all(boardId) as Array<{ id: string }>;
    return rows.map((r) => {
      const card = this.getCard(r.id)!;
      if (card.type === "design") {
        card.requirementIds = this.listRequirementIdsForDesign(card.id);
      }
      return card;
    });
  }

  updateCard(
    id: string,
    patch: Partial<{
      title: string;
      description: string;
      column: ColumnId;
      epicId: string | null;
      designId: string | null;
      status: RequirementStatus | null;
      reworkCount: number;
      frozen: boolean;
      artifacts: ArtifactRef[];
    }>,
  ): CardRecord {
    const current = this.getCard(id);
    if (!current) throw new Error(`Card not found: ${id}`);
    const now = new Date().toISOString();
    const columnChanged =
      patch.column !== undefined && patch.column !== current.column;
    const next = {
      ...current,
      ...patch,
      artifacts:
        patch.artifacts !== undefined
          ? dedupeArtifacts(patch.artifacts)
          : current.artifacts,
      columnEnteredAt: columnChanged ? now : current.columnEnteredAt,
      updatedAt: now,
    };
    this.db
      .prepare(
        `UPDATE cards SET title=?, description=?, column_id=?, epic_id=?, design_id=?,
         rework_count=?, frozen=?, artifacts_json=?, status=?,
         column_entered_at=?, updated_at=? WHERE id=?`,
      )
      .run(
        next.title,
        next.description,
        next.column,
        next.epicId,
        next.designId,
        next.reworkCount,
        next.frozen ? 1 : 0,
        JSON.stringify(next.artifacts),
        next.type === "requirement" ? (next.status ?? "open") : null,
        next.columnEnteredAt,
        next.updatedAt,
        id,
      );
    return this.getCard(id)!;
  }

  linkDesignRequirements(designId: string, requirementIds: string[]): void {
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO design_requirements (design_id, requirement_id, created_at)
       VALUES (?, ?, ?)`,
    );
    const bump = this.db.prepare(
      `UPDATE cards SET status = 'in_progress', updated_at = ?
       WHERE id = ? AND type = 'requirement'
         AND (status IS NULL OR status = '' OR status = 'open')`,
    );
    const tx = this.db.transaction(() => {
      for (const rid of requirementIds) {
        insert.run(designId, rid, now);
        bump.run(now, rid);
      }
    });
    tx();
  }

  listRequirementIdsForDesign(designId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT requirement_id as id FROM design_requirements WHERE design_id = ?`,
      )
      .all(designId) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }


  listTasksForDesign(designId: string): CardRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM cards WHERE design_id = ? AND type = 'task' ORDER BY created_at`,
      )
      .all(designId) as Array<{ id: string }>;
    return rows.map((r) => this.getCard(r.id)!);
  }

  markDesignSplitVerified(designId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE cards SET split_verified_at = ?, updated_at = ? WHERE id = ? AND type = 'design'`,
      )
      .run(now, now, designId);
  }

  markDesignSplitDirty(designId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE cards SET split_verified_at = NULL, updated_at = ? WHERE id = ? AND type = 'design'`,
      )
      .run(now, designId);
    this.db
      .prepare(
        `UPDATE cards SET frozen = 1, updated_at = ?
         WHERE design_id = ? AND type = 'task' AND column_id = 'design'`,
      )
      .run(now, designId);
  }

  designTasksAllDone(designId: string): boolean {
    const tasks = this.listTasksForDesign(designId);
    if (tasks.length === 0) return false;
    return tasks.every((t) => t.column === "done");
  }

  /** Design card is Done and every linked task (if any) is Done. */
  isDesignDeliveryComplete(designId: string): boolean {
    const design = this.getCard(designId);
    if (!design || design.type !== "design" || design.column !== "done") {
      return false;
    }
    return this.listTasksForDesign(designId).every((t) => t.column === "done");
  }

  /**
   * When all linked design rounds (and their tasks) are Done, mark the
   * requirement status done; if work reopens, revert done → in_progress.
   */
  syncRequirementStatus(requirementId: string): CardRecord | null {
    const req = this.getCard(requirementId);
    if (!req || req.type !== "requirement") return null;
    const designIds = this.listDesignIdsForRequirement(requirementId);
    if (designIds.length === 0) return req;

    const allComplete = designIds.every((id) =>
      this.isDesignDeliveryComplete(id),
    );
    if (allComplete) {
      if (req.status !== "done") {
        return this.updateCard(requirementId, { status: "done" });
      }
      return req;
    }
    if (req.status === "done") {
      return this.updateCard(requirementId, { status: "in_progress" });
    }
    return req;
  }

  /** After a design/task column change, refresh linked requirement statuses. */
  syncRequirementStatusesForCard(card: {
    type: string;
    id: string;
    designId?: string | null;
  }): void {
    if (card.type === "design") {
      for (const rid of this.listRequirementIdsForDesign(card.id)) {
        this.syncRequirementStatus(rid);
      }
      return;
    }
    if (card.type === "task" && card.designId) {
      for (const rid of this.listRequirementIdsForDesign(card.designId)) {
        this.syncRequirementStatus(rid);
      }
    }
  }

  /** Reconcile all requirement statuses on a board (also repairs stuck cards). */
  syncRequirementStatusesForBoard(boardId: string): void {
    const rows = this.db
      .prepare(
        `SELECT id FROM cards WHERE board_id = ? AND type = 'requirement'`,
      )
      .all(boardId) as Array<{ id: string }>;
    for (const row of rows) {
      this.syncRequirementStatus(row.id);
    }
  }

  listDesignIdsForRequirement(requirementId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT design_id as id FROM design_requirements WHERE requirement_id = ?`,
      )
      .all(requirementId) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  createDesignRound(input: {
    boardId: string;
    epicId: string;
    title: string;
    requirementIds: string[];
    description?: string;
  }): CardRecord {
    const design = this.createCard({
      boardId: input.boardId,
      type: "design",
      title: input.title,
      description: input.description ?? "",
      column: "design",
      epicId: input.epicId,
    });
    this.linkDesignRequirements(design.id, input.requirementIds);
    const out = this.getCard(design.id)!;
    out.requirementIds = this.listRequirementIdsForDesign(design.id);
    return out;
  }

  deleteCard(id: string): boolean {
    const card = this.getCard(id);
    if (!card) return false;

    const run = this.db.transaction(() => {
      // Unlink requirements/tasks that pointed at this epic; clear design links.
      if (card.type === "epic") {
        this.db
          .prepare(`UPDATE cards SET epic_id = NULL, updated_at = ? WHERE epic_id = ?`)
          .run(new Date().toISOString(), id);
      }
      this.db
        .prepare(
          `DELETE FROM design_requirements WHERE design_id = ? OR requirement_id = ?`,
        )
        .run(id, id);

      const sessionIds = (
        this.db
          .prepare(`SELECT id FROM sessions WHERE card_id = ?`)
          .all(id) as Array<{ id: string }>
      ).map((r) => r.id);
      for (const sid of sessionIds) {
        this.db
          .prepare(`DELETE FROM session_messages WHERE session_id = ?`)
          .run(sid);
      }
      this.db.prepare(`DELETE FROM sessions WHERE card_id = ?`).run(id);

      // Clear lock references if any other card somehow pointed here (n/a).
      const result = this.db.prepare(`DELETE FROM cards WHERE id = ?`).run(id);
      return result.changes === 1;
    });

    return run();
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
    trigger: JobTrigger;
    payload?: string | null;
  }): JobRecord {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO jobs (id, board_id, card_id, employee_id, status, trigger, payload, created_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`,
      )
      .run(
        id,
        input.boardId,
        input.cardId,
        input.employeeId,
        input.trigger,
        input.payload ?? null,
        createdAt,
      );
    return this.getJob(id)!;
  }

  getJob(id: string): JobRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, board_id as boardId, card_id as cardId, employee_id as employeeId,
                status, trigger, payload, worker_id as workerId, error,
                progress, progress_at as progressAt,
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
          payload: string | null;
          workerId: string | null;
          error: string | null;
          progress: string | null;
          progressAt: string | null;
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
      payload: row.payload ?? null,
      workerId: row.workerId ?? null,
      error: row.error ?? null,
      progress: row.progress ?? null,
      progressAt: row.progressAt ?? null,
      createdAt: row.createdAt,
      claimedAt: row.claimedAt ?? null,
      finishedAt: row.finishedAt ?? null,
    };
  }

  setJobProgress(jobId: string, text: string): JobRecord | null {
    const job = this.getJob(jobId);
    if (!job || job.status !== "claimed") return null;
    const now = new Date().toISOString();
    const progress = clipJobProgress(text);
    const result = this.db
      .prepare(
        `UPDATE jobs SET progress=?, progress_at=? WHERE id=? AND status='claimed'`,
      )
      .run(progress, now, jobId);
    if (result.changes !== 1) return null;
    return this.getJob(jobId);
  }

  findEpicCardByEpicId(boardId: string, epicKey: string): CardRecord | null {
    const epics = this.listCards(boardId).filter((c) => c.type === "epic");
    const prefix = `epic_id: ${epicKey}`;
    const byDesc = epics.find(
      (c) =>
        c.description === prefix ||
        c.description.startsWith(`${prefix}\n`) ||
        c.description.startsWith(`${prefix}\r\n`),
    );
    if (byDesc) return byDesc;
    const needle = `/${epicKey}-`;
    return (
      epics.find((c) => c.artifacts.some((a) => a.href.includes(needle))) ??
      null
    );
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
      const openSession = this.sessionRepo().getOpenSessionForCard(job.card_id);
      if (openSession) {
        const full = this.getJob(jobId);
        if (
          !full ||
          (full.trigger !== "settle" && full.trigger !== "deep_dive")
        ) {
          return null;
        }
      }
      const now = new Date().toISOString();
      const updateResult = this.db
        .prepare(
          `UPDATE jobs SET status='claimed', claimed_at=?, worker_id=?, progress=?, progress_at=?
           WHERE id=? AND status='open'`,
        )
        .run(now, workerId, CLAIM_PROGRESS, now, jobId);
      if (updateResult.changes !== 1) return null;
      this.db
        .prepare(
          `UPDATE cards SET locked_job_id=?, locked_at=?, updated_at=? WHERE id=?`,
        )
        .run(jobId, now, now, job.card_id);
      this.updateScheduleRunByJobId(jobId, { status: "running" });
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
      const merged = dedupeArtifacts([...card.artifacts, ...input.artifacts]);
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
      this.updateScheduleRunByJobId(jobId, { status: "done" });
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
      this.updateScheduleRunByJobId(jobId, { status: "failed", error: message });
      // Schedule failure: retry on next cron tick after 1h (or sooner if cron fires earlier).
      if (job.trigger === "schedule" && job.payload) {
        try {
          const parsed = JSON.parse(job.payload) as { scheduleId?: string };
          if (parsed.scheduleId) {
            const sched = this.getSchedule(parsed.scheduleId);
            if (sched) {
              const retryFloor = new Date(Date.now() + 3600_000).toISOString();
              let next: string;
              try {
                next = nextCronRunAt(sched.cron, new Date());
              } catch {
                next = retryFloor;
              }
              if (next < retryFloor) next = retryFloor;
              this.updateSchedule(parsed.scheduleId, { nextRunAt: next });
            }
          }
        } catch {
          /* ignore */
        }
      }
      return this.getJob(jobId);
    });
    return finish();
  }

  listClaimableJobs(boardId: string): JobRecord[] {
    const openSessionCardIds = new Set(
      this.sessionRepo().listOpenSessionCardIds(boardId),
    );
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
    return rows
      .map((r) => this.getJob(r.id)!)
      .filter((job) => {
        if (!openSessionCardIds.has(job.cardId)) return true;
        // settle / deep_dive may still run while UI closes the session
        return job.trigger === "settle" || job.trigger === "deep_dive";
      });
  }

  createPollJobs(boardId: string): number {
    let created = 0;
    const openSessionCardIds = new Set(
      this.sessionRepo().listOpenSessionCardIds(boardId),
    );
    const employees = this.listEmployees(boardId);
    const designFlowRoles = new Set(["design", "split", "verify"]);
    for (const emp of employees) {
      for (const col of emp.watchColumns) {
        const cards = this.listCards(boardId).filter((c) => c.column === col);
        for (const card of cards) {
          if (card.frozen || card.lockedJobId || openSessionCardIds.has(card.id))
            continue;
          if (designFlowRoles.has(emp.role) && card.type !== "design") continue;
          if (emp.role === "ba" && card.type !== "requirement") continue;
          // Block only: in-flight jobs, or a job already created for this
          // column visit (created_at >= columnEnteredAt). Finished jobs from
          // an earlier visit do not block — enables rework re-poll.
          const blocking = this.db
            .prepare(
              `SELECT id FROM jobs
               WHERE card_id = ? AND employee_id = ?
                 AND (
                   status IN ('open', 'claimed')
                   OR created_at >= ?
                 )
               LIMIT 1`,
            )
            .get(card.id, emp.id, card.columnEnteredAt);
          if (blocking) continue;
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

  ensureScannerEmployee(boardId: string): {
    id: string;
    boardId: string;
    role: string;
    displayName: string;
    watchColumns: ColumnId[];
    adapter: string;
  } {
    const existing = this.listEmployees(boardId).find((e) => e.role === "scanner");
    if (existing) return existing;
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO employees (id, board_id, role, display_name, watch_columns_json, adapter)
         VALUES (?, ?, 'scanner', 'Scanner Bot', '[]', 'cursor')`,
      )
      .run(id, boardId);
    return this.listEmployees(boardId).find((e) => e.id === id)!;
  }

  private mapScheduleRow(row: {
    id: string;
    boardId: string;
    name: string;
    template: string;
    enabled: number;
    cron: string | null;
    intervalHours: number;
    nextRunAt: string;
    lastRunAt: string | null;
    configJson: string;
    createdAt: string;
    updatedAt: string;
  }): ScheduleRecord {
    let config: ScheduleConfig = {};
    try {
      config = JSON.parse(row.configJson || "{}") as ScheduleConfig;
    } catch {
      config = {};
    }
    const cron =
      (row.cron && row.cron.trim()) ||
      cronFromIntervalHours(row.intervalHours || 24);
    return {
      id: row.id,
      boardId: row.boardId,
      name: row.name,
      template: row.template,
      enabled: row.enabled === 1,
      cron,
      intervalHours: row.intervalHours || estimateIntervalHoursFromCron(cron),
      nextRunAt: row.nextRunAt,
      lastRunAt: row.lastRunAt ?? null,
      config: {
        focusHint: config.focusHint ?? "",
        autoCreateTasks: config.autoCreateTasks !== false,
        maxDefects:
          typeof config.maxDefects === "number" && config.maxDefects > 0
            ? Math.min(50, Math.floor(config.maxDefects))
            : 10,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private scheduleSelectSql(): string {
    return `SELECT id, board_id as boardId, name, template, enabled,
                cron, interval_hours as intervalHours, next_run_at as nextRunAt,
                last_run_at as lastRunAt, config_json as configJson,
                created_at as createdAt, updated_at as updatedAt
         FROM schedules`;
  }

  getSchedule(id: string): ScheduleRecord | null {
    const row = this.db
      .prepare(`${this.scheduleSelectSql()} WHERE id = ?`)
      .get(id) as
      | {
          id: string;
          boardId: string;
          name: string;
          template: string;
          enabled: number;
          cron: string | null;
          intervalHours: number;
          nextRunAt: string;
          lastRunAt: string | null;
          configJson: string;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;
    return row ? this.mapScheduleRow(row) : null;
  }

  listSchedules(boardId: string): ScheduleRecord[] {
    const rows = this.db
      .prepare(`${this.scheduleSelectSql()} WHERE board_id = ? ORDER BY created_at`)
      .all(boardId) as Array<{
      id: string;
      boardId: string;
      name: string;
      template: string;
      enabled: number;
      cron: string | null;
      intervalHours: number;
      nextRunAt: string;
      lastRunAt: string | null;
      configJson: string;
      createdAt: string;
      updatedAt: string;
    }>;
    return rows.map((r) => this.mapScheduleRow(r));
  }

  createSchedule(input: {
    boardId: string;
    name: string;
    template?: string;
    enabled?: boolean;
    cron?: string;
    intervalHours?: number;
    nextRunAt?: string;
    config?: ScheduleConfig;
  }): ScheduleRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const cron = assertValidCron(
      input.cron?.trim() ||
        cronFromIntervalHours(input.intervalHours ?? 24),
    );
    const intervalHours =
      input.intervalHours ?? estimateIntervalHoursFromCron(cron);
    const nextRunAt = input.nextRunAt ?? nextCronRunAt(cron, now);
    this.db
      .prepare(
        `INSERT INTO schedules (
           id, board_id, name, template, enabled, cron, interval_hours,
           next_run_at, last_run_at, config_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        input.boardId,
        input.name,
        input.template ?? "code_scan",
        input.enabled === false ? 0 : 1,
        cron,
        Math.max(1, intervalHours),
        nextRunAt,
        JSON.stringify(input.config ?? {}),
        now,
        now,
      );
    return this.getSchedule(id)!;
  }

  updateSchedule(
    id: string,
    patch: Partial<{
      name: string;
      enabled: boolean;
      cron: string;
      intervalHours: number;
      nextRunAt: string;
      lastRunAt: string | null;
      config: ScheduleConfig;
    }>,
  ): ScheduleRecord | null {
    const cur = this.getSchedule(id);
    if (!cur) return null;
    const now = new Date().toISOString();
    const name = patch.name ?? cur.name;
    const enabled = patch.enabled ?? cur.enabled;
    let cron = cur.cron;
    let intervalHours = cur.intervalHours;
    let nextRunAt = patch.nextRunAt ?? cur.nextRunAt;
    if (patch.cron !== undefined) {
      cron = assertValidCron(patch.cron);
      intervalHours = estimateIntervalHoursFromCron(cron);
      if (patch.nextRunAt === undefined) {
        nextRunAt = nextCronRunAt(cron, now);
      }
    } else if (patch.intervalHours !== undefined) {
      intervalHours = Math.max(1, patch.intervalHours);
      cron = cronFromIntervalHours(intervalHours);
      if (patch.nextRunAt === undefined) {
        nextRunAt = nextCronRunAt(cron, now);
      }
    }
    const lastRunAt =
      patch.lastRunAt !== undefined ? patch.lastRunAt : cur.lastRunAt;
    const config = patch.config ?? cur.config;
    this.db
      .prepare(
        `UPDATE schedules SET name=?, enabled=?, cron=?, interval_hours=?, next_run_at=?,
         last_run_at=?, config_json=?, updated_at=? WHERE id=?`,
      )
      .run(
        name,
        enabled ? 1 : 0,
        cron,
        Math.max(1, intervalHours),
        nextRunAt,
        lastRunAt,
        JSON.stringify(config),
        now,
        id,
      );
    return this.getSchedule(id);
  }

  deleteSchedule(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM schedules WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  getScheduleRun(id: string): ScheduleRunRecord | null {
    const row = this.db
      .prepare(
        `SELECT r.id, r.schedule_id as scheduleId, r.board_id as boardId,
                r.run_card_id as runCardId, r.job_id as jobId, r.status,
                r.trigger, r.error, r.started_at as startedAt,
                r.finished_at as finishedAt, r.created_at as createdAt,
                c.title as runCardTitle, s.name as scheduleName
         FROM schedule_runs r
         LEFT JOIN cards c ON c.id = r.run_card_id
         LEFT JOIN schedules s ON s.id = r.schedule_id
         WHERE r.id = ?`,
      )
      .get(id) as ScheduleRunRecord | undefined;
    return row ?? null;
  }

  listScheduleRuns(
    boardId: string,
    opts?: { scheduleId?: string; limit?: number },
  ): ScheduleRunRecord[] {
    const limit = Math.min(200, Math.max(1, opts?.limit ?? 50));
    if (opts?.scheduleId) {
      return this.db
        .prepare(
          `SELECT r.id, r.schedule_id as scheduleId, r.board_id as boardId,
                  r.run_card_id as runCardId, r.job_id as jobId, r.status,
                  r.trigger, r.error, r.started_at as startedAt,
                  r.finished_at as finishedAt, r.created_at as createdAt,
                  c.title as runCardTitle, s.name as scheduleName
           FROM schedule_runs r
           LEFT JOIN cards c ON c.id = r.run_card_id
           LEFT JOIN schedules s ON s.id = r.schedule_id
           WHERE r.board_id = ? AND r.schedule_id = ?
           ORDER BY r.started_at DESC
           LIMIT ?`,
        )
        .all(boardId, opts.scheduleId, limit) as ScheduleRunRecord[];
    }
    return this.db
      .prepare(
        `SELECT r.id, r.schedule_id as scheduleId, r.board_id as boardId,
                r.run_card_id as runCardId, r.job_id as jobId, r.status,
                r.trigger, r.error, r.started_at as startedAt,
                r.finished_at as finishedAt, r.created_at as createdAt,
                c.title as runCardTitle, s.name as scheduleName
         FROM schedule_runs r
         LEFT JOIN cards c ON c.id = r.run_card_id
         LEFT JOIN schedules s ON s.id = r.schedule_id
         WHERE r.board_id = ?
         ORDER BY r.started_at DESC
         LIMIT ?`,
      )
      .all(boardId, limit) as ScheduleRunRecord[];
  }

  updateScheduleRunByJobId(
    jobId: string,
    patch: { status: "running" | "done" | "failed"; error?: string | null },
  ): void {
    const now = new Date().toISOString();
    if (patch.status === "running") {
      this.db
        .prepare(
          `UPDATE schedule_runs SET status='running' WHERE job_id=? AND status='queued'`,
        )
        .run(jobId);
      return;
    }
    this.db
      .prepare(
        `UPDATE schedule_runs SET status=?, error=?, finished_at=?
         WHERE job_id=? AND status IN ('queued','running')`,
      )
      .run(patch.status, patch.error ?? null, now, jobId);
  }

  /**
   * Create a scan-run design card + schedule job for Scanner Bot.
   * Advances next_run_at / last_run_at.
   */
  enqueueScheduleRun(
    scheduleId: string,
    opts?: { force?: boolean; nowIso?: string; trigger?: "due" | "manual" },
  ): {
    schedule: ScheduleRecord;
    runCard: CardRecord;
    job: JobRecord;
    run: ScheduleRunRecord;
  } | null {
    const schedule = this.getSchedule(scheduleId);
    if (!schedule) return null;
    if (!opts?.force && !schedule.enabled) return null;

    const now = opts?.nowIso ?? new Date().toISOString();
    const trigger = opts?.trigger ?? "due";
    const scanner = this.ensureScannerEmployee(schedule.boardId);
    const stamp = now.slice(0, 16).replace("T", " ");
    const runCard = this.createCard({
      boardId: schedule.boardId,
      type: "design",
      title: `${schedule.name} · ${stamp}`,
      description: [
        `schedule_id: ${schedule.id}`,
        `template: ${schedule.template}`,
        `cron: ${schedule.cron}`,
        schedule.config.focusHint
          ? `focus: ${schedule.config.focusHint}`
          : "",
        "",
        "定时代码扫描运行卡。完成后查看报告制品；缺陷任务卡在待办列（冻结），人工批准解冻后可拖入开发。",
      ]
        .filter((l) => l !== undefined)
        .join("\n"),
      column: "design",
      frozen: false,
    });

    const runId = randomUUID();
    const payload = JSON.stringify({
      scheduleId: schedule.id,
      scheduleRunId: runId,
      template: schedule.template,
      config: schedule.config,
      runCardId: runCard.id,
    });

    const job = this.createJob({
      boardId: schedule.boardId,
      cardId: runCard.id,
      employeeId: scanner.id,
      trigger: "schedule",
      payload,
    });

    this.db
      .prepare(
        `INSERT INTO schedule_runs (
           id, schedule_id, board_id, run_card_id, job_id, status, trigger,
           error, started_at, finished_at, created_at
         ) VALUES (?, ?, ?, ?, ?, 'queued', ?, NULL, ?, NULL, ?)`,
      )
      .run(
        runId,
        schedule.id,
        schedule.boardId,
        runCard.id,
        job.id,
        trigger,
        now,
        now,
      );

    this.addComment({
      cardId: runCard.id,
      author: "bot",
      body: `[audit] schedule ${schedule.id} (${schedule.name}) enqueued job ${job.id}`,
    });

    let next: string;
    try {
      next = nextCronRunAt(schedule.cron, now);
    } catch {
      next = new Date(
        new Date(now).getTime() + schedule.intervalHours * 3600_000,
      ).toISOString();
    }
    const updated = this.updateSchedule(schedule.id, {
      lastRunAt: now,
      nextRunAt: next,
    })!;

    return {
      schedule: updated,
      runCard,
      job,
      run: this.getScheduleRun(runId)!,
    };
  }

  /** Enqueue all enabled schedules whose next_run_at <= now. */
  processDueSchedules(
    boardId: string,
    nowIso?: string,
  ): Array<{
    scheduleId: string;
    runCardId: string;
    jobId: string;
    runId: string;
  }> {
    const now = nowIso ?? new Date().toISOString();
    const due = this.listSchedules(boardId).filter(
      (s) => s.enabled && s.nextRunAt <= now,
    );
    const out: Array<{
      scheduleId: string;
      runCardId: string;
      jobId: string;
      runId: string;
    }> = [];
    for (const s of due) {
      const r = this.enqueueScheduleRun(s.id, {
        force: true,
        nowIso: now,
        trigger: "due",
      });
      if (!r) continue;
      out.push({
        scheduleId: s.id,
        runCardId: r.runCard.id,
        jobId: r.job.id,
        runId: r.run.id,
      });
    }
    return out;
  }

  /**
   * Recent open defect tasks in design for dedupe (title + path fingerprint).
   */
  listRecentScanDefectKeys(boardId: string, withinHours = 168): Set<string> {
    const since = new Date(
      Date.now() - withinHours * 3600_000,
    ).toISOString();
    const rows = this.db
      .prepare(
        `SELECT title, description FROM cards
         WHERE board_id = ? AND type = 'task' AND column_id = 'design'
           AND created_at >= ?`,
      )
      .all(boardId, since) as Array<{ title: string; description: string }>;
    const keys = new Set<string>();
    for (const r of rows) {
      const pathMatch = /(?:^|\n)path:\s*(.+)$/im.exec(r.description);
      const path = (pathMatch?.[1] ?? "").trim().toLowerCase();
      const title = r.title.replace(/^\[scan\]\s*/i, "").trim().toLowerCase();
      keys.add(`${title}|${path}`);
    }
    return keys;
  }
}
