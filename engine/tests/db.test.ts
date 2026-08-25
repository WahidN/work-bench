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
      'jobs', 'pr_messages', 'project_messages', 'projects', 'prs', 'ticket_messages', 'tickets', 'todos',
    ]);
    db.close();
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
    expect(db.pragma('user_version', { simple: true })).toBe(6);
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
    expect(db.pragma('user_version', { simple: true })).toBe(6);
    db.close();

    // Reopening an already-migrated file must be a no-op: no throw, version unchanged.
    // This is what proves the DDL and the user_version stamp now move together: before
    // the fix, a process dying between them left the columns applied but user_version
    // at 0, so the next open replayed the ALTER TABLE and threw on the duplicate column.
    const reopened = openDb(path);
    expect(columns(reopened, 'todos')).toContain('priority');
    expect(reopened.pragma('user_version', { simple: true })).toBe(6);
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

    expect(db.pragma('user_version', { simple: true })).toBe(6);
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
