import Database from "better-sqlite3";

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
  ensureColumn(db, "jobs", "error", "TEXT");
  ensureColumn(db, "jobs", "finished_at", "TEXT");
  ensureColumn(db, "jobs", "worker_id", "TEXT");
  ensureColumn(db, "jobs", "payload", "TEXT");
}
