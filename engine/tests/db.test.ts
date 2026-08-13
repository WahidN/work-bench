import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
});
