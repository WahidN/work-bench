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
    legacy.close();

    const db = openDb(path);
    const columns = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

    expect(columns('todos')).toContain('priority');
    expect(columns('todos')).toContain('due_at');
    expect(columns('todos')).toContain('done_at');
    expect(columns('tickets')).toContain('pinned');
    expect(columns('prs')).toContain('pinned');
    expect(db.prepare('SELECT priority, due_at FROM todos').get()).toEqual({ priority: 'med', due_at: null });
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    db.close();
  });
});
