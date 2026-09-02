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
  sentry_project_slug TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','planning')),
  blurb TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
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
  -- The Jira workflow status, exactly as Jira names it, and the Atlassian status
  -- category it belongs to. Both nullable: a manual todo has no Jira status, and an
  -- empty string would be indistinguishable from one the engine failed to read.
  status TEXT,
  status_category TEXT,
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
  -- Nullable: a PR imported from GitHub has no ticket behind it. There is no
  -- migration entry for dropping this NOT NULL, because SQLite would need a full
  -- table rebuild and no existing database needs it: only recordPr inserts here
  -- and it always has a ticket, so an older database being stricter is harmless.
  ticket_id INTEGER REFERENCES tickets(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  branch TEXT NOT NULL,
  number INTEGER,
  url TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','needs_attention','merged')) DEFAULT 'open',
  last_review_score REAL,
  pinned INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  review_state TEXT,
  is_draft INTEGER NOT NULL DEFAULT 0,
  github_updated_at TEXT,
  authored_by_me INTEGER NOT NULL DEFAULT 0,
  assigned_to_me INTEGER NOT NULL DEFAULT 0,
  review_requested_by_me INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS todo_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  todo_id INTEGER NOT NULL REFERENCES todos(id),
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

-- A review's remarks, waiting to be posted. Stored rather than held in memory
-- because the review runs in the background: it finishes while the user is on
-- another screen, announces itself, and is read later, possibly after a restart.
--
-- commit_sha is the commit the line numbers were read from. It travels with the
-- comment when it is posted, and comparing it to the pull request's head is what
-- says whether the remark has gone stale.
CREATE TABLE IF NOT EXISTS pr_review_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id INTEGER NOT NULL REFERENCES prs(id),
  path TEXT NOT NULL,
  line INTEGER NOT NULL,
  body TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  posted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pr_review_findings_pr ON pr_review_findings(pr_id);
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
  // 3: Projects grid. Status and a one-line blurb per project.
  `ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','planning'));
   ALTER TABLE projects ADD COLUMN blurb TEXT NOT NULL DEFAULT '';`,
  // 4: PR inbox. GitHub review state and the two "is this mine" flags.
  `ALTER TABLE prs ADD COLUMN title TEXT NOT NULL DEFAULT '';
   ALTER TABLE prs ADD COLUMN review_state TEXT;
   ALTER TABLE prs ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE prs ADD COLUMN github_updated_at TEXT;
   ALTER TABLE prs ADD COLUMN authored_by_me INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE prs ADD COLUMN assigned_to_me INTEGER NOT NULL DEFAULT 0;`,
  // 5: Repair. A past rebuild renamed prs to prs_old, and SQLite repointed every
  // child's foreign key to follow the rename before prs_old was dropped, leaving
  // both children referencing a table that no longer exists. Rebuilding each one
  // is the only way to change a foreign key clause in SQLite. Rows are copied, so
  // this is lossless. Relies on migrate() running it with foreign keys off, since
  // dropping tickets would otherwise fail on every row that points at it.
  `CREATE TABLE pr_messages_rebuilt (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     pr_id INTEGER NOT NULL REFERENCES prs(id),
     role TEXT NOT NULL CHECK (role IN ('user','assistant')),
     content TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   INSERT INTO pr_messages_rebuilt (id, pr_id, role, content, created_at)
     SELECT id, pr_id, role, content, created_at FROM pr_messages;
   DROP TABLE pr_messages;
   ALTER TABLE pr_messages_rebuilt RENAME TO pr_messages;
   CREATE TABLE tickets_rebuilt (
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
   INSERT INTO tickets_rebuilt (id, source, source_id, project_id, title, body, url, analysis_json, status, pr_id, pinned, created_at)
     SELECT id, source, source_id, project_id, title, body, url, analysis_json, status, pr_id, pinned, created_at FROM tickets;
   DROP TABLE tickets;
   ALTER TABLE tickets_rebuilt RENAME TO tickets;`,
  // 6: Project detail. Free-form per-project notes, autosaved from the Notes tab.
  `ALTER TABLE projects ADD COLUMN notes TEXT NOT NULL DEFAULT '';`,
  // 7: Split the Jira screen by status. The workflow status name as Jira reports it,
  // plus its Atlassian category, which is what makes ordering possible: the name
  // alone cannot say whether "Blocked" is active work. Nullable, no default, so an
  // unknown status stays distinguishable from a real one.
  `ALTER TABLE todos ADD COLUMN status TEXT;
   ALTER TABLE todos ADD COLUMN status_category TEXT;`,

  // 8: whether GitHub currently asks this user for a review on the pull request.
  // Separate from review_state, which is the pull request's overall decision and
  // says nothing about who was asked. Defaults to 0, so every existing row reads
  // as not awaiting review until the first poll after this fills it in.
  `ALTER TABLE prs ADD COLUMN review_requested_by_me INTEGER NOT NULL DEFAULT 0;`,

  // 9: where a pull request review's remarks wait between being written and being
  // posted. IF NOT EXISTS because SCHEMA already creates it on a fresh file, and a
  // database stamped back to an earlier version replays this over a table that is
  // already there.
  `CREATE TABLE IF NOT EXISTS pr_review_findings (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     pr_id INTEGER NOT NULL REFERENCES prs(id),
     path TEXT NOT NULL,
     line INTEGER NOT NULL,
     body TEXT NOT NULL,
     commit_sha TEXT NOT NULL,
     posted INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_pr_review_findings_pr ON pr_review_findings(pr_id);`,
];

function isEmptyDatabase(db: Database.Database): boolean {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get() as { n: number };
  return row.n === 0;
}

// Foreign keys are off for the whole run. A rebuild like migration 5 drops and
// recreates a table, and the implicit delete a DROP TABLE performs fails under
// enforcement whenever any child row points at it, which is the normal state of
// an install that ran the fix pipeline. PRAGMA foreign_keys is a no-op inside a
// transaction, so it has to be toggled out here rather than in the migration.
// foreign_key_check afterwards is what keeps that safe: a migration that leaves
// a dangling reference behind fails loudly instead of corrupting the file.
function migrate(db: Database.Database): void {
  const applied = db.pragma('user_version', { simple: true }) as number;
  if (applied >= MIGRATIONS.length) return;

  db.pragma('foreign_keys = OFF');
  try {
    for (let version = applied; version < MIGRATIONS.length; version++) {
      db.transaction(() => {
        db.exec(MIGRATIONS[version]);
        db.exec(`PRAGMA user_version = ${version + 1};`);
      })();
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }

  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`migration left ${violations.length} broken foreign key reference(s)`);
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
