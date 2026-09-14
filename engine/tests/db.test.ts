import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('openDb', () => {
  it('creates all tables on a fresh file', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const db = openDb(join(dir, 'test.db'));
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toEqual([
      'jobs', 'pr_comment_fixes', 'pr_messages', 'pr_review_findings', 'project_messages',
      'projects', 'prs', 'ticket_messages', 'tickets', 'todo_messages', 'todos',
    ]);
    db.close();
  });

  it('gives todos a nullable status and status category on a fresh file', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const db = openDb(join(dir, 'test.db'));
    const columns = db.prepare('PRAGMA table_info(todos)').all() as any[];

    const status = columns.find((column) => column.name === 'status');
    const category = columns.find((column) => column.name === 'status_category');
    expect(status).toBeTruthy();
    expect(category).toBeTruthy();
    // Nullable on purpose: a manual todo has no Jira status, and an empty string
    // would be indistinguishable from a status the engine failed to read.
    expect(status.notnull).toBe(0);
    expect(category.notnull).toBe(0);
    expect(status.dflt_value).toBeNull();
    expect(category.dflt_value).toBeNull();
    db.close();
  });

  it('adds the todo status columns to a database that predates them, keeping its rows', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const file = join(dir, 'test.db');

    // A database at migration 6, before the status columns existed.
    const first = openDb(file);
    first.exec(`INSERT INTO projects (name, repo_path, default_branch) VALUES ('demo', '/repos/demo', 'main')`);
    first.exec(
      `INSERT INTO todos (source, source_id, text, body, created_at)
       VALUES ('jira', 'JIRA-DEMO-1', '[DEMO-1] Old issue', 'b', 'now')`
    );
    first.exec('ALTER TABLE todos DROP COLUMN status');
    first.exec('ALTER TABLE todos DROP COLUMN status_category');
    // Stamping back to 6 replays every later migration too, so what they add has to
    // go as well or migration 8 hits a column SCHEMA already created.
    first.exec('ALTER TABLE prs DROP COLUMN review_requested_by_me');
    first.pragma('user_version = 6');
    first.close();

    const db = openDb(file);

    const columns = (db.prepare('PRAGMA table_info(todos)').all() as any[]).map((column) => column.name);
    expect(columns).toContain('status');
    expect(columns).toContain('status_category');
    expect(db.pragma('user_version', { simple: true })).toBe(10);
    // The existing row survives with a null status until the next poll rewrites it.
    expect(db.prepare(`SELECT text, status, status_category FROM todos`).get()).toEqual({
      text: '[DEMO-1] Old issue', status: null, status_category: null,
    });
    db.close();
  });

  it('adds review_requested_by_me to a prs database migrated from before this change', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const file = join(dir, 'legacy-review.db');
    const first = openDb(file);
    first.prepare(
      `INSERT INTO projects (name, repo_path, default_branch) VALUES ('demo', '/tmp/demo', 'main')`
    ).run();
    first.prepare(
      `INSERT INTO prs (project_id, branch, number, url, status, created_at)
       VALUES (1, 'feat/old', 24, 'u', 'open', 'now')`
    ).run();
    first.exec('ALTER TABLE prs DROP COLUMN review_requested_by_me');
    first.pragma('user_version = 7');
    first.close();

    const db = openDb(file);

    const columns = (db.prepare('PRAGMA table_info(prs)').all() as any[]).map((column) => column.name);
    expect(columns).toContain('review_requested_by_me');
    expect(db.pragma('user_version', { simple: true })).toBe(10);
    // The existing row reads as not awaiting review until the next poll fills it in,
    // which is accurate rather than wrong: nothing has asked GitHub yet.
    expect(db.prepare(`SELECT number, review_requested_by_me FROM prs`).get()).toEqual({
      number: 24, review_requested_by_me: 0,
    });
    db.close();
  });

  it('gives a fresh database the review_requested_by_me column too', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const db = openDb(join(dir, 'fresh-review.db'));
    const columns = (db.prepare('PRAGMA table_info(prs)').all() as any[]).map((column) => column.name);
    expect(columns).toContain('review_requested_by_me');
    db.close();
  });

  // A review now outlives the request that produced it, so it has to be on disk.
  it('adds pr_review_findings to a database migrated from before it', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const path = join(dir, 'findings.db');
    const first = openDb(path);
    first.exec('DROP TABLE pr_review_findings');
    first.pragma('user_version = 8');
    first.close();

    const db = openDb(path);
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pr_review_findings'")
      .get();

    expect(table).toBeTruthy();
    expect(db.pragma('user_version', { simple: true })).toBe(10);
    db.close();
  });

  it('gives a fresh database the pr_review_findings columns', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const db = openDb(join(dir, 'fresh-findings.db'));
    const columns = (db.prepare('PRAGMA table_info(pr_review_findings)').all() as any[]).map((c) => c.name);

    for (const name of ['id', 'pr_id', 'path', 'line', 'body', 'commit_sha', 'posted', 'created_at']) {
      expect(columns).toContain(name);
    }
    db.close();
  });

  it('adds todo_messages to a database that predates it, without a migration', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const path = join(dir, 'test.db');
    const first = openDb(path);
    first.exec('DROP TABLE todo_messages');
    first.close();

    const second = openDb(path);
    const row = second
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='todo_messages'")
      .get();
    expect(row).toBeTruthy();
    expect(second.pragma('user_version', { simple: true })).toBe(10);
    second.close();
  });

  it('enforces UNIQUE(source, source_id) on tickets', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const db = openDb(join(dir, 'test.db'));
    db.prepare(
      `INSERT INTO projects (name, repo_path, default_branch) VALUES ('demo', '/tmp/demo', 'main')`
    ).run();
    const insert = () =>
      db
        .prepare(
          `INSERT INTO tickets (source, source_id, project_id, title, body, url, created_at)
           VALUES ('github', 'GH-1', 1, 't', 'b', 'u', '2026-01-01')`
        )
        .run();
    insert();
    expect(insert).toThrow(/UNIQUE/);
    db.close();
  });

  it('stamps a fresh database as already migrated', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const db = openDb(join(dir, 'test.db'));
    expect(db.pragma('user_version', { simple: true })).toBe(10);
    db.close();
  });

  it('adds the migrated columns to a database created before them', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const path = join(dir, 'legacy.db');

    // The pre-phase-4 shape, trimmed to the tables this migration touches. projects
    // is included in its pre-status/blurb shape because it already existed in every
    // real legacy database, unlike todos/tickets/prs it is not created fresh by SCHEMA.
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        url TEXT NOT NULL,
        analysis_json TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        pr_id INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE TABLE prs (id INTEGER PRIMARY KEY AUTOINCREMENT, branch TEXT NOT NULL);
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        repo_path TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        github_repo TEXT,
        jira_project_key TEXT,
        sentry_project_slug TEXT
      );
    `);
    legacy.prepare(`INSERT INTO todos (source, text, done, created_at) VALUES ('manual', 'old task', 0, '2026-08-01')`).run();
    legacy.prepare(
      `INSERT INTO tickets (source, source_id, project_id, title, body, url, created_at)
       VALUES ('jira', 'OLD-1', 1, 'old ticket', 'old body', 'https://example.com/old', '2026-01-01')`
    ).run();
    legacy.prepare(`INSERT INTO prs (branch) VALUES ('old-branch')`).run();
    legacy.prepare(`INSERT INTO projects (name, repo_path, default_branch) VALUES ('acv', '/repos/acv', 'main')`).run();
    legacy.close();

    const db = openDb(path);
    const columns = (target: Database.Database, table: string) =>
      (target.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

    expect(columns(db, 'todos')).toContain('priority');
    expect(columns(db, 'todos')).toContain('due_at');
    expect(columns(db, 'todos')).toContain('done_at');
    expect(columns(db, 'tickets')).toContain('pinned');
    expect(columns(db, 'prs')).toContain('pinned');
    expect(columns(db, 'todos')).toContain('pinned');
    expect(columns(db, 'projects')).toContain('status');
    expect(columns(db, 'projects')).toContain('blurb');
    expect(columns(db, 'projects')).toContain('notes');
    expect(db.prepare('SELECT priority, due_at, done_at FROM todos').get()).toEqual({
      priority: 'med', due_at: null, done_at: null,
    });
    expect(db.prepare('SELECT pinned FROM tickets').get()).toEqual({ pinned: 0 });
    expect(db.prepare('SELECT pinned FROM prs').get()).toEqual({ pinned: 0 });
    expect(db.prepare('SELECT status, blurb, notes FROM projects').get()).toEqual({ status: 'active', blurb: '', notes: '' });
    expect(db.pragma('user_version', { simple: true })).toBe(10);
    db.close();

    // Reopening an already-migrated file must be a no-op: no throw, version unchanged.
    // This is what proves the DDL and the user_version stamp now move together: before
    // the fix, a process dying between them left the columns applied but user_version
    // at 0, so the next open replayed the ALTER TABLE and threw on the duplicate column.
    const reopened = openDb(path);
    expect(columns(reopened, 'todos')).toContain('priority');
    expect(reopened.pragma('user_version', { simple: true })).toBe(10);
    reopened.close();
  });

  it('keeps SCHEMA and MIGRATIONS in sync: a fresh and a migrated database end up with identical columns', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const columns = (db: Database.Database, table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name).sort();

    const freshDb = openDb(join(dir, 'fresh.db'));

    // The full pre-migration-1 shape of the three tables migration 1 touches, i.e.
    // SCHEMA's current column set minus exactly what migration 1 adds. If a future
    // phase adds a column to SCHEMA without a matching MIGRATIONS entry, the migrated
    // database below will not gain it while the fresh one will, and this test fails.
    const legacyPath = join(dir, 'legacy.db');
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_id TEXT,
        text TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        url TEXT,
        project_id INTEGER,
        can_promote INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0,
        promoted_ticket_id INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE TABLE tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        url TEXT NOT NULL,
        analysis_json TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        pr_id INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE TABLE prs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        branch TEXT NOT NULL,
        number INTEGER,
        url TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        last_review_score REAL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        repo_path TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        github_repo TEXT,
        jira_project_key TEXT,
        sentry_project_slug TEXT
      );
    `);
    legacy.close();
    const migratedDb = openDb(legacyPath);

    for (const table of ['todos', 'tickets', 'prs', 'projects']) {
      expect(columns(migratedDb, table)).toEqual(columns(freshDb, table));
    }

    freshDb.close();
    migratedDb.close();
  });

  it('runs the tickets rebuild on a database where children still reference tickets', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const file = join(dir, 'test.db');

    // The normal shape of any install that ran the fix pipeline: prs.ticket_id and
    // todos.promoted_ticket_id are filled in, and tickets.pr_id points back. Dropping
    // tickets under foreign key enforcement fails on exactly those rows.
    const raw = new Database(file);
    raw.pragma('foreign_keys = OFF');
    raw.exec(`
      CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
      CREATE TABLE tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        url TEXT NOT NULL,
        analysis_json TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        pr_id INTEGER REFERENCES "prs_old"(id),
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(source, source_id)
      );
      CREATE TABLE prs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER REFERENCES tickets(id),
        project_id INTEGER NOT NULL REFERENCES projects(id),
        branch TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE pr_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pr_id INTEGER NOT NULL REFERENCES "prs_old"(id),
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        promoted_ticket_id INTEGER REFERENCES tickets(id),
        created_at TEXT NOT NULL
      );
    `);
    raw.exec(`INSERT INTO projects (name) VALUES ('P');`);
    raw.exec(
      `INSERT INTO tickets (source, source_id, project_id, title, body, url, pr_id, created_at)
       VALUES ('jira', 'KEEP-1', 1, 'keep me', 'body', 'https://example.com/keep', 1, 'now')`
    );
    raw.exec(`INSERT INTO prs (ticket_id, project_id, branch, created_at) VALUES (1, 1, 'fix/keep-1', 'now');`);
    raw.exec(`INSERT INTO pr_messages (pr_id, role, content, created_at) VALUES (1, 'user', 'keep me', 'now');`);
    raw.exec(`INSERT INTO todos (source, text, promoted_ticket_id, created_at) VALUES ('manual', 'promoted', 1, 'now');`);
    raw.pragma('user_version = 4');
    raw.close();

    const db = openDb(file);

    expect(db.pragma('user_version', { simple: true })).toBe(10);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare('SELECT ticket_id FROM prs').get()).toEqual({ ticket_id: 1 });
    expect(db.prepare('SELECT promoted_ticket_id FROM todos').get()).toEqual({ promoted_ticket_id: 1 });
    expect(db.prepare('SELECT title, pr_id FROM tickets').get()).toEqual({ title: 'keep me', pr_id: 1 });
    db.close();
  });

  it('repoints the prs_old foreign keys on pr_messages and tickets, and keeps the rows', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const file = join(dir, 'test.db');

    const raw = new Database(file);
    // Off so the fixture can insert rows despite the dangling FKs below, matching
    // how such rows would have gotten in before the corruption was ever caught.
    raw.pragma('foreign_keys = OFF');
    raw.exec(`
      CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
      CREATE TABLE prs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id));
      CREATE TABLE pr_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pr_id INTEGER NOT NULL REFERENCES "prs_old"(id),
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        url TEXT NOT NULL,
        analysis_json TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        pr_id INTEGER REFERENCES "prs_old"(id),
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(source, source_id)
      );
      -- Present so that migrations targeting todos have something to alter. Without
      -- it, openDb's SCHEMA pass creates todos already carrying the newest columns
      -- and the migration then collides with itself on "duplicate column name".
      -- Shaped as a version-4 database: migrations 1 to 4 applied, nothing later.
      CREATE TABLE todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_id TEXT,
        text TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        url TEXT,
        project_id INTEGER REFERENCES projects(id),
        can_promote INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0,
        promoted_ticket_id INTEGER REFERENCES tickets(id),
        priority TEXT NOT NULL DEFAULT 'med',
        due_at TEXT,
        done_at TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(source, source_id)
      );
    `);
    raw.exec(`INSERT INTO projects (name) VALUES ('P');`);
    raw.exec(`INSERT INTO prs (project_id) VALUES (1);`);
    raw.exec(`INSERT INTO pr_messages (pr_id, role, content, created_at) VALUES (1, 'user', 'keep me', 'now');`);
    // pr_id is left NULL here; the test above covers a ticket that points at a real PR.
    raw.exec(
      `INSERT INTO tickets (source, source_id, project_id, title, body, url, created_at)
       VALUES ('jira', 'KEEP-1', 1, 'keep me too', 'ticket body', 'https://example.com/keep', 'now')`
    );
    raw.pragma('user_version = 4');
    raw.close();

    const db = openDb(file);
    const schemaOf = (table: string) =>
      (db.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(table) as { sql: string }).sql;

    const prMessagesSql = schemaOf('pr_messages');
    expect(prMessagesSql).not.toContain('prs_old');
    expect(prMessagesSql).toContain('REFERENCES prs(id)');
    expect(db.prepare('SELECT content FROM pr_messages').all()).toEqual([{ content: 'keep me' }]);

    const ticketsSql = schemaOf('tickets');
    expect(ticketsSql).not.toContain('prs_old');
    expect(ticketsSql).toContain('REFERENCES prs(id)');
    expect(
      db.prepare('SELECT source, source_id, project_id, title, body, url, pr_id, created_at FROM tickets').all()
    ).toEqual([
      {
        source: 'jira',
        source_id: 'KEEP-1',
        project_id: 1,
        title: 'keep me too',
        body: 'ticket body',
        url: 'https://example.com/keep',
        pr_id: null,
        created_at: 'now',
      },
    ]);

    db.close();
  });
});
