import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  decl: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

export function openDb(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      column_id TEXT NOT NULL,
      epic_id TEXT,
      rework_count INTEGER NOT NULL DEFAULT 0,
      frozen INTEGER NOT NULL DEFAULT 0,
      artifacts_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL,
      watch_columns_json TEXT NOT NULL,
      adapter TEXT NOT NULL DEFAULT 'cursor'
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      created_at TEXT NOT NULL,
      claimed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      employee_role TEXT NOT NULL DEFAULT 'design',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  ensureColumn(db, "cards", "locked_job_id", "TEXT");
  ensureColumn(db, "cards", "locked_at", "TEXT");
  ensureColumn(db, "cards", "status", "TEXT");
  ensureColumn(db, "cards", "design_id", "TEXT");
  ensureColumn(db, "jobs", "error", "TEXT");
  ensureColumn(db, "jobs", "finished_at", "TEXT");
  ensureColumn(db, "jobs", "worker_id", "TEXT");
  ensureColumn(db, "jobs", "payload", "TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS design_requirements (
      design_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      requirement_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (design_id, requirement_id)
    );
  `);

  // Default requirement status for existing rows.
  db.prepare(
    `UPDATE cards SET status = 'open'
     WHERE type = 'requirement' AND (status IS NULL OR status = '')`,
  ).run();

  migrateStrandedEpicsToDesignCards(db);
  migrateDesignCardsOffSplitVerify(db);
  migrateSplitVerifyEmployeeWatchColumns(db);
}

/** Design cards no longer occupy split/verify — pull them back to design. */
function migrateDesignCardsOffSplitVerify(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE cards SET column_id = 'design', updated_at = ?
     WHERE type = 'design' AND column_id IN ('split', 'verify')`,
  ).run(now);
}

/** Split/Verify bots are button-triggered only — clear column watches. */
function migrateSplitVerifyEmployeeWatchColumns(db: Database.Database): void {
  db.prepare(
    `UPDATE employees SET watch_columns_json = '[]'
     WHERE role IN ('split', 'verify')`,
  ).run();
}

/**
 * Epics that were left in design/split/verify become Design cards linked back
 * to the theme Epic (moved to requirements). Linked requirements are attached.
 */
function migrateStrandedEpicsToDesignCards(db: Database.Database): void {
  const stranded = db
    .prepare(
      `SELECT id, board_id, title, description, column_id, artifacts_json,
              created_at, updated_at
       FROM cards
       WHERE type = 'epic' AND column_id IN ('design', 'split', 'verify')`,
    )
    .all() as Array<{
    id: string;
    board_id: string;
    title: string;
    description: string;
    column_id: string;
    artifacts_json: string;
    created_at: string;
    updated_at: string;
  }>;

  if (stranded.length === 0) return;

  const insertDesign = db.prepare(
    `INSERT INTO cards (
       id, board_id, type, title, description, column_id, epic_id,
       rework_count, frozen, artifacts_json, status, created_at, updated_at
     ) VALUES (?, ?, 'design', ?, ?, ?, ?, 0, 0, ?, NULL, ?, ?)`,
  );
  const linkReq = db.prepare(
    `INSERT OR IGNORE INTO design_requirements (design_id, requirement_id, created_at)
     VALUES (?, ?, ?)`,
  );
  const moveEpic = db.prepare(
    `UPDATE cards SET column_id = 'requirements', updated_at = ? WHERE id = ?`,
  );
  const bumpReq = db.prepare(
    `UPDATE cards SET status = 'in_progress', updated_at = ?
     WHERE id = ? AND type = 'requirement'
       AND (status IS NULL OR status = '' OR status = 'open')`,
  );

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const epic of stranded) {
      const designId = cryptoRandomId();
      insertDesign.run(
        designId,
        epic.board_id,
        `${epic.title} · 设计批次`,
        epic.description,
        "design",
        epic.id,
        epic.artifacts_json,
        now,
        now,
      );
      const reqs = db
        .prepare(
          `SELECT id FROM cards WHERE epic_id = ? AND type = 'requirement'`,
        )
        .all(epic.id) as Array<{ id: string }>;
      for (const r of reqs) {
        linkReq.run(designId, r.id, now);
        bumpReq.run(now, r.id);
      }
      moveEpic.run(now, epic.id);
    }
  });
  tx();
}

function cryptoRandomId(): string {
  return randomUUID();
}
