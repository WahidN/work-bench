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
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    db.close();
  });

  it('adds the phase 4 columns to a database created before them', () => {
    dir = mkdtempSync(join(tmpdir(), 'workbench-db-'));
    const path = join(dir, 'legacy.db');

    // The pre-phase-4 shape, trimmed to the tables this migration touches.
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL);
      CREATE TABLE prs (id INTEGER PRIMARY KEY AUTOINCREMENT, branch TEXT NOT NULL);
    `);
    legacy.prepare(`INSERT INTO todos (source, text, done, created_at) VALUES ('manual', 'old task', 0, '2026-08-01')`).run();
    legacy.prepare(`INSERT INTO tickets (title) VALUES ('old ticket')`).run();
    legacy.prepare(`INSERT INTO prs (branch) VALUES ('old-branch')`).run();
    legacy.close();

    const db = openDb(path);
    const columns = (target: Database.Database, table: string) =>
      (target.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

    expect(columns(db, 'todos')).toContain('priority');
    expect(columns(db, 'todos')).toContain('due_at');
    expect(columns(db, 'todos')).toContain('done_at');
    expect(columns(db, 'tickets')).toContain('pinned');
    expect(columns(db, 'prs')).toContain('pinned');
    expect(db.prepare('SELECT priority, due_at, done_at FROM todos').get()).toEqual({
      priority: 'med', due_at: null, done_at: null,
    });
    expect(db.prepare('SELECT pinned FROM tickets').get()).toEqual({ pinned: 0 });
    expect(db.prepare('SELECT pinned FROM prs').get()).toEqual({ pinned: 0 });
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    db.close();

    // Reopening an already-migrated file must be a no-op: no throw, version unchanged.
    // This is what proves the DDL and the user_version stamp now move together: before
    // the fix, a process dying between them left the columns applied but user_version
    // at 0, so the next open replayed the ALTER TABLE and threw on the duplicate column.
    const reopened = openDb(path);
    expect(columns(reopened, 'todos')).toContain('priority');
    expect(reopened.pragma('user_version', { simple: true })).toBe(1);
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
    `);
    legacy.close();
    const migratedDb = openDb(legacyPath);

    for (const table of ['todos', 'tickets', 'prs']) {
      expect(columns(migratedDb, table)).toEqual(columns(freshDb, table));
    }

    freshDb.close();
    migratedDb.close();
  });
});
