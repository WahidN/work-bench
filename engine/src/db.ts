import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DB_PATH = join(homedir(), '.workbench', 'workbench.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  repo_path TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  github_repo TEXT,
  jira_project_key TEXT,
  sentry_project_slug TEXT
);

CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('manual','jira')),
  source_id TEXT,
  text TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT,
  project_id INTEGER REFERENCES projects(id),
  can_promote INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  promoted_ticket_id INTEGER REFERENCES tickets(id),
  priority TEXT NOT NULL DEFAULT 'med' CHECK (priority IN ('high','med','low')),
  due_at TEXT,
  done_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(source, source_id)
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('sentry','github','jira')),
  source_id TEXT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT NOT NULL,
  analysis_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('new','sparring','in_review','done','needs_attention')) DEFAULT 'new',
  pr_id INTEGER REFERENCES prs(id),
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(source, source_id)
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  branch TEXT NOT NULL,
  number INTEGER,
  url TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','needs_attention','merged')) DEFAULT 'open',
  last_review_score REAL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pr_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id INTEGER NOT NULL REFERENCES prs(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('triage','spar','fix','pr-chat','merge')),
  target_type TEXT NOT NULL CHECK (target_type IN ('ticket','pr')),
  target_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','done','failed','interrupted')) DEFAULT 'running',
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_target ON jobs(target_type, target_id, status);
`;

// SQLite has no "ADD COLUMN IF NOT EXISTS", so every change to a table that
// already exists in someone's database goes in this list, append-only. The file's
// PRAGMA user_version records how many entries have been applied. SCHEMA above is
// always the current shape, so a brand new file is stamped as fully migrated and
// never replays these.
const MIGRATIONS: string[] = [
  // 1: Phase 4. Task priority, due date, completion stamp, and pin flags.
  `ALTER TABLE todos ADD COLUMN priority TEXT NOT NULL DEFAULT 'med' CHECK (priority IN ('high','med','low'));
   ALTER TABLE todos ADD COLUMN due_at TEXT;
   ALTER TABLE todos ADD COLUMN done_at TEXT;
   ALTER TABLE tickets ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE prs ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`,
  // 2: Jira screen. Pin a Jira issue onto Today.
  `ALTER TABLE todos ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`,
];

function isEmptyDatabase(db: Database.Database): boolean {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get() as { n: number };
  return row.n === 0;
}

function migrate(db: Database.Database): void {
  const applied = db.pragma('user_version', { simple: true }) as number;
  for (let version = applied; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1};`);
    })();
  }
}

export function openDb(path: string = DB_PATH): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const isNew = isEmptyDatabase(db);
  db.exec(SCHEMA);
  if (isNew) db.pragma(`user_version = ${MIGRATIONS.length}`);
  else migrate(db);
  return db;
}
