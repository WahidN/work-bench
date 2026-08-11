# Workbench Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Workbench engine — a long-running local Node/TS server that consolidates issue-agent's triage/fix pipeline and work-tracker's Jira-todo sync into one SQLite-backed HTTP API, ready for the SwiftUI desktop app and the trimmed Raycast extension to consume in later plans.

**Architecture:** A single Node process (`workbench-engine`) holds all state in a local SQLite database and all secrets in the macOS Keychain. A background poller runs every 5 minutes pulling Jira/Sentry/GitHub. An Express HTTP server on `localhost` only, guarded by a Keychain-stored bearer token, exposes the Today list, ticket/PR chat, and project config as REST endpoints. Headless `claude -p` subprocess sessions do triage analysis, ticket sparring, fix implementation, and PR review — reusing issue-agent's exact subprocess-invocation and review-scoring logic. Git worktrees and `gh` CLI calls handle branches/PRs, gaining an explicit `mergePr` capability issue-agent never had.

**Tech Stack:** Node.js (>=22.5.0), TypeScript (NodeNext modules, strict), `better-sqlite3`, `execa`, `express`, Vitest, `tsx` for running without a build step.

## Global Constraints

- Never merge or push to a project's default branch except via the explicit `mergePr` action triggered by a user request (Merge button or "merge it" chat message) — no code path may call it automatically.
- All source-adapter and pipeline logic ported from issue-agent must preserve its exact behavior (JQL, scoring thresholds, retry counts, prompt content) unless this plan explicitly calls out a change.
- No secrets in `process.env`, `.env` files, or committed config — Jira/Sentry API tokens and the local API bearer token live only in macOS Keychain, read into local variables and passed as function arguments.
- Dedup for tickets and todos is a `UNIQUE(source, source_id)` SQLite constraint, not the regex-marker-in-description scheme issue-agent used for Linear.
- Review pass condition, verbatim from issue-agent: average of `[correctness, completeness, quality, tests, regressionRisk]` >= 4 **and** `correctness` >= 4 individually. Max 3 review rounds.
- Every new module gets a Vitest test file under `tests/` mirroring its `src/` path, following the existing repos' pattern of testing pure functions directly and stubbing `execa`/`fetch` at the boundary for anything that shells out or makes HTTP calls.

---

### Task 1: Scaffold the engine project

**Files:**
- Create: `engine/package.json`
- Create: `engine/tsconfig.json`
- Create: `engine/.gitignore`

**Interfaces:**
- Produces: a `pnpm test` / `pnpm typecheck` / `pnpm start` project skeleton every later task builds inside.

- [ ] **Step 1: Create `engine/package.json`**

```json
{
  "name": "workbench-engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.5.0" },
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "execa": "^9.6.1",
    "express": "^4.21.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/express": "^4.17.21",
    "@types/node": "^26.1.1",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.23.1",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: Create `engine/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `engine/.gitignore`**

```
node_modules/
*.db
*.db-journal
```

- [ ] **Step 4: Install dependencies**

Run: `cd engine && pnpm install`
Expected: lockfile created, `node_modules/` populated, no errors.

- [ ] **Step 5: Commit**

```bash
cd engine && git add package.json tsconfig.json .gitignore pnpm-lock.yaml
git commit -m "Scaffold workbench-engine project"
```

---

### Task 2: Shared types

**Files:**
- Create: `engine/src/types.ts`

**Interfaces:**
- Produces: `Project`, `Todo`, `Ticket`, `TicketMessage`, `Pr`, `PrMessage`, `Job`, `Analysis`, `ReviewScore`, `SourceIssue` — every later task imports its row/domain types from here.

- [ ] **Step 1: Write `engine/src/types.ts`**

```ts
export interface Project {
  id: number;
  name: string;
  repoPath: string;
  defaultBranch: string;
  githubRepo: string | null;
  jiraProjectKey: string | null;
  sentryProjectSlug: string | null;
}

export type TodoSource = 'manual' | 'jira';

export interface Todo {
  id: number;
  source: TodoSource;
  sourceId: string | null;
  text: string;
  body: string;
  url: string | null;
  projectId: number | null;
  canPromote: boolean;
  done: boolean;
  promotedTicketId: number | null;
  createdAt: string;
}

export type TicketSource = 'sentry' | 'github' | 'jira';
export type TicketStatus = 'new' | 'sparring' | 'in_review' | 'done' | 'needs_attention';

export interface Ticket {
  id: number;
  source: TicketSource;
  sourceId: string;
  projectId: number;
  title: string;
  body: string;
  url: string;
  analysis: Analysis | null;
  status: TicketStatus;
  prId: number | null;
  createdAt: string;
}

export interface TicketMessage {
  id: number;
  ticketId: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export type PrStatus = 'open' | 'needs_attention' | 'merged';

export interface Pr {
  id: number;
  ticketId: number;
  projectId: number;
  branch: string;
  number: number | null;
  url: string | null;
  status: PrStatus;
  lastReviewScore: number | null;
  createdAt: string;
}

export interface PrMessage {
  id: number;
  prId: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export type JobType = 'triage' | 'spar' | 'fix' | 'pr-chat' | 'merge';
export type JobTargetType = 'ticket' | 'pr';
export type JobStatus = 'running' | 'done' | 'failed' | 'interrupted';

export interface Job {
  id: number;
  type: JobType;
  targetType: JobTargetType;
  targetId: number;
  status: JobStatus;
  error: string | null;
  createdAt: string;
}

export interface Analysis {
  summary: string;
  rootCause: string;
  proposedFix: string;
  affectedFiles: string[];
  confidence: 'low' | 'medium' | 'high';
}

export interface ReviewScore {
  correctness: number;
  completeness: number;
  quality: number;
  tests: number;
  regressionRisk: number;
  findings: string[];
}

export interface SourceIssue {
  source: TicketSource;
  sourceId: string;
  title: string;
  url: string;
  body: string;
  projectKey: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd engine && pnpm typecheck`
Expected: no errors (nothing imports this file yet, but it must compile standalone).

- [ ] **Step 3: Commit**

```bash
cd engine && git add src/types.ts
git commit -m "Add shared engine types"
```

---

### Task 3: SQLite schema and db module

**Files:**
- Create: `engine/src/db.ts`
- Test: `engine/tests/db.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `openDb(path: string): Database.Database` — every later module that touches storage calls this to get a `better-sqlite3` handle with the schema already applied. `DB_PATH: string` — the default path `~/.workbench/workbench.db`, used by `index.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/db.test.ts
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
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toEqual([
      'jobs', 'pr_messages', 'prs', 'projects', 'ticket_messages', 'tickets', 'todos',
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/db.test.ts`
Expected: FAIL — `Cannot find module '../src/db.js'`.

- [ ] **Step 3: Write `engine/src/db.ts`**

```ts
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
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pr_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id INTEGER NOT NULL REFERENCES prs(id),
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

export function openDb(path: string = DB_PATH): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/db.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/db.ts tests/db.test.ts
git commit -m "Add SQLite schema and db module"
```

---

### Task 4: Keychain module

**Files:**
- Create: `engine/src/keychain.ts`
- Test: `engine/tests/keychain.test.ts`

**Interfaces:**
- Consumes: `execa` from `'execa'`.
- Produces: `setSecret(account: string, value: string): Promise<void>`, `getSecret(account: string): Promise<string | null>`, `deleteSecret(account: string): Promise<void>`, `getOrCreateApiToken(): Promise<string>` — the API auth middleware (Task 20) and every source adapter (Tasks 11-13) read credentials through `getSecret`.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/keychain.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { execa } from 'execa';
import { setSecret, getSecret, deleteSecret } from '../src/keychain.js';

vi.mock('execa');

afterEach(() => vi.clearAllMocks());

describe('keychain', () => {
  it('setSecret shells out to security add-generic-password with -U to update', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    await setSecret('jira-token', 'abc123');
    expect(execa).toHaveBeenCalledWith('security', [
      'add-generic-password',
      '-U',
      '-s', 'workbench',
      '-a', 'jira-token',
      '-w', 'abc123',
    ]);
  });

  it('getSecret returns the password when found', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: 'abc123\n' } as any);
    const value = await getSecret('jira-token');
    expect(value).toBe('abc123');
    expect(execa).toHaveBeenCalledWith('security', [
      'find-generic-password',
      '-s', 'workbench',
      '-a', 'jira-token',
      '-w',
    ]);
  });

  it('getSecret returns null when not found', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.'));
    const value = await getSecret('missing');
    expect(value).toBeNull();
  });

  it('deleteSecret shells out to security delete-generic-password', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    await deleteSecret('jira-token');
    expect(execa).toHaveBeenCalledWith('security', [
      'delete-generic-password',
      '-s', 'workbench',
      '-a', 'jira-token',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/keychain.test.ts`
Expected: FAIL — `Cannot find module '../src/keychain.js'`.

- [ ] **Step 3: Write `engine/src/keychain.ts`**

```ts
import { execa } from 'execa';
import { randomBytes } from 'node:crypto';

const SERVICE = 'workbench';

export async function setSecret(account: string, value: string): Promise<void> {
  await execa('security', [
    'add-generic-password',
    '-U',
    '-s', SERVICE,
    '-a', account,
    '-w', value,
  ]);
}

export async function getSecret(account: string): Promise<string | null> {
  try {
    const { stdout } = await execa('security', [
      'find-generic-password',
      '-s', SERVICE,
      '-a', account,
      '-w',
    ]);
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function deleteSecret(account: string): Promise<void> {
  await execa('security', [
    'delete-generic-password',
    '-s', SERVICE,
    '-a', account,
  ]);
}

export async function getOrCreateApiToken(): Promise<string> {
  const existing = await getSecret('api-token');
  if (existing) return existing;
  const token = randomBytes(32).toString('hex');
  await setSecret('api-token', token);
  return token;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/keychain.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/keychain.ts tests/keychain.test.ts
git commit -m "Add Keychain-backed secret storage"
```

---

### Task 5: Projects CRUD

**Files:**
- Create: `engine/src/projects.ts`
- Test: `engine/tests/projects.test.ts`

**Interfaces:**
- Consumes: `Database.Database` from `better-sqlite3` (passed in, not imported globally — every function here takes `db` as its first argument so tests can pass an in-memory instance).
- Produces: `listProjects(db)`, `getProject(db, id)`, `createProject(db, input)`, `updateProject(db, id, input)`, `deleteProject(db, id)` — the Projects settings API route (Task 21) and the poller (Task 20) both call these.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/projects.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { listProjects, getProject, createProject, updateProject, deleteProject } from '../src/projects.js';

let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
});

describe('projects', () => {
  it('creates and lists a project', () => {
    const created = createProject(db, {
      name: 'acv-website',
      repoPath: '/repos/acv-website',
      defaultBranch: 'main',
      githubRepo: 'linku/acv-website',
      jiraProjectKey: 'ACV',
      sentryProjectSlug: 'acv-frontend',
    });
    expect(created.id).toBeTypeOf('number');
    expect(listProjects(db)).toEqual([created]);
  });

  it('getProject returns null for unknown id', () => {
    expect(getProject(db, 999)).toBeNull();
  });

  it('updateProject changes fields and preserves the rest', () => {
    const created = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    const updated = updateProject(db, created.id, { defaultBranch: 'develop' });
    expect(updated).toEqual({ ...created, defaultBranch: 'develop' });
  });

  it('deleteProject removes it', () => {
    const created = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    deleteProject(db, created.id);
    expect(getProject(db, created.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/projects.test.ts`
Expected: FAIL — `Cannot find module '../src/projects.js'`.

- [ ] **Step 3: Write `engine/src/projects.ts`**

```ts
import type Database from 'better-sqlite3';
import type { Project } from './types.js';

function rowToProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    repoPath: row.repo_path,
    defaultBranch: row.default_branch,
    githubRepo: row.github_repo,
    jiraProjectKey: row.jira_project_key,
    sentryProjectSlug: row.sentry_project_slug,
  };
}

export function listProjects(db: Database.Database): Project[] {
  return db.prepare('SELECT * FROM projects ORDER BY name').all().map(rowToProject);
}

export function getProject(db: Database.Database, id: number): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  return row ? rowToProject(row) : null;
}

export interface ProjectInput {
  name: string;
  repoPath: string;
  defaultBranch: string;
  githubRepo: string | null;
  jiraProjectKey: string | null;
  sentryProjectSlug: string | null;
}

export function createProject(db: Database.Database, input: ProjectInput): Project {
  const result = db
    .prepare(
      `INSERT INTO projects (name, repo_path, default_branch, github_repo, jira_project_key, sentry_project_slug)
       VALUES (@name, @repoPath, @defaultBranch, @githubRepo, @jiraProjectKey, @sentryProjectSlug)`
    )
    .run(input);
  return getProject(db, Number(result.lastInsertRowid))!;
}

export function updateProject(
  db: Database.Database,
  id: number,
  input: Partial<ProjectInput>
): Project | null {
  const current = getProject(db, id);
  if (!current) return null;
  const merged = { ...current, ...input };
  db.prepare(
    `UPDATE projects SET name = @name, repo_path = @repoPath, default_branch = @defaultBranch,
     github_repo = @githubRepo, jira_project_key = @jiraProjectKey, sentry_project_slug = @sentryProjectSlug
     WHERE id = @id`
  ).run({ ...merged, repoPath: merged.repoPath, defaultBranch: merged.defaultBranch, id });
  return getProject(db, id);
}

export function deleteProject(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/projects.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/projects.ts tests/projects.test.ts
git commit -m "Add projects CRUD"
```

---

### Task 6: Headless Claude subprocess runner

Ported from issue-agent's `src/claude.ts` verbatim, minus the `.env`-file-based secret stripping (Workbench has no `.env` file — secrets live in Keychain and are never placed on `process.env`, so there is nothing there to strip beyond defense-in-depth for the handful of variable names issue-agent already knew about).

**Files:**
- Create: `engine/src/claude.ts`
- Test: `engine/tests/claude.test.ts`

**Interfaces:**
- Consumes: `execa` from `'execa'`.
- Produces: `runClaude(opts: ClaudeCallOptions): Promise<string>`, `extractJson<T>(text: string): T | null`, `claudeJson<T>(opts, validate): Promise<T>` — every Claude-invoking module (analyze, implement, review, ticketChat, prChat) calls these.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/claude.test.ts
import { describe, expect, it } from 'vitest';
import { runClaude, extractJson, claudeJson } from '../src/claude.js';

describe('runClaude', () => {
  it('passes prompt and allowedTools through to the binary', async () => {
    const out = await runClaude({ cwd: process.cwd(), prompt: 'hello', allowedTools: ['Read'], binary: 'echo' });
    expect(out).toContain('hello');
    expect(out).toContain('--allowedTools Read');
  });

  it('strips known secret env vars from the subprocess', async () => {
    process.env.JIRA_API_TOKEN = 'super-secret';
    const out = await runClaude({
      cwd: process.cwd(),
      prompt: 'typeof process.env.JIRA_API_TOKEN',
      allowedTools: [],
      binary: 'node',
    });
    expect(out.trim()).toBe('undefined');
    delete process.env.JIRA_API_TOKEN;
  });
});

describe('extractJson', () => {
  it('extracts a balanced JSON object out of surrounding prose', () => {
    const text = 'Here is the result: {"a": 1, "note": "use {braces} carefully"} — done.';
    expect(extractJson(text)).toEqual({ a: 1, note: 'use {braces} carefully' });
  });

  it('returns null when nothing parses', () => {
    expect(extractJson('no json here')).toBeNull();
  });
});

describe('claudeJson', () => {
  it('throws after 2 failed attempts', async () => {
    await expect(
      claudeJson(
        { cwd: process.cwd(), prompt: 'not json', allowedTools: [], binary: 'echo' },
        (v: any): v is any => false
      )
    ).rejects.toThrow('Claude did not return valid JSON after 2 attempts');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/claude.test.ts`
Expected: FAIL — `Cannot find module '../src/claude.js'`.

- [ ] **Step 3: Write `engine/src/claude.ts`**

```ts
import { execa } from 'execa';

const SECRET_ENV_VARS = ['JIRA_API_TOKEN', 'JIRA_EMAIL', 'JIRA_BASE_URL', 'SENTRY_AUTH_TOKEN', 'WORKBENCH_API_TOKEN'];

function subprocessEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const name of SECRET_ENV_VARS) delete env[name];
  return env;
}

export interface ClaudeCallOptions {
  cwd: string;
  prompt: string;
  allowedTools: string[];
  timeoutMs?: number;
  binary?: string;
}

export async function runClaude(opts: ClaudeCallOptions): Promise<string> {
  const args = ['-p', opts.prompt];
  const binary = opts.binary ?? 'claude';

  if (binary === 'node') {
    args.push('--', '--allowedTools', opts.allowedTools.join(','), '--output-format', 'text');
  } else {
    args.push('--allowedTools', opts.allowedTools.join(','), '--output-format', 'text');
  }

  const { stdout } = await execa(binary, args, {
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? 15 * 60 * 1000,
    env: subprocessEnv(),
    extendEnv: false,
  });
  return stdout;
}

export function extractJson<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const candidates: string[] = [text.slice(start, end + 1)];
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i <= end; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) { candidates.push(text.slice(start, i + 1)); break; }
    }
  }
  for (const candidate of candidates) {
    try { return JSON.parse(candidate) as T; } catch { /* try next candidate */ }
  }
  return null;
}

export async function claudeJson<T>(
  opts: ClaudeCallOptions,
  validate: (v: any) => v is T
): Promise<T> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const output = await runClaude(opts);
    const parsed = extractJson<T>(output);
    if (parsed !== null && validate(parsed)) return parsed;
  }
  throw new Error('Claude did not return valid JSON after 2 attempts');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/claude.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/claude.ts tests/claude.test.ts
git commit -m "Add headless Claude subprocess runner"
```

---

### Task 7: Git/worktree/PR module, with new mergePr

Ported from issue-agent's `src/git.ts` verbatim, plus a new `mergePr` function — the explicit, user-triggered merge capability issue-agent deliberately never had.

**Files:**
- Create: `engine/src/git.ts`
- Test: `engine/tests/git.test.ts`

**Interfaces:**
- Consumes: `execa` from `'execa'`, `Project` from `./types.js`.
- Produces: `worktreePathFor`, `createFixWorktree`, `openWorktree`, `removeWorktree`, `commitAll`, `pushBranch`, `getDiff`, `createPr`, `markPrDraft`, `mergePr` — `fixPipeline.ts` (Task 15) and `prChat.ts` (Task 17) call these. `createFixWorktree` bases a **new** branch off the project's default branch (first implementation of a ticket); `openWorktree` reopens an **existing** branch at its current pushed tip (resuming work on a PR after its worktree was cleaned up) — using `createFixWorktree` for the latter would discard the PR's commits by resetting to the default branch.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/git.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { execa } from 'execa';
import { worktreePathFor, mergePr, openWorktree } from '../src/git.js';

vi.mock('execa');
afterEach(() => vi.clearAllMocks());

describe('worktreePathFor', () => {
  it('replaces slashes in the branch name for the directory name', () => {
    expect(worktreePathFor('/repos/demo', 'fix/lin-7')).toBe('/repos/demo/.worktrees/fix-lin-7');
  });
});

describe('mergePr', () => {
  it('runs gh pr merge with --squash in the worktree', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    await mergePr('/repos/demo/.worktrees/fix-lin-7');
    expect(execa).toHaveBeenCalledWith('gh', ['pr', 'merge', '--squash', '--delete-branch'], {
      cwd: '/repos/demo/.worktrees/fix-lin-7',
    });
  });
});

describe('openWorktree', () => {
  it('fetches and bases the worktree off the existing branch, not the default branch', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    const project = { id: 1, name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main', githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null };
    const path = await openWorktree(project, 'fix/gh-demo-1');
    expect(path).toBe('/repos/demo/.worktrees/fix-gh-demo-1');
    expect(execa).toHaveBeenCalledWith('git', ['fetch', 'origin', 'fix/gh-demo-1'], { cwd: '/repos/demo' });
    expect(execa).toHaveBeenCalledWith('git', ['worktree', 'add', '-B', 'fix/gh-demo-1', path, 'origin/fix/gh-demo-1'], { cwd: '/repos/demo' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/git.test.ts`
Expected: FAIL — `Cannot find module '../src/git.js'`.

- [ ] **Step 3: Write `engine/src/git.ts`**

```ts
import { execa } from 'execa';
import { join } from 'node:path';
import type { Project } from './types.js';

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd });
  return stdout;
}

export function worktreePathFor(repoPath: string, branch: string): string {
  return join(repoPath, '.worktrees', branch.replace(/\//g, '-'));
}

export async function createFixWorktree(project: Project, branch: string): Promise<string> {
  const path = worktreePathFor(project.repoPath, branch);
  await git(project.repoPath, ['fetch', 'origin', project.defaultBranch]);
  await git(project.repoPath, ['worktree', 'remove', '--force', path]).catch(() => {});
  await git(project.repoPath, ['worktree', 'add', '-B', branch, path, `origin/${project.defaultBranch}`]);
  return path;
}

export async function openWorktree(project: Project, branch: string): Promise<string> {
  const path = worktreePathFor(project.repoPath, branch);
  await git(project.repoPath, ['fetch', 'origin', branch]);
  await git(project.repoPath, ['worktree', 'remove', '--force', path]).catch(() => {});
  await git(project.repoPath, ['worktree', 'add', '-B', branch, path, `origin/${branch}`]);
  return path;
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  await git(repoPath, ['worktree', 'remove', '--force', worktreePath]).catch(() => {});
}

export async function commitAll(worktreePath: string, message: string): Promise<boolean> {
  await git(worktreePath, ['add', '-A']);
  const status = await git(worktreePath, ['status', '--porcelain']);
  if (!status.trim()) return false;
  await git(worktreePath, ['commit', '-m', message]);
  return true;
}

export async function pushBranch(worktreePath: string, branch: string): Promise<void> {
  await git(worktreePath, ['push', '-u', 'origin', branch, '--force-with-lease']);
}

export async function getDiff(worktreePath: string, defaultBranch: string): Promise<string> {
  return git(worktreePath, ['diff', `origin/${defaultBranch}...HEAD`]);
}

export async function createPr(
  worktreePath: string,
  title: string,
  body: string,
  baseBranch: string
): Promise<string> {
  try {
    const { stdout } = await execa(
      'gh',
      ['pr', 'create', '--title', title, '--body', body, '--base', baseBranch],
      { cwd: worktreePath }
    );
    const match = stdout.match(/https:\/\/github\.com\/[^\s)]+/);
    return match ? match[0] : stdout.trim();
  } catch (err) {
    const existing = await execa('gh', ['pr', 'view', '--json', 'url', '-q', '.url'], {
      cwd: worktreePath,
    }).catch(() => null);
    if (!existing) throw err;
    await execa('gh', ['pr', 'ready'], { cwd: worktreePath }).catch(() => {});
    return existing.stdout.trim();
  }
}

export async function markPrDraft(worktreePath: string): Promise<void> {
  await execa('gh', ['pr', 'ready', '--undo'], { cwd: worktreePath });
}

export async function mergePr(worktreePath: string): Promise<void> {
  await execa('gh', ['pr', 'merge', '--squash', '--delete-branch'], { cwd: worktreePath });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/git.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/git.ts tests/git.test.ts
git commit -m "Add git/worktree/PR module with mergePr"
```

---

### Task 8: Review scoring module (rubric + review)

Ported from issue-agent's `src/rubric.ts` and `src/review.ts` verbatim, with `AgentTicket` replaced by the local `Ticket` type.

**Files:**
- Create: `engine/src/review.ts`
- Test: `engine/tests/review.test.ts`

**Interfaces:**
- Consumes: `claudeJson`, `ClaudeCallOptions` from `./claude.js`; `Ticket`, `ReviewScore` from `./types.js`.
- Produces: `averageScore(s: ReviewScore): number`, `reviewPasses(s: ReviewScore): boolean`, `isReviewScore(v: any): v is ReviewScore`, `buildReviewPrompt(ticket: Ticket, diff: string): string`, `reviewDiff(worktreePath: string, ticket: Ticket, diff: string): Promise<ReviewScore>` — `fixPipeline.ts` (Task 15) drives the review loop with these.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/review.test.ts
import { describe, expect, it } from 'vitest';
import { averageScore, reviewPasses, isReviewScore, buildReviewPrompt } from '../src/review.js';
import type { Ticket, ReviewScore } from '../src/types.js';

const ticket: Ticket = {
  id: 1, source: 'github', sourceId: 'GH-1', projectId: 1, title: 'Fix null check',
  body: 'desc', url: 'https://x', analysis: null, status: 'in_review', prId: 1, createdAt: '2026-01-01',
};

describe('averageScore / reviewPasses', () => {
  it('averages the 5 dimensions', () => {
    const s: ReviewScore = { correctness: 5, completeness: 5, quality: 5, tests: 5, regressionRisk: 5, findings: [] };
    expect(averageScore(s)).toBe(5);
  });

  it('fails when correctness is below 4 even if the average is high', () => {
    const s: ReviewScore = { correctness: 3, completeness: 5, quality: 5, tests: 5, regressionRisk: 5, findings: [] };
    expect(averageScore(s)).toBe(4.6);
    expect(reviewPasses(s)).toBe(false);
  });

  it('passes at exactly the 4/4 boundary', () => {
    const s: ReviewScore = { correctness: 4, completeness: 4, quality: 4, tests: 4, regressionRisk: 4, findings: [] };
    expect(reviewPasses(s)).toBe(true);
  });
});

describe('isReviewScore', () => {
  it('accepts a well-formed score', () => {
    expect(isReviewScore({ correctness: 4, completeness: 4, quality: 4, tests: 4, regressionRisk: 4, findings: [] })).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(isReviewScore({ correctness: 4 })).toBe(false);
  });
});

describe('buildReviewPrompt', () => {
  it('embeds the diff and the rubric dimensions', () => {
    const prompt = buildReviewPrompt(ticket, '--- a/x.ts\n+++ b/x.ts');
    expect(prompt).toContain('--- a/x.ts');
    expect(prompt).toContain('correctness');
    expect(prompt).toContain('regressionRisk');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/review.test.ts`
Expected: FAIL — `Cannot find module '../src/review.js'`.

- [ ] **Step 3: Write `engine/src/review.ts`**

```ts
import { claudeJson } from './claude.js';
import type { Ticket, ReviewScore } from './types.js';

const DIMENSIONS = ['correctness', 'completeness', 'quality', 'tests', 'regressionRisk'] as const;

export function averageScore(s: ReviewScore): number {
  return DIMENSIONS.reduce((sum, d) => sum + s[d], 0) / DIMENSIONS.length;
}

export function reviewPasses(s: ReviewScore): boolean {
  return averageScore(s) >= 4 && s.correctness >= 4;
}

export function isReviewScore(v: any): v is ReviewScore {
  return (
    v &&
    DIMENSIONS.every((d) => typeof v[d] === 'number') &&
    Array.isArray(v.findings)
  );
}

export function buildReviewPrompt(ticket: Ticket, diff: string): string {
  return `You are a strict code reviewer. A fix was implemented for this ticket:

Title: ${ticket.title}
${ticket.body}

Diff:
${diff}

Score each dimension 1 to 5, where 5 is best. For regressionRisk, 5 means very low risk of breaking existing behavior.
Return ONLY JSON: {"correctness": n, "completeness": n, "quality": n, "tests": n, "regressionRisk": n, "findings": ["..."]}`;
}

export async function reviewDiff(worktreePath: string, ticket: Ticket, diff: string): Promise<ReviewScore> {
  return claudeJson(
    { cwd: worktreePath, prompt: buildReviewPrompt(ticket, diff), allowedTools: ['Read'], timeoutMs: 15 * 60 * 1000 },
    isReviewScore
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/review.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/review.ts tests/review.test.ts
git commit -m "Add review scoring module"
```

---

### Task 9: Analyze module

Ported from issue-agent's `src/analyze.ts`, with `SourceIssue`/`Project` swapped for the local types.

**Files:**
- Create: `engine/src/analyze.ts`
- Test: `engine/tests/analyze.test.ts`

**Interfaces:**
- Consumes: `claudeJson` from `./claude.js`; `SourceIssue`, `Project`, `Analysis` from `./types.js`.
- Produces: `isAnalysis(v: any): v is Analysis`, `buildAnalyzePrompt(issue: SourceIssue): string`, `analyzeIssue(issue: SourceIssue, project: Project): Promise<Analysis>` — the poller (Task 20) calls `analyzeIssue` on every new Sentry/GitHub issue and on any Jira todo promoted via "Start fixing this".

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/analyze.test.ts
import { describe, expect, it } from 'vitest';
import { isAnalysis, buildAnalyzePrompt } from '../src/analyze.js';
import type { SourceIssue } from '../src/types.js';

const issue: SourceIssue = {
  source: 'github', sourceId: 'GH-linku/demo#1', title: 'Crash on null user',
  url: 'https://github.com/linku/demo/issues/1', body: 'TypeError: user is null', projectKey: 'linku/demo',
};

describe('isAnalysis', () => {
  it('accepts a well-formed analysis', () => {
    expect(isAnalysis({
      summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: ['a.ts'], confidence: 'high',
    })).toBe(true);
  });

  it('rejects a missing confidence field', () => {
    expect(isAnalysis({ summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: [] })).toBe(false);
  });
});

describe('buildAnalyzePrompt', () => {
  it('embeds the issue title and body', () => {
    const prompt = buildAnalyzePrompt(issue);
    expect(prompt).toContain('Crash on null user');
    expect(prompt).toContain('TypeError: user is null');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/analyze.test.ts`
Expected: FAIL — `Cannot find module '../src/analyze.js'`.

- [ ] **Step 3: Write `engine/src/analyze.ts`**

```ts
import { claudeJson } from './claude.js';
import type { SourceIssue, Project, Analysis } from './types.js';

export function isAnalysis(v: any): v is Analysis {
  return (
    v &&
    typeof v.summary === 'string' &&
    typeof v.rootCause === 'string' &&
    typeof v.proposedFix === 'string' &&
    Array.isArray(v.affectedFiles) &&
    ['low', 'medium', 'high'].includes(v.confidence)
  );
}

export function buildAnalyzePrompt(issue: SourceIssue): string {
  return `Analyze this issue read-only, do not make any changes.

Title: ${issue.title}
Body: ${issue.body}

Return ONLY JSON: {"summary": "...", "rootCause": "...", "proposedFix": "...", "affectedFiles": ["..."], "confidence": "low"|"medium"|"high"}`;
}

export async function analyzeIssue(issue: SourceIssue, project: Project): Promise<Analysis> {
  return claudeJson(
    { cwd: project.repoPath, prompt: buildAnalyzePrompt(issue), allowedTools: ['Read', 'Grep', 'Glob'], timeoutMs: 15 * 60 * 1000 },
    isAnalysis
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/analyze.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/analyze.ts tests/analyze.test.ts
git commit -m "Add analyze module"
```

---

### Task 10: Implement module

Ported from issue-agent's `src/implement.ts`, extended to fold a ticket's sparring chat transcript into the prompt as implementation guidance — issue-agent had no chat step, so this is new relative to the source, but the shape (findings-on-retry) is unchanged.

**Files:**
- Create: `engine/src/implement.ts`
- Test: `engine/tests/implement.test.ts`

**Interfaces:**
- Consumes: `runClaude` from `./claude.js`; `Ticket`, `TicketMessage` from `./types.js`.
- Produces: `buildImplementPrompt(ticket: Ticket, messages: TicketMessage[], findings?: string[]): string`, `implementFix(worktreePath: string, ticket: Ticket, messages: TicketMessage[], findings?: string[]): Promise<void>` — `fixPipeline.ts` (Task 15) calls this on the first attempt and on each retry.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/implement.test.ts
import { describe, expect, it } from 'vitest';
import { buildImplementPrompt } from '../src/implement.js';
import type { Ticket, TicketMessage } from '../src/types.js';

const ticket: Ticket = {
  id: 1, source: 'github', sourceId: 'GH-1', projectId: 1, title: 'Fix null check',
  body: 'desc', url: 'https://x', analysis: null, status: 'sparring', prId: null, createdAt: '2026-01-01',
};

const messages: TicketMessage[] = [
  { id: 1, ticketId: 1, role: 'user', content: 'cap the backoff at 30s', createdAt: '2026-01-01' },
  { id: 2, ticketId: 1, role: 'assistant', content: 'Got it, capped at 30s.', createdAt: '2026-01-01' },
];

describe('buildImplementPrompt', () => {
  it('includes the ticket title and the chat transcript', () => {
    const prompt = buildImplementPrompt(ticket, messages);
    expect(prompt).toContain('Fix null check');
    expect(prompt).toContain('cap the backoff at 30s');
    expect(prompt).toContain('Got it, capped at 30s.');
  });

  it('includes reviewer findings on a retry', () => {
    const prompt = buildImplementPrompt(ticket, messages, ['missing null guard on email field']);
    expect(prompt).toContain('missing null guard on email field');
  });

  it('omits the findings section when there are none', () => {
    const prompt = buildImplementPrompt(ticket, messages, []);
    expect(prompt).not.toContain('Reviewer findings');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/implement.test.ts`
Expected: FAIL — `Cannot find module '../src/implement.js'`.

- [ ] **Step 3: Write `engine/src/implement.ts`**

```ts
import { runClaude } from './claude.js';
import type { Ticket, TicketMessage } from './types.js';

export function buildImplementPrompt(ticket: Ticket, messages: TicketMessage[], findings: string[] = []): string {
  const transcript = messages.map((m) => `${m.role === 'user' ? 'You' : 'Claude'}: ${m.content}`).join('\n');
  const findingsBlock =
    findings.length > 0 ? `\n\nReviewer findings to address:\n${findings.map((f) => `- ${f}`).join('\n')}` : '';
  return `Implement a fix for this ticket.

Title: ${ticket.title}
${ticket.body}

Discussion so far:
${transcript}
${findingsBlock}

Make the changes directly in this working tree. Do not commit or push.`;
}

export async function implementFix(
  worktreePath: string,
  ticket: Ticket,
  messages: TicketMessage[],
  findings: string[] = []
): Promise<void> {
  await runClaude({
    cwd: worktreePath,
    prompt: buildImplementPrompt(ticket, messages, findings),
    allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    timeoutMs: 30 * 60 * 1000,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/implement.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/implement.ts tests/implement.test.ts
git commit -m "Add implement module with chat-transcript guidance"
```

---

### Task 11: Jira source adapter (merged)

This merges two adapters that did overlapping work: issue-agent's `src/sources/jira.ts` (JQL filtered to configured projects, fetches `description` for analysis, converts Atlassian Document Format to text) and work-tracker's `src/sources/jira.ts` (broader JQL — every open issue assigned to the user, paginated, but only fetches `summary`). Workbench needs the union: every open assigned issue (for the Today todo list) with enough body text to analyze immediately if promoted via "Start fixing this" (no second API call). So this task fetches the **broader** query but requests `summary,description,project` fields, and applies issue-agent's ADF-to-text conversion. Whether an issue's project has a repo mapping (and can therefore show "Start fixing this") is a separate, pure lookup the poller does afterward (Task 19) — it is not part of this adapter's job.

**Files:**
- Create: `engine/src/sources/jira.ts`
- Test: `engine/tests/sources/jira.test.ts`

**Interfaces:**
- Consumes: `getSecret` from `../keychain.js`; `SourceIssue` from `../types.js`.
- Produces: `adfToText(node: any): string`, `mapJiraIssue(raw: any, baseUrl: string): SourceIssue`, `fetchAssignedJiraIssues(): Promise<SourceIssue[]>` — the poller (Task 20) calls `fetchAssignedJiraIssues` every cycle.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/sources/jira.test.ts
import { describe, expect, it } from 'vitest';
import { adfToText, mapJiraIssue } from '../../src/sources/jira.js';

describe('adfToText', () => {
  it('joins paragraph text nodes with newlines', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
      ],
    };
    expect(adfToText(doc).trim()).toBe('First line\nSecond line');
  });
});

describe('mapJiraIssue', () => {
  it('maps a plain string description', () => {
    const raw = { key: 'ACV-12', fields: { summary: 'Fix login redirect', description: 'Redirect loops on logout.', project: { key: 'ACV' } } };
    const issue = mapJiraIssue(raw, 'https://x.atlassian.net');
    expect(issue).toEqual({
      source: 'jira', sourceId: 'JIRA-ACV-12', title: '[ACV-12] Fix login redirect',
      url: 'https://x.atlassian.net/browse/ACV-12', body: 'Redirect loops on logout.', projectKey: 'ACV',
    });
  });

  it('converts an ADF description', () => {
    const raw = {
      key: 'ACV-13',
      fields: {
        summary: 'Crash on save', project: { key: 'ACV' },
        description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Stack trace attached.' }] }] },
      },
    };
    expect(mapJiraIssue(raw, 'https://x.atlassian.net').body.trim()).toBe('Stack trace attached.');
  });

  it('returns an empty body when description is null', () => {
    const raw = { key: 'ACV-14', fields: { summary: 'No description', description: null, project: { key: 'ACV' } } };
    expect(mapJiraIssue(raw, 'https://x.atlassian.net').body).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/sources/jira.test.ts`
Expected: FAIL — `Cannot find module '../../src/sources/jira.js'`.

- [ ] **Step 3: Write `engine/src/sources/jira.ts`**

```ts
import { getSecret } from '../keychain.js';
import type { SourceIssue } from '../types.js';

export function adfToText(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  let out = (node.content ?? []).map(adfToText).join('');
  if (['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(node.type)) out += '\n';
  return out;
}

export function mapJiraIssue(raw: any, baseUrl: string): SourceIssue {
  const description = raw.fields.description;
  const body = typeof description === 'string' ? description : description ? adfToText(description).trim() : '';
  return {
    source: 'jira',
    sourceId: `JIRA-${raw.key}`,
    title: `[${raw.key}] ${raw.fields.summary}`,
    url: `${baseUrl}/browse/${raw.key}`,
    body,
    projectKey: raw.fields.project.key,
  };
}

export async function fetchAssignedJiraIssues(): Promise<SourceIssue[]> {
  const baseUrl = (await getSecret('jira-base-url'))?.replace(/\/$/, '');
  const email = await getSecret('jira-email');
  const token = await getSecret('jira-api-token');
  if (!baseUrl || !email || !token) return [];

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const jql = 'assignee = currentUser() AND statusCategory != Done';

  const issues: any[] = [];
  let nextPageToken: string | undefined;
  do {
    const params = new URLSearchParams({ jql, fields: 'summary,description,project', maxResults: '100' });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const res = await fetch(`${baseUrl}/rest/api/3/search/jql?${params}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) throw new Error(`Jira API error ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    issues.push(...data.issues);
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  return issues.map((raw) => mapJiraIssue(raw, baseUrl));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/sources/jira.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/sources/jira.ts tests/sources/jira.test.ts
git commit -m "Add merged Jira source adapter"
```

---

### Task 12: Sentry source adapter

Ported from issue-agent's `src/sources/sentry.ts` verbatim, reading the auth token from Keychain instead of `process.env.SENTRY_AUTH_TOKEN`, and taking a plain project-slug list instead of `ProjectConfig[]` (project-to-repo mapping is looked up separately once a ticket exists — see Task 19).

**Files:**
- Create: `engine/src/sources/sentry.ts`
- Test: `engine/tests/sources/sentry.test.ts`

**Interfaces:**
- Consumes: `getSecret` from `../keychain.js`; `SourceIssue` from `../types.js`.
- Produces: `mapSentryIssue(raw: any, projectKey: string, stack: string): SourceIssue`, `fetchSentryIssues(org: string, projectSlugs: string[]): Promise<SourceIssue[]>` — the poller (Task 20) calls this for every project with a `sentryProjectSlug`.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/sources/sentry.test.ts
import { describe, expect, it } from 'vitest';
import { mapSentryIssue } from '../../src/sources/sentry.js';

describe('mapSentryIssue', () => {
  it('assembles the body from event counts, first-seen, and stack', () => {
    const raw = { id: '123', permalink: 'https://sentry.io/x/123', count: 42, userCount: 7, firstSeen: '2026-01-01' };
    const issue = mapSentryIssue(raw, 'acv-frontend', 'auth.ts:10 in login');
    expect(issue.body).toBe('Events: 42, users affected: 7\n\nFirst seen: 2026-01-01\n\nauth.ts:10 in login');
    expect(issue.sourceId).toBe('SENTRY-123');
    expect(issue.projectKey).toBe('acv-frontend');
  });

  it('omits an empty stack section', () => {
    const raw = { id: '124', permalink: 'https://sentry.io/x/124', count: 1, userCount: 1, firstSeen: '2026-01-01' };
    const issue = mapSentryIssue(raw, 'acv-frontend', '');
    expect(issue.body).toBe('Events: 1, users affected: 1\n\nFirst seen: 2026-01-01');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/sources/sentry.test.ts`
Expected: FAIL — `Cannot find module '../../src/sources/sentry.js'`.

- [ ] **Step 3: Write `engine/src/sources/sentry.ts`**

```ts
import { getSecret } from '../keychain.js';
import type { SourceIssue } from '../types.js';

export function mapSentryIssue(raw: any, projectKey: string, stack: string): SourceIssue {
  const body = [
    `Events: ${raw.count}, users affected: ${raw.userCount}`,
    `First seen: ${raw.firstSeen}`,
    stack,
  ].filter(Boolean).join('\n\n');
  return {
    source: 'sentry',
    sourceId: `SENTRY-${raw.id}`,
    title: raw.title ?? raw.metadata?.title ?? `Sentry issue ${raw.id}`,
    url: raw.permalink,
    body,
    projectKey,
  };
}

async function fetchLatestStack(token: string, issueId: string): Promise<string> {
  try {
    const res = await fetch(`https://sentry.io/api/0/issues/${issueId}/events/latest/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return '';
    const data: any = await res.json();
    const exception = data.entries?.find((e: any) => e.type === 'exception');
    const frames = exception?.data?.values?.[0]?.stacktrace?.frames ?? [];
    return frames
      .slice(-10)
      .map((f: any) => `${f.filename}:${f.lineNo} in ${f.function}`)
      .join('\n');
  } catch {
    return '';
  }
}

export async function fetchSentryIssues(org: string, projectSlugs: string[]): Promise<SourceIssue[]> {
  const token = await getSecret('sentry-auth-token');
  if (!token || projectSlugs.length === 0) return [];

  const results: SourceIssue[] = [];
  for (const slug of projectSlugs) {
    const res = await fetch(
      `https://sentry.io/api/0/projects/${org}/${slug}/issues/?query=assigned:me is:unresolved`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Sentry API error ${res.status} for project ${slug}`);
    const raws: any[] = await res.json();
    for (const raw of raws) {
      const stack = await fetchLatestStack(token, raw.id);
      results.push(mapSentryIssue(raw, slug, stack));
    }
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/sources/sentry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/sources/sentry.ts tests/sources/sentry.test.ts
git commit -m "Add Sentry source adapter"
```

---

### Task 13: GitHub source adapter

Ported from issue-agent's `src/sources/github.ts` verbatim (it already relies on the ambient `gh auth status` login, no Keychain secret needed).

**Files:**
- Create: `engine/src/sources/github.ts`
- Test: `engine/tests/sources/github.test.ts`

**Interfaces:**
- Consumes: `execa` from `'execa'`; `SourceIssue` from `../types.js`.
- Produces: `mapGithubIssue(raw: any, repo: string): SourceIssue`, `fetchGithubIssues(repos: string[]): Promise<SourceIssue[]>` — the poller (Task 20) calls this for every project with a `githubRepo`.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/sources/github.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { execa } from 'execa';
import { mapGithubIssue, fetchGithubIssues } from '../../src/sources/github.js';

vi.mock('execa');
afterEach(() => vi.clearAllMocks());

describe('mapGithubIssue', () => {
  it('maps number, title, body, url', () => {
    const raw = { number: 42, title: 'Crash on save', body: 'Steps to reproduce...', url: 'https://github.com/linku/demo/issues/42' };
    expect(mapGithubIssue(raw, 'linku/demo')).toEqual({
      source: 'github', sourceId: 'GH-linku/demo#42', title: 'Crash on save',
      url: 'https://github.com/linku/demo/issues/42', body: 'Steps to reproduce...', projectKey: 'linku/demo',
    });
  });

  it('defaults a null body to an empty string', () => {
    const raw = { number: 1, title: 't', body: null, url: 'u' };
    expect(mapGithubIssue(raw, 'linku/demo').body).toBe('');
  });
});

describe('fetchGithubIssues', () => {
  it('shells out to gh search issues per repo and maps the results', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify([{ number: 1, title: 't', body: 'b', url: 'u' }]),
    } as any);
    const issues = await fetchGithubIssues(['linku/demo']);
    expect(execa).toHaveBeenCalledWith('gh', [
      'search', 'issues', '--assignee=@me', '--state=open', '--repo', 'linku/demo',
      '--json', 'number,title,body,url',
    ]);
    expect(issues).toEqual([{ source: 'github', sourceId: 'GH-linku/demo#1', title: 't', url: 'u', body: 'b', projectKey: 'linku/demo' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/sources/github.test.ts`
Expected: FAIL — `Cannot find module '../../src/sources/github.js'`.

- [ ] **Step 3: Write `engine/src/sources/github.ts`**

```ts
import { execa } from 'execa';
import type { SourceIssue } from '../types.js';

export function mapGithubIssue(raw: any, repo: string): SourceIssue {
  return {
    source: 'github',
    sourceId: `GH-${repo}#${raw.number}`,
    title: raw.title,
    url: raw.url,
    body: raw.body ?? '',
    projectKey: repo,
  };
}

export async function fetchGithubIssues(repos: string[]): Promise<SourceIssue[]> {
  const results: SourceIssue[] = [];
  for (const repo of repos) {
    try {
      const { stdout } = await execa('gh', [
        'search', 'issues', '--assignee=@me', '--state=open', '--repo', repo,
        '--json', 'number,title,body,url',
      ]);
      const raws = JSON.parse(stdout || '[]');
      results.push(...raws.map((raw: any) => mapGithubIssue(raw, repo)));
    } catch (err) {
      throw new Error(`GitHub fetch failed for ${repo}: ${String(err)}`);
    }
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/sources/github.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/sources/github.ts tests/sources/github.test.ts
git commit -m "Add GitHub source adapter"
```

---

### Task 14: Ticket and PR data access

New — issue-agent had no local ticket/PR storage (it wrote everything to Linear); this is the SQLite-backed replacement, following the same row-mapping pattern as `projects.ts` (Task 5).

**Files:**
- Create: `engine/src/tickets.ts`
- Create: `engine/src/prs.ts`
- Test: `engine/tests/tickets.test.ts`
- Test: `engine/tests/prs.test.ts`

**Interfaces:**
- Consumes: `Database.Database`; `Ticket`, `TicketMessage`, `Pr`, `PrMessage`, `Analysis` from `./types.js`.
- Produces: `getTicket`, `listTickets`, `findTicketBySource`, `createTicket`, `updateTicketStatus`, `listTicketMessages`, `addTicketMessage` from `tickets.ts`; `getPr`, `listPrs`, `recordPr`, `updatePrStatus`, `listPrMessages`, `addPrMessage` from `prs.ts`. `fixPipeline.ts` (Task 15), `ticketChat.ts` (Task 18), `prChat.ts` (Task 17), `poller.ts` (Task 19), and every API route (Tasks 21-22) use these.

- [ ] **Step 1: Write the failing tests**

```ts
// engine/tests/tickets.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import {
  createTicket, getTicket, findTicketBySource, updateTicketStatus,
  addTicketMessage, listTicketMessages, listTickets,
} from '../src/tickets.js';

let db: Database.Database;
let projectId: number;

beforeEach(() => {
  db = openDb(':memory:');
  projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
});

describe('tickets', () => {
  it('creates a ticket with analysis and reads it back', () => {
    const ticket = createTicket(db, {
      source: 'github', sourceId: 'GH-demo#1', projectId, title: 'Fix null check',
      body: 'desc', url: 'https://x',
      analysis: { summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: ['a.ts'], confidence: 'high' },
    });
    expect(ticket.status).toBe('new');
    expect(getTicket(db, ticket.id)).toEqual(ticket);
  });

  it('findTicketBySource dedups on source+sourceId', () => {
    const created = createTicket(db, {
      source: 'github', sourceId: 'GH-demo#1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
    });
    expect(findTicketBySource(db, 'github', 'GH-demo#1')).toEqual(created);
    expect(findTicketBySource(db, 'github', 'GH-demo#2')).toBeNull();
  });

  it('updateTicketStatus updates status and optionally links a PR', () => {
    const created = createTicket(db, {
      source: 'github', sourceId: 'GH-demo#1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
    });
    const updated = updateTicketStatus(db, created.id, 'in_review', 5);
    expect(updated).toEqual({ ...created, status: 'in_review', prId: 5 });
  });

  it('records and lists chat messages in order', () => {
    const created = createTicket(db, {
      source: 'github', sourceId: 'GH-demo#1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
    });
    addTicketMessage(db, created.id, 'user', 'cap it at 30s');
    addTicketMessage(db, created.id, 'assistant', 'done');
    const messages = listTicketMessages(db, created.id);
    expect(messages.map((m) => m.content)).toEqual(['cap it at 30s', 'done']);
  });

  it('listTickets filters by status', () => {
    createTicket(db, { source: 'github', sourceId: 'GH-demo#1', projectId, title: 't1', body: 'b', url: 'u', analysis: null });
    const t2 = createTicket(db, { source: 'github', sourceId: 'GH-demo#2', projectId, title: 't2', body: 'b', url: 'u', analysis: null });
    updateTicketStatus(db, t2.id, 'in_review', null);
    expect(listTickets(db, { status: 'in_review' }).map((t) => t.id)).toEqual([t2.id]);
  });
});
```

```ts
// engine/tests/prs.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket } from '../src/tickets.js';
import { recordPr, getPr, updatePrStatus, addPrMessage, listPrMessages } from '../src/prs.js';

let db: Database.Database;
let ticketId: number;
let projectId: number;

beforeEach(() => {
  db = openDb(':memory:');
  projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  ticketId = createTicket(db, {
    source: 'github', sourceId: 'GH-demo#1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
  }).id;
});

describe('prs', () => {
  it('records a PR and reads it back', () => {
    const pr = recordPr(db, {
      ticketId, projectId, branch: 'fix/gh-demo-1', number: 142, url: 'https://github.com/x/pull/142', status: 'open',
    });
    expect(getPr(db, pr.id)).toEqual(pr);
  });

  it('updatePrStatus sets status and review score', () => {
    const pr = recordPr(db, {
      ticketId, projectId, branch: 'fix/gh-demo-1', number: 142, url: 'https://github.com/x/pull/142', status: 'open',
    });
    const updated = updatePrStatus(db, pr.id, 'merged', 4.6);
    expect(updated).toEqual({ ...pr, status: 'merged', lastReviewScore: 4.6 });
  });

  it('records and lists chat messages in order', () => {
    const pr = recordPr(db, {
      ticketId, projectId, branch: 'fix/gh-demo-1', number: 142, url: 'https://github.com/x/pull/142', status: 'open',
    });
    addPrMessage(db, pr.id, 'user', 'also guard email');
    addPrMessage(db, pr.id, 'assistant', 'done, re-reviewed 4.8/5');
    expect(listPrMessages(db, pr.id).map((m) => m.content)).toEqual(['also guard email', 'done, re-reviewed 4.8/5']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && pnpm vitest run tests/tickets.test.ts tests/prs.test.ts`
Expected: FAIL — `Cannot find module '../src/tickets.js'` / `'../src/prs.js'`.

- [ ] **Step 3: Write `engine/src/tickets.ts`**

```ts
import type Database from 'better-sqlite3';
import type { Ticket, TicketMessage, TicketSource, TicketStatus, Analysis } from './types.js';

function rowToTicket(row: any): Ticket {
  return {
    id: row.id, source: row.source, sourceId: row.source_id, projectId: row.project_id,
    title: row.title, body: row.body, url: row.url,
    analysis: row.analysis_json ? JSON.parse(row.analysis_json) : null,
    status: row.status, prId: row.pr_id, createdAt: row.created_at,
  };
}

export function getTicket(db: Database.Database, id: number): Ticket | null {
  const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  return row ? rowToTicket(row) : null;
}

export function findTicketBySource(db: Database.Database, source: TicketSource, sourceId: string): Ticket | null {
  const row = db.prepare('SELECT * FROM tickets WHERE source = ? AND source_id = ?').get(source, sourceId);
  return row ? rowToTicket(row) : null;
}

export function listTickets(db: Database.Database, filter: { status?: TicketStatus } = {}): Ticket[] {
  if (filter.status) {
    return db.prepare('SELECT * FROM tickets WHERE status = ? ORDER BY created_at').all(filter.status).map(rowToTicket);
  }
  return db.prepare('SELECT * FROM tickets ORDER BY created_at').all().map(rowToTicket);
}

export interface CreateTicketInput {
  source: TicketSource;
  sourceId: string;
  projectId: number;
  title: string;
  body: string;
  url: string;
  analysis: Analysis | null;
}

export function createTicket(db: Database.Database, input: CreateTicketInput): Ticket {
  const result = db
    .prepare(
      `INSERT INTO tickets (source, source_id, project_id, title, body, url, analysis_json, created_at)
       VALUES (@source, @sourceId, @projectId, @title, @body, @url, @analysisJson, @createdAt)`
    )
    .run({
      ...input,
      analysisJson: input.analysis ? JSON.stringify(input.analysis) : null,
      createdAt: new Date().toISOString(),
    });
  return getTicket(db, Number(result.lastInsertRowid))!;
}

export function updateTicketStatus(
  db: Database.Database,
  id: number,
  status: TicketStatus,
  prId: number | null
): Ticket | null {
  db.prepare('UPDATE tickets SET status = ?, pr_id = ? WHERE id = ?').run(status, prId, id);
  return getTicket(db, id);
}

function rowToTicketMessage(row: any): TicketMessage {
  return { id: row.id, ticketId: row.ticket_id, role: row.role, content: row.content, createdAt: row.created_at };
}

export function listTicketMessages(db: Database.Database, ticketId: number): TicketMessage[] {
  return db
    .prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id')
    .all(ticketId)
    .map(rowToTicketMessage);
}

export function addTicketMessage(
  db: Database.Database,
  ticketId: number,
  role: 'user' | 'assistant',
  content: string
): TicketMessage {
  const result = db
    .prepare('INSERT INTO ticket_messages (ticket_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(ticketId, role, content, new Date().toISOString());
  return rowToTicketMessage(db.prepare('SELECT * FROM ticket_messages WHERE id = ?').get(result.lastInsertRowid));
}
```

- [ ] **Step 4: Write `engine/src/prs.ts`**

```ts
import type Database from 'better-sqlite3';
import type { Pr, PrMessage, PrStatus } from './types.js';

function rowToPr(row: any): Pr {
  return {
    id: row.id, ticketId: row.ticket_id, projectId: row.project_id, branch: row.branch,
    number: row.number, url: row.url, status: row.status,
    lastReviewScore: row.last_review_score, createdAt: row.created_at,
  };
}

export function getPr(db: Database.Database, id: number): Pr | null {
  const row = db.prepare('SELECT * FROM prs WHERE id = ?').get(id);
  return row ? rowToPr(row) : null;
}

export function listPrs(db: Database.Database, filter: { status?: PrStatus } = {}): Pr[] {
  if (filter.status) {
    return db.prepare('SELECT * FROM prs WHERE status = ? ORDER BY created_at').all(filter.status).map(rowToPr);
  }
  return db.prepare('SELECT * FROM prs ORDER BY created_at').all().map(rowToPr);
}

export interface RecordPrInput {
  ticketId: number;
  projectId: number;
  branch: string;
  number: number | null;
  url: string | null;
  status: PrStatus;
}

export function recordPr(db: Database.Database, input: RecordPrInput): Pr {
  const result = db
    .prepare(
      `INSERT INTO prs (ticket_id, project_id, branch, number, url, status, created_at)
       VALUES (@ticketId, @projectId, @branch, @number, @url, @status, @createdAt)`
    )
    .run({ ...input, createdAt: new Date().toISOString() });
  return getPr(db, Number(result.lastInsertRowid))!;
}

export function updatePrStatus(
  db: Database.Database,
  id: number,
  status: PrStatus,
  lastReviewScore: number | null
): Pr | null {
  db.prepare('UPDATE prs SET status = ?, last_review_score = ? WHERE id = ?').run(status, lastReviewScore, id);
  return getPr(db, id);
}

function rowToPrMessage(row: any): PrMessage {
  return { id: row.id, prId: row.pr_id, role: row.role, content: row.content, createdAt: row.created_at };
}

export function listPrMessages(db: Database.Database, prId: number): PrMessage[] {
  return db.prepare('SELECT * FROM pr_messages WHERE pr_id = ? ORDER BY id').all(prId).map(rowToPrMessage);
}

export function addPrMessage(db: Database.Database, prId: number, role: 'user' | 'assistant', content: string): PrMessage {
  const result = db
    .prepare('INSERT INTO pr_messages (pr_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(prId, role, content, new Date().toISOString());
  return rowToPrMessage(db.prepare('SELECT * FROM pr_messages WHERE id = ?').get(result.lastInsertRowid));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && pnpm vitest run tests/tickets.test.ts tests/prs.test.ts`
Expected: PASS (5 + 3 tests).

- [ ] **Step 6: Commit**

```bash
cd engine && git add src/tickets.ts src/prs.ts tests/tickets.test.ts tests/prs.test.ts
git commit -m "Add ticket and PR data access"
```

---

### Task 15: Fix pipeline orchestrator

New — replaces issue-agent's `fix.ts`/`fixTicket` (which wrote to Linear) with the same worktree/implement/review-loop logic driven off SQLite. Unlike issue-agent's own test suite (which left `fixTicket` untested and only covered its pure `passComment`/`failComment` helpers), this task mocks `git.ts`/`implement.ts`/`review.ts` to actually exercise the orchestration — the retry loop, the pass/fail branching, and cleanup.

**Files:**
- Create: `engine/src/fixPipeline.ts`
- Test: `engine/tests/fixPipeline.test.ts`

**Interfaces:**
- Consumes: `getProject` from `./projects.js`; `getTicket`, `listTicketMessages`, `updateTicketStatus` from `./tickets.js`; `recordPr`, `updatePrStatus`, `addPrMessage` from `./prs.js`; `createFixWorktree`, `removeWorktree`, `commitAll`, `pushBranch`, `getDiff`, `createPr`, `markPrDraft` from `./git.js`; `implementFix` from `./implement.js`; `reviewDiff`, `reviewPasses`, `averageScore` from `./review.js`.
- Produces: `runFixPipeline(db: Database.Database, ticketId: number): Promise<FixResult>` where `FixResult = { ticketStatus: 'in_review' | 'needs_attention'; prId: number }` — the "Create PR" API route (Task 22) calls this.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/fixPipeline.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket, getTicket } from '../src/tickets.js';
import { getPr, listPrMessages } from '../src/prs.js';
import * as git from '../src/git.js';
import * as implement from '../src/implement.js';
import * as review from '../src/review.js';
import { runFixPipeline, passComment, failComment } from '../src/fixPipeline.js';

vi.mock('../src/git.js');
vi.mock('../src/implement.js');
vi.mock('../src/review.js');

let db: Database.Database;
let ticketId: number;

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  const projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  ticketId = createTicket(db, {
    source: 'github', sourceId: 'GH-demo#1', projectId, title: 'Fix null check', body: 'b', url: 'u', analysis: null,
  }).id;

  vi.mocked(git.createFixWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-github-1');
  vi.mocked(git.commitAll).mockResolvedValue(true);
  vi.mocked(git.pushBranch).mockResolvedValue(undefined);
  vi.mocked(git.getDiff).mockResolvedValue('diff');
  vi.mocked(git.createPr).mockResolvedValue('https://github.com/x/pull/142');
  vi.mocked(git.removeWorktree).mockResolvedValue(undefined);
  vi.mocked(git.markPrDraft).mockResolvedValue(undefined);
  vi.mocked(implement.implementFix).mockResolvedValue(undefined);
});

describe('runFixPipeline', () => {
  it('marks the ticket in_review and records a passing PR on the first round', async () => {
    vi.mocked(review.reviewDiff).mockResolvedValue({
      correctness: 5, completeness: 5, quality: 5, tests: 5, regressionRisk: 5, findings: [],
    });
    vi.mocked(review.reviewPasses).mockReturnValue(true);
    vi.mocked(review.averageScore).mockReturnValue(5);

    const result = await runFixPipeline(db, ticketId);

    expect(result.ticketStatus).toBe('in_review');
    expect(getTicket(db, ticketId)!.status).toBe('in_review');
    expect(getPr(db, result.prId)!.status).toBe('open');
    expect(implement.implementFix).toHaveBeenCalledTimes(1);
    expect(git.removeWorktree).toHaveBeenCalledWith('/repos/demo', '/repos/demo/.worktrees/fix-github-1');
  });

  it('retries with findings then marks needs_attention after 3 failing rounds', async () => {
    vi.mocked(review.reviewDiff).mockResolvedValue({
      correctness: 3, completeness: 3, quality: 3, tests: 3, regressionRisk: 3, findings: ['still broken'],
    });
    vi.mocked(review.reviewPasses).mockReturnValue(false);
    vi.mocked(review.averageScore).mockReturnValue(3);

    const result = await runFixPipeline(db, ticketId);

    expect(result.ticketStatus).toBe('needs_attention');
    expect(getTicket(db, ticketId)!.status).toBe('needs_attention');
    expect(getPr(db, result.prId)!.status).toBe('needs_attention');
    expect(implement.implementFix).toHaveBeenCalledTimes(3);
    expect(git.markPrDraft).toHaveBeenCalled();
    const messages = listPrMessages(db, result.prId);
    expect(messages[messages.length - 1].content).toContain('still broken');
  });

  it('throws when the implement session produces no changes, but still cleans up the worktree', async () => {
    vi.mocked(git.commitAll).mockResolvedValue(false);
    await expect(runFixPipeline(db, ticketId)).rejects.toThrow('implement session produced no changes');
    expect(git.removeWorktree).toHaveBeenCalled();
  });
});

describe('passComment / failComment', () => {
  const score = { correctness: 5, completeness: 5, quality: 5, tests: 5, regressionRisk: 5, findings: ['x'] };

  it('passComment includes the round count and per-dimension scores', () => {
    expect(passComment(score, 2)).toContain('after 2 round(s)');
    expect(passComment(score, 2)).toContain('correctness 5');
  });

  it('failComment lists unresolved findings', () => {
    expect(failComment(score)).toContain('- x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/fixPipeline.test.ts`
Expected: FAIL — `Cannot find module '../src/fixPipeline.js'`.

- [ ] **Step 3: Write `engine/src/fixPipeline.ts`**

```ts
import type Database from 'better-sqlite3';
import { getProject } from './projects.js';
import { getTicket, listTicketMessages, updateTicketStatus } from './tickets.js';
import { recordPr, updatePrStatus, addPrMessage } from './prs.js';
import {
  createFixWorktree, removeWorktree, commitAll, pushBranch, getDiff, createPr, markPrDraft,
} from './git.js';
import { implementFix } from './implement.js';
import { reviewDiff, reviewPasses, averageScore } from './review.js';
import type { ReviewScore } from './types.js';

const MAX_REVIEW_ROUNDS = 3;

export interface FixResult {
  ticketStatus: 'in_review' | 'needs_attention';
  prId: number;
}

export function passComment(score: ReviewScore, rounds: number): string {
  return `Fix ready for review.
Review score: ${averageScore(score).toFixed(1)}/5 after ${rounds} round(s).
Scores: correctness ${score.correctness}, completeness ${score.completeness}, quality ${score.quality}, tests ${score.tests}, regression risk ${score.regressionRisk}.`;
}

export function failComment(score: ReviewScore): string {
  return `The fix did not reach the review threshold (minimum 4/5) after ${MAX_REVIEW_ROUNDS} rounds.
Unresolved findings:
${score.findings.map((f) => `- ${f}`).join('\n')}`;
}

export async function runFixPipeline(db: Database.Database, ticketId: number): Promise<FixResult> {
  const ticket = getTicket(db, ticketId);
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
  const project = getProject(db, ticket.projectId);
  if (!project) throw new Error(`Project ${ticket.projectId} not found`);

  const branch = `fix/${ticket.source}-${ticket.id}`;
  const worktreePath = await createFixWorktree(project, branch);

  try {
    const messages = listTicketMessages(db, ticketId);
    await implementFix(worktreePath, ticket, messages);

    const committed = await commitAll(worktreePath, `fix: ${ticket.title}`);
    if (!committed) throw new Error('implement session produced no changes');

    await pushBranch(worktreePath, branch);
    const prUrl = await createPr(
      worktreePath,
      ticket.title,
      `${ticket.body}\n\nWorkbench ticket: ${ticket.source}/${ticket.sourceId}`,
      project.defaultBranch
    );
    const numberMatch = prUrl.match(/\/pull\/(\d+)$/);
    const pr = recordPr(db, {
      ticketId, projectId: project.id, branch,
      number: numberMatch ? Number(numberMatch[1]) : null, url: prUrl, status: 'open',
    });

    let lastScore: ReviewScore | null = null;
    for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
      const diff = await getDiff(worktreePath, project.defaultBranch);
      const score = await reviewDiff(worktreePath, ticket, diff);
      lastScore = score;

      if (reviewPasses(score)) {
        updatePrStatus(db, pr.id, 'open', averageScore(score));
        addPrMessage(db, pr.id, 'assistant', passComment(score, round));
        updateTicketStatus(db, ticketId, 'in_review', pr.id);
        return { ticketStatus: 'in_review', prId: pr.id };
      }

      if (round < MAX_REVIEW_ROUNDS) {
        await implementFix(worktreePath, ticket, messages, score.findings);
        const changed = await commitAll(worktreePath, `fix: address review round ${round}`);
        if (!changed) break;
        await pushBranch(worktreePath, branch);
      }
    }

    await markPrDraft(worktreePath);
    updatePrStatus(db, pr.id, 'needs_attention', lastScore ? averageScore(lastScore) : null);
    addPrMessage(db, pr.id, 'assistant', failComment(lastScore!));
    updateTicketStatus(db, ticketId, 'needs_attention', pr.id);
    return { ticketStatus: 'needs_attention', prId: pr.id };
  } finally {
    await removeWorktree(project.repoPath, worktreePath);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/fixPipeline.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/fixPipeline.ts tests/fixPipeline.test.ts
git commit -m "Add fix pipeline orchestrator"
```

---

### Task 16: Job lock manager

New — the concurrency guard the spec's error-handling section requires: reject a second action on a ticket/PR that's already mid-job, and mark interrupted jobs on restart rather than silently resuming a possibly half-finished worktree. Locking is a plain SELECT-then-INSERT inside one synchronous function: `better-sqlite3` calls never yield to the event loop, so nothing can interleave between the check and the insert — no transaction wrapper needed.

**Files:**
- Create: `engine/src/jobs.ts`
- Test: `engine/tests/jobs.test.ts`

**Interfaces:**
- Consumes: `Database.Database`; `Job`, `JobType`, `JobTargetType` from `./types.js`.
- Produces: `acquireJob(db, type, targetType, targetId): Job | null` (null means "already running, reject"), `finishJob(db, jobId, status, error?): void`, `reconcileInterruptedJobs(db): number`, `getJob(db, id): Job | null`. Every API route that triggers a job (Task 22) wraps its work in `acquireJob`/`finishJob`; `index.ts` (Task 23) calls `reconcileInterruptedJobs` on startup.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/jobs.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { acquireJob, finishJob, reconcileInterruptedJobs, getJob } from '../src/jobs.js';

let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
});

describe('acquireJob', () => {
  it('acquires a lock when none is running for the target', () => {
    const job = acquireJob(db, 'fix', 'ticket', 1);
    expect(job).not.toBeNull();
    expect(job!.status).toBe('running');
  });

  it('refuses a second lock on the same target while one is running', () => {
    acquireJob(db, 'fix', 'ticket', 1);
    expect(acquireJob(db, 'spar', 'ticket', 1)).toBeNull();
  });

  it('allows a new lock once the previous job on that target is finished', () => {
    const first = acquireJob(db, 'fix', 'ticket', 1)!;
    finishJob(db, first.id, 'done');
    expect(acquireJob(db, 'fix', 'ticket', 1)).not.toBeNull();
  });

  it('does not block a different target', () => {
    acquireJob(db, 'fix', 'ticket', 1);
    expect(acquireJob(db, 'fix', 'ticket', 2)).not.toBeNull();
  });
});

describe('finishJob', () => {
  it('records a failure reason', () => {
    const job = acquireJob(db, 'fix', 'ticket', 1)!;
    finishJob(db, job.id, 'failed', 'boom');
    expect(getJob(db, job.id)).toEqual({ ...job, status: 'failed', error: 'boom' });
  });
});

describe('reconcileInterruptedJobs', () => {
  it('marks every running job as interrupted and returns the count', () => {
    const a = acquireJob(db, 'fix', 'ticket', 1)!;
    const b = acquireJob(db, 'pr-chat', 'pr', 2)!;
    expect(reconcileInterruptedJobs(db)).toBe(2);
    expect(getJob(db, a.id)!.status).toBe('interrupted');
    expect(getJob(db, b.id)!.status).toBe('interrupted');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/jobs.test.ts`
Expected: FAIL — `Cannot find module '../src/jobs.js'`.

- [ ] **Step 3: Write `engine/src/jobs.ts`**

```ts
import type Database from 'better-sqlite3';
import type { Job, JobType, JobTargetType } from './types.js';

function rowToJob(row: any): Job {
  return {
    id: row.id, type: row.type, targetType: row.target_type, targetId: row.target_id,
    status: row.status, error: row.error, createdAt: row.created_at,
  };
}

export function getJob(db: Database.Database, id: number): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row ? rowToJob(row) : null;
}

export function acquireJob(
  db: Database.Database,
  type: JobType,
  targetType: JobTargetType,
  targetId: number
): Job | null {
  const running = db
    .prepare(`SELECT id FROM jobs WHERE target_type = ? AND target_id = ? AND status = 'running'`)
    .get(targetType, targetId);
  if (running) return null;

  const result = db
    .prepare(`INSERT INTO jobs (type, target_type, target_id, status, created_at) VALUES (?, ?, ?, 'running', ?)`)
    .run(type, targetType, targetId, new Date().toISOString());
  return getJob(db, Number(result.lastInsertRowid));
}

export function finishJob(
  db: Database.Database,
  jobId: number,
  status: 'done' | 'failed',
  error: string | null = null
): void {
  db.prepare('UPDATE jobs SET status = ?, error = ? WHERE id = ?').run(status, error, jobId);
}

export function reconcileInterruptedJobs(db: Database.Database): number {
  const result = db
    .prepare(`UPDATE jobs SET status = 'interrupted', error = 'engine restarted mid-job' WHERE status = 'running'`)
    .run();
  return result.changes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/jobs.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/jobs.ts tests/jobs.test.ts
git commit -m "Add job lock manager"
```

---

### Task 17: PR chat module (revise or merge)

New. Routes a PR chat message by simple keyword check rather than a second Claude call to classify intent (cheaper and instant): a message containing a merge phrase runs `mergePr` directly; anything else is treated as a revision instruction. Reopens the PR's worktree with `openWorktree` (Task 7) since `fixPipeline` already cleaned it up.

**Files:**
- Create: `engine/src/prChat.ts`
- Test: `engine/tests/prChat.test.ts`

**Interfaces:**
- Consumes: `getProject` from `./projects.js`; `getPr`, `addPrMessage`, `updatePrStatus` from `./prs.js`; `getTicket`, `updateTicketStatus` from `./tickets.js`; `openWorktree`, `removeWorktree`, `commitAll`, `pushBranch`, `getDiff`, `mergePr` from `./git.js`; `runClaude` from `./claude.js`; `reviewDiff`, `reviewPasses`, `averageScore` from `./review.js`; `passComment`, `failComment` from `./fixPipeline.js`.
- Produces: `isMergeRequest(message: string): boolean`, `sendPrMessage(db, prId, userMessage): Promise<PrChatResult>` where `PrChatResult = { action: 'revised' | 'merged'; reply: string }` — the PR chat API route (Task 22) calls this.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/prChat.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket, getTicket } from '../src/tickets.js';
import { recordPr, getPr, listPrMessages } from '../src/prs.js';
import * as git from '../src/git.js';
import * as claude from '../src/claude.js';
import * as review from '../src/review.js';
import { sendPrMessage, isMergeRequest } from '../src/prChat.js';

vi.mock('../src/git.js');
vi.mock('../src/claude.js');
vi.mock('../src/review.js');

let db: Database.Database;
let prId: number;
let ticketId: number;

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  const projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  ticketId = createTicket(db, {
    source: 'github', sourceId: 'GH-demo#1', projectId, title: 'Fix null check', body: 'b', url: 'u', analysis: null,
  }).id;
  prId = recordPr(db, {
    ticketId, projectId, branch: 'fix/github-1', number: 142, url: 'https://github.com/x/pull/142', status: 'open',
  }).id;

  vi.mocked(git.openWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-github-1');
  vi.mocked(git.removeWorktree).mockResolvedValue(undefined);
  vi.mocked(git.commitAll).mockResolvedValue(true);
  vi.mocked(git.pushBranch).mockResolvedValue(undefined);
  vi.mocked(git.getDiff).mockResolvedValue('diff');
  vi.mocked(claude.runClaude).mockResolvedValue('done');
});

describe('isMergeRequest', () => {
  it('matches common merge phrasing case-insensitively', () => {
    expect(isMergeRequest('merge it')).toBe(true);
    expect(isMergeRequest('Merge It please')).toBe(true);
    expect(isMergeRequest('go ahead and merge')).toBe(true);
  });

  it('does not match a revision instruction', () => {
    expect(isMergeRequest('also guard the email field')).toBe(false);
  });
});

describe('sendPrMessage — merge', () => {
  it('runs mergePr, marks the PR merged, and the ticket done', async () => {
    const result = await sendPrMessage(db, prId, 'merge it');

    expect(result.action).toBe('merged');
    expect(git.mergePr).toHaveBeenCalledWith('/repos/demo/.worktrees/fix-github-1');
    expect(getPr(db, prId)!.status).toBe('merged');
    expect(getTicket(db, ticketId)!.status).toBe('done');
  });
});

describe('sendPrMessage — revise', () => {
  it('implements the revision, pushes, re-reviews, and records the outcome', async () => {
    vi.mocked(review.reviewDiff).mockResolvedValue({
      correctness: 5, completeness: 5, quality: 5, tests: 5, regressionRisk: 5, findings: [],
    });
    vi.mocked(review.reviewPasses).mockReturnValue(true);
    vi.mocked(review.averageScore).mockReturnValue(5);

    const result = await sendPrMessage(db, prId, 'also guard the email field');

    expect(result.action).toBe('revised');
    expect(claude.runClaude).toHaveBeenCalled();
    expect(git.pushBranch).toHaveBeenCalledWith('/repos/demo/.worktrees/fix-github-1', 'fix/github-1');
    expect(getPr(db, prId)!.status).toBe('open');
    expect(git.removeWorktree).toHaveBeenCalledWith('/repos/demo', '/repos/demo/.worktrees/fix-github-1');
    const messages = listPrMessages(db, prId);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'also guard the email field' });
  });

  it('replies without pushing when nothing changed', async () => {
    vi.mocked(git.commitAll).mockResolvedValue(false);
    const result = await sendPrMessage(db, prId, 'do something vague');
    expect(result.reply).toContain("didn't find a change");
    expect(git.pushBranch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/prChat.test.ts`
Expected: FAIL — `Cannot find module '../src/prChat.js'`.

- [ ] **Step 3: Write `engine/src/prChat.ts`**

```ts
import type Database from 'better-sqlite3';
import { getProject } from './projects.js';
import { getPr, addPrMessage, updatePrStatus } from './prs.js';
import { getTicket, updateTicketStatus } from './tickets.js';
import { openWorktree, removeWorktree, commitAll, pushBranch, getDiff, mergePr } from './git.js';
import { runClaude } from './claude.js';
import { reviewDiff, reviewPasses, averageScore } from './review.js';
import { passComment, failComment } from './fixPipeline.js';
import type { Pr, Project, Ticket } from './types.js';

const MERGE_PHRASES = ['merge it', 'merge this', 'go ahead and merge'];

export function isMergeRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return MERGE_PHRASES.some((phrase) => normalized.includes(phrase));
}

export interface PrChatResult {
  action: 'revised' | 'merged';
  reply: string;
}

export async function sendPrMessage(db: Database.Database, prId: number, userMessage: string): Promise<PrChatResult> {
  const pr = getPr(db, prId);
  if (!pr) throw new Error(`PR ${prId} not found`);
  const project = getProject(db, pr.projectId);
  if (!project) throw new Error(`Project ${pr.projectId} not found`);

  addPrMessage(db, prId, 'user', userMessage);

  return isMergeRequest(userMessage) ? mergePrChat(db, pr, project) : revisePrChat(db, pr, project, userMessage);
}

async function mergePrChat(db: Database.Database, pr: Pr, project: Project): Promise<PrChatResult> {
  const worktreePath = await openWorktree(project, pr.branch);
  try {
    await mergePr(worktreePath);
  } finally {
    await removeWorktree(project.repoPath, worktreePath);
  }
  updatePrStatus(db, pr.id, 'merged', pr.lastReviewScore);
  const ticket = getTicket(db, pr.ticketId);
  if (ticket) updateTicketStatus(db, ticket.id, 'done', pr.id);
  const reply = `Merged ${pr.url}.`;
  addPrMessage(db, pr.id, 'assistant', reply);
  return { action: 'merged', reply };
}

function buildRevisePrompt(ticket: Ticket, instruction: string): string {
  return `Revise the fix already implemented on this branch for "${ticket.title}".

Requested change: ${instruction}

Make the changes directly in this working tree. Do not commit or push.`;
}

async function revisePrChat(
  db: Database.Database,
  pr: Pr,
  project: Project,
  userMessage: string
): Promise<PrChatResult> {
  const ticket = getTicket(db, pr.ticketId);
  if (!ticket) throw new Error(`Ticket for PR ${pr.id} not found`);
  const worktreePath = await openWorktree(project, pr.branch);

  try {
    await runClaude({
      cwd: worktreePath,
      prompt: buildRevisePrompt(ticket, userMessage),
      allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
      timeoutMs: 30 * 60 * 1000,
    });

    const committed = await commitAll(worktreePath, `fix: ${userMessage}`);
    if (!committed) {
      const reply = "I didn't find a change to make for that — could you be more specific?";
      addPrMessage(db, pr.id, 'assistant', reply);
      return { action: 'revised', reply };
    }

    await pushBranch(worktreePath, pr.branch);
    const diff = await getDiff(worktreePath, project.defaultBranch);
    const score = await reviewDiff(worktreePath, ticket, diff);
    const passed = reviewPasses(score);
    updatePrStatus(db, pr.id, passed ? 'open' : 'needs_attention', averageScore(score));

    const reply = passed ? passComment(score, 1) : failComment(score);
    addPrMessage(db, pr.id, 'assistant', reply);
    return { action: 'revised', reply };
  } finally {
    await removeWorktree(project.repoPath, worktreePath);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/prChat.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/prChat.ts tests/prChat.test.ts
git commit -m "Add PR chat module with merge/revise routing"
```

---

### Task 18: Ticket chat module (sparring)

New — issue-agent had no discussion step, only a one-shot analysis. This runs read-only (no worktree, no writes) directly in the project's checkout, same as issue-agent's `analyzeIssue`.

**Files:**
- Create: `engine/src/ticketChat.ts`
- Test: `engine/tests/ticketChat.test.ts`

**Interfaces:**
- Consumes: `getProject` from `./projects.js`; `getTicket`, `listTicketMessages`, `addTicketMessage`, `updateTicketStatus` from `./tickets.js`; `runClaude` from `./claude.js`.
- Produces: `buildSparPrompt(title, body, messages): string`, `sendTicketMessage(db, ticketId, userMessage): Promise<string>` (returns the assistant's reply) — the ticket chat API route (Task 22) calls this.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/ticketChat.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket, getTicket, listTicketMessages } from '../src/tickets.js';
import * as claude from '../src/claude.js';
import { sendTicketMessage, buildSparPrompt } from '../src/ticketChat.js';

vi.mock('../src/claude.js');

let db: Database.Database;
let ticketId: number;

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  const projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  ticketId = createTicket(db, {
    source: 'github', sourceId: 'GH-demo#1', projectId, title: 'Fix null check', body: 'b', url: 'u', analysis: null,
  }).id;
});

describe('sendTicketMessage', () => {
  it('records the user message, moves status to sparring, and records the reply', async () => {
    vi.mocked(claude.runClaude).mockResolvedValue('Want me to cap the backoff too?');

    const reply = await sendTicketMessage(db, ticketId, 'add retry logic');

    expect(reply).toBe('Want me to cap the backoff too?');
    expect(getTicket(db, ticketId)!.status).toBe('sparring');
    expect(listTicketMessages(db, ticketId).map((m) => [m.role, m.content])).toEqual([
      ['user', 'add retry logic'],
      ['assistant', 'Want me to cap the backoff too?'],
    ]);
  });

  it('leaves status as sparring on a later message rather than resetting it', async () => {
    vi.mocked(claude.runClaude).mockResolvedValue('ok');
    await sendTicketMessage(db, ticketId, 'first');
    await sendTicketMessage(db, ticketId, 'second');
    expect(getTicket(db, ticketId)!.status).toBe('sparring');
  });
});

describe('buildSparPrompt', () => {
  it('includes prior turns when there is history', () => {
    const prompt = buildSparPrompt('t', 'b', [{ role: 'user', content: 'hey', id: 1, ticketId: 1, createdAt: '' }]);
    expect(prompt).toContain('You: hey');
  });

  it('omits the discussion section on the first message', () => {
    expect(buildSparPrompt('t', 'b', [])).not.toContain('Discussion so far');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/ticketChat.test.ts`
Expected: FAIL — `Cannot find module '../src/ticketChat.js'`.

- [ ] **Step 3: Write `engine/src/ticketChat.ts`**

```ts
import type Database from 'better-sqlite3';
import { getProject } from './projects.js';
import { getTicket, listTicketMessages, addTicketMessage, updateTicketStatus } from './tickets.js';
import { runClaude } from './claude.js';
import type { TicketMessage } from './types.js';

export function buildSparPrompt(title: string, body: string, messages: TicketMessage[]): string {
  const transcript = messages.map((m) => `${m.role === 'user' ? 'You' : 'Claude'}: ${m.content}`).join('\n');
  return `You are discussing how to fix this issue with the person who will approve the fix. This is read-only analysis and discussion — do not make any changes.

Title: ${title}
${body}
${transcript ? `\nDiscussion so far:\n${transcript}` : ''}

Respond conversationally to continue the discussion, or answer their latest question.`;
}

export async function sendTicketMessage(db: Database.Database, ticketId: number, userMessage: string): Promise<string> {
  const ticket = getTicket(db, ticketId);
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
  const project = getProject(db, ticket.projectId);
  if (!project) throw new Error(`Project ${ticket.projectId} not found`);

  addTicketMessage(db, ticketId, 'user', userMessage);
  if (ticket.status === 'new') updateTicketStatus(db, ticketId, 'sparring', ticket.prId);

  const messages = listTicketMessages(db, ticketId);
  const reply = await runClaude({
    cwd: project.repoPath,
    prompt: buildSparPrompt(ticket.title, ticket.body, messages),
    allowedTools: ['Read', 'Grep', 'Glob'],
    timeoutMs: 15 * 60 * 1000,
  });
  addTicketMessage(db, ticketId, 'assistant', reply);
  return reply;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/ticketChat.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/ticketChat.ts tests/ticketChat.test.ts
git commit -m "Add ticket sparring chat module"
```

---

### Task 19: Todo aggregation and manual CRUD

New — the unified "Today" list the spec calls for: plain items (manual + Jira) and pipeline items (tickets/PRs needing input) in one view, per the design's decision not to keep two separate lists for the same kind of thing. `upsertJiraTodo`/`reconcileJiraTodos` mirror work-tracker's `reconcile.ts` behavior (add new, remove ones no longer open, never touch manual entries) but against SQLite instead of a JSON file.

**Files:**
- Create: `engine/src/todos.ts`
- Test: `engine/tests/todos.test.ts`

**Interfaces:**
- Consumes: `Database.Database`; `getProject` from `./projects.js`; `getTicket`, `listTickets`, `findTicketBySource`, `createTicket` from `./tickets.js`; `listPrs` from `./prs.js`; `analyzeIssue` from `./analyze.js`; `Todo`, `SourceIssue`, `Project`, `Ticket`, `TicketStatus`, `PrStatus` from `./types.js`.
- Produces: `listTodos(db, filter?)`, `getTodo(db, id)`, `createManualTodo(db, text)`, `setTodoDone(db, id, done)`, `upsertJiraTodo(db, issue, project)`, `reconcileJiraTodos(db, currentSourceIds): number`, `promoteTodo(db, todoId): Promise<Ticket>`, `getTodayView(db): TodayView`. The poller (Task 20) calls `upsertJiraTodo`/`reconcileJiraTodos`; the Today/Todos API routes (Task 21) call the rest — `promoteTodo` is the engine-side half of the spec's "Start fixing this" action: it runs the same one-shot analysis Sentry/GitHub issues get on triage, creates the ticket, and links the todo to it, idempotently (a second call for an already-promoted todo returns the existing ticket rather than creating a duplicate).

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/todos.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket, updateTicketStatus, findTicketBySource } from '../src/tickets.js';
import { recordPr } from '../src/prs.js';
import * as analyze from '../src/analyze.js';
import {
  listTodos, getTodo, createManualTodo, setTodoDone, upsertJiraTodo, reconcileJiraTodos, promoteTodo, getTodayView,
} from '../src/todos.js';

vi.mock('../src/analyze.js');

let db: Database.Database;

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
});

describe('manual todos', () => {
  it('creates and lists an open manual todo', () => {
    createManualTodo(db, 'reply to client');
    expect(listTodos(db, { done: false }).map((t) => t.text)).toEqual(['reply to client']);
  });

  it('setTodoDone marks it done and it drops out of the open filter', () => {
    const todo = createManualTodo(db, 'renew SSL cert');
    setTodoDone(db, todo.id, true);
    expect(listTodos(db, { done: false })).toEqual([]);
    expect(listTodos(db, { done: true })[0].done).toBe(true);
  });
});

describe('upsertJiraTodo / reconcileJiraTodos', () => {
  const issue = { source: 'jira' as const, sourceId: 'JIRA-DEMO-1', title: '[DEMO-1] Update env vars', url: 'https://x/browse/DEMO-1', body: 'Redirect loop on logout.', projectKey: 'DEMO' };

  it('inserts a new jira todo with canPromote true and its body stored, when a project maps to it', () => {
    const project = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: 'DEMO', sentryProjectSlug: null,
    });
    upsertJiraTodo(db, issue, project);
    const [todo] = listTodos(db);
    expect(todo).toMatchObject({
      source: 'jira', sourceId: 'JIRA-DEMO-1', body: 'Redirect loop on logout.', canPromote: true, projectId: project.id,
    });
  });

  it('sets canPromote false when no project maps to it', () => {
    upsertJiraTodo(db, issue, null);
    expect(listTodos(db)[0].canPromote).toBe(false);
  });

  it('updates the existing row instead of duplicating on a second upsert', () => {
    upsertJiraTodo(db, issue, null);
    upsertJiraTodo(db, { ...issue, title: '[DEMO-1] Update env vars (urgent)' }, null);
    expect(listTodos(db)).toHaveLength(1);
    expect(listTodos(db)[0].text).toBe('[DEMO-1] Update env vars (urgent)');
  });

  it('reconcileJiraTodos removes jira todos no longer in the current fetch but keeps manual ones', () => {
    upsertJiraTodo(db, issue, null);
    createManualTodo(db, 'unrelated manual item');
    const removed = reconcileJiraTodos(db, []);
    expect(removed).toBe(1);
    expect(listTodos(db).map((t) => t.text)).toEqual(['unrelated manual item']);
  });

  it('reconcileJiraTodos keeps a todo whose sourceId is still present', () => {
    upsertJiraTodo(db, issue, null);
    const removed = reconcileJiraTodos(db, ['JIRA-DEMO-1']);
    expect(removed).toBe(0);
    expect(listTodos(db)).toHaveLength(1);
  });
});

describe('promoteTodo', () => {
  const issue = { source: 'jira' as const, sourceId: 'JIRA-DEMO-1', title: '[DEMO-1] Update env vars', url: 'https://x/browse/DEMO-1', body: 'Redirect loop on logout.', projectKey: 'DEMO' };

  it('analyzes the issue, creates a ticket, and links the todo to it', async () => {
    const project = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: 'DEMO', sentryProjectSlug: null,
    });
    upsertJiraTodo(db, issue, project);
    const todo = listTodos(db)[0];
    vi.mocked(analyze.analyzeIssue).mockResolvedValue({
      summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: [], confidence: 'high',
    });

    const ticket = await promoteTodo(db, todo.id);

    expect(ticket.source).toBe('jira');
    expect(ticket.sourceId).toBe('JIRA-DEMO-1');
    expect(ticket.analysis).toEqual({ summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: [], confidence: 'high' });
    const updated = getTodo(db, todo.id)!;
    expect(updated.done).toBe(true);
    expect(updated.promotedTicketId).toBe(ticket.id);
  });

  it('is idempotent — a second call returns the existing ticket instead of duplicating it', async () => {
    const project = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: 'DEMO', sentryProjectSlug: null,
    });
    upsertJiraTodo(db, issue, project);
    const todo = listTodos(db)[0];
    vi.mocked(analyze.analyzeIssue).mockResolvedValue({
      summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: [], confidence: 'high',
    });

    const first = await promoteTodo(db, todo.id);
    const second = await promoteTodo(db, todo.id);

    expect(second.id).toBe(first.id);
    expect(analyze.analyzeIssue).toHaveBeenCalledTimes(1);
  });

  it('throws when the todo cannot be promoted (no project mapping)', async () => {
    upsertJiraTodo(db, issue, null);
    const todo = listTodos(db)[0];
    await expect(promoteTodo(db, todo.id)).rejects.toThrow('cannot be promoted');
  });
});

describe('getTodayView', () => {
  it('includes tickets needing sparring, PRs needing review, and open todos; excludes done/merged', () => {
    const project = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    const newTicket = createTicket(db, { source: 'github', sourceId: 'GH-1', projectId: project.id, title: 'New ticket', body: 'b', url: 'u', analysis: null });
    const doneTicket = createTicket(db, { source: 'github', sourceId: 'GH-2', projectId: project.id, title: 'Done ticket', body: 'b', url: 'u', analysis: null });
    const prTicket = createTicket(db, { source: 'github', sourceId: 'GH-3', projectId: project.id, title: 'PR ticket', body: 'b', url: 'u', analysis: null });
    updateTicketStatus(db, doneTicket.id, 'done', null);
    updateTicketStatus(db, prTicket.id, 'in_review', null);
    const openPr = recordPr(db, { ticketId: prTicket.id, projectId: project.id, branch: 'fix/gh-3', number: 5, url: 'u', status: 'open' });
    recordPr(db, { ticketId: doneTicket.id, projectId: project.id, branch: 'fix/gh-2', number: 6, url: 'u', status: 'merged' });
    createManualTodo(db, 'unrelated task');

    const view = getTodayView(db);

    expect(view.needsInput).toEqual(
      expect.arrayContaining([
        { kind: 'ticket', id: newTicket.id, title: 'New ticket', status: 'new', reviewScore: null },
        { kind: 'pr', id: openPr.id, title: 'PR ticket', status: 'open', reviewScore: null },
      ])
    );
    expect(view.needsInput.some((i) => i.id === doneTicket.id && i.kind === 'ticket')).toBe(false);
    expect(view.todos.map((t) => t.text)).toEqual(['unrelated task']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/todos.test.ts`
Expected: FAIL — `Cannot find module '../src/todos.js'`.

- [ ] **Step 3: Write `engine/src/todos.ts`**

```ts
import type Database from 'better-sqlite3';
import { getProject } from './projects.js';
import { getTicket, listTickets, findTicketBySource, createTicket } from './tickets.js';
import { listPrs } from './prs.js';
import { analyzeIssue } from './analyze.js';
import type { Todo, SourceIssue, Project, Ticket, TicketStatus, PrStatus } from './types.js';

function rowToTodo(row: any): Todo {
  return {
    id: row.id, source: row.source, sourceId: row.source_id, text: row.text, body: row.body, url: row.url,
    projectId: row.project_id, canPromote: !!row.can_promote, done: !!row.done,
    promotedTicketId: row.promoted_ticket_id, createdAt: row.created_at,
  };
}

export function listTodos(db: Database.Database, filter: { done?: boolean } = {}): Todo[] {
  if (filter.done !== undefined) {
    return db.prepare('SELECT * FROM todos WHERE done = ? ORDER BY created_at').all(filter.done ? 1 : 0).map(rowToTodo);
  }
  return db.prepare('SELECT * FROM todos ORDER BY created_at').all().map(rowToTodo);
}

export function getTodo(db: Database.Database, id: number): Todo | null {
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  return row ? rowToTodo(row) : null;
}

export function createManualTodo(db: Database.Database, text: string): Todo {
  const result = db
    .prepare(
      `INSERT INTO todos (source, source_id, text, body, can_promote, done, created_at)
       VALUES ('manual', NULL, ?, '', 0, 0, ?)`
    )
    .run(text, new Date().toISOString());
  return rowToTodo(db.prepare('SELECT * FROM todos WHERE id = ?').get(result.lastInsertRowid));
}

export function setTodoDone(db: Database.Database, id: number, done: boolean): Todo | null {
  db.prepare('UPDATE todos SET done = ? WHERE id = ?').run(done ? 1 : 0, id);
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  return row ? rowToTodo(row) : null;
}

export function upsertJiraTodo(db: Database.Database, issue: SourceIssue, project: Project | null): void {
  db.prepare(
    `INSERT INTO todos (source, source_id, text, body, url, project_id, can_promote, done, created_at)
     VALUES ('jira', @sourceId, @text, @body, @url, @projectId, @canPromote, 0, @createdAt)
     ON CONFLICT(source, source_id) DO UPDATE SET text = @text, body = @body, url = @url, project_id = @projectId, can_promote = @canPromote`
  ).run({
    sourceId: issue.sourceId,
    text: issue.title,
    body: issue.body,
    url: issue.url,
    projectId: project ? project.id : null,
    canPromote: project ? 1 : 0,
    createdAt: new Date().toISOString(),
  });
}

export async function promoteTodo(db: Database.Database, todoId: number): Promise<Ticket> {
  const todo = getTodo(db, todoId);
  if (!todo) throw new Error(`Todo ${todoId} not found`);
  if (todo.source !== 'jira' || !todo.sourceId) throw new Error(`Todo ${todoId} cannot be promoted (not a Jira item)`);

  const existing = findTicketBySource(db, 'jira', todo.sourceId);
  if (existing) return existing;

  if (!todo.canPromote || todo.projectId === null) throw new Error(`Todo ${todoId} cannot be promoted (no project mapping)`);
  const project = getProject(db, todo.projectId);
  if (!project) throw new Error(`Project ${todo.projectId} not found`);

  const issue: SourceIssue = {
    source: 'jira', sourceId: todo.sourceId, title: todo.text, url: todo.url ?? '',
    body: todo.body, projectKey: project.jiraProjectKey ?? '',
  };
  const analysis = await analyzeIssue(issue, project);
  const ticket = createTicket(db, {
    source: 'jira', sourceId: todo.sourceId, projectId: project.id,
    title: todo.text, body: todo.body, url: todo.url ?? '', analysis,
  });
  db.prepare('UPDATE todos SET done = 1, promoted_ticket_id = ? WHERE id = ?').run(ticket.id, todo.id);
  return ticket;
}

export function reconcileJiraTodos(db: Database.Database, currentSourceIds: string[]): number {
  if (currentSourceIds.length === 0) {
    return db.prepare(`DELETE FROM todos WHERE source = 'jira'`).run().changes;
  }
  const placeholders = currentSourceIds.map(() => '?').join(',');
  return db
    .prepare(`DELETE FROM todos WHERE source = 'jira' AND source_id NOT IN (${placeholders})`)
    .run(...currentSourceIds).changes;
}

export interface TodayItem {
  kind: 'ticket' | 'pr';
  id: number;
  title: string;
  status: TicketStatus | PrStatus;
  reviewScore: number | null;
}

export interface TodayView {
  needsInput: TodayItem[];
  todos: Todo[];
}

export function getTodayView(db: Database.Database): TodayView {
  const tickets = listTickets(db).filter(
    (t) => t.status === 'new' || t.status === 'sparring' || t.status === 'needs_attention'
  );
  const prs = listPrs(db).filter((p) => p.status === 'open' || p.status === 'needs_attention');

  const needsInput: TodayItem[] = [
    ...tickets.map((t) => ({ kind: 'ticket' as const, id: t.id, title: t.title, status: t.status, reviewScore: null })),
    ...prs.map((p) => {
      const ticket = getTicket(db, p.ticketId);
      return {
        kind: 'pr' as const, id: p.id, title: ticket?.title ?? `PR #${p.number ?? p.id}`,
        status: p.status, reviewScore: p.lastReviewScore,
      };
    }),
  ];

  return { needsInput, todos: listTodos(db, { done: false }) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/todos.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/todos.ts tests/todos.test.ts
git commit -m "Add todo aggregation and manual CRUD"
```

---

### Task 20: Poller (background sync)

New orchestration tying the source adapters (Tasks 11-13) to ticket/todo creation. Runs on an interval; each cycle is independent so one bad cycle doesn't wedge future ones.

**Files:**
- Create: `engine/src/poller.ts`
- Test: `engine/tests/poller.test.ts`

**Interfaces:**
- Consumes: `listProjects` from `./projects.js`; `fetchAssignedJiraIssues` from `./sources/jira.js`; `fetchSentryIssues` from `./sources/sentry.js`; `fetchGithubIssues` from `./sources/github.js`; `analyzeIssue` from `./analyze.js`; `findTicketBySource`, `createTicket` from `./tickets.js`; `upsertJiraTodo`, `reconcileJiraTodos` from `./todos.js` (Task 19).
- Produces: `runPollCycle(db: Database.Database): Promise<PollSummary>` where `PollSummary = { jiraTodos: number; ticketsCreated: number; sourceErrors: string[] }`, `startPoller(db, intervalMs?): () => void` (returns a stop function) — `index.ts` (Task 23) calls `startPoller`.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/poller.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { listTickets } from '../src/tickets.js';
import * as jiraSource from '../src/sources/jira.js';
import * as sentrySource from '../src/sources/sentry.js';
import * as githubSource from '../src/sources/github.js';
import * as analyze from '../src/analyze.js';
import * as todos from '../src/todos.js';
import { runPollCycle } from '../src/poller.js';

vi.mock('../src/sources/jira.js');
vi.mock('../src/sources/sentry.js');
vi.mock('../src/sources/github.js');
vi.mock('../src/analyze.js');
vi.mock('../src/todos.js');

let db: Database.Database;

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: 'linku/demo', jiraProjectKey: 'DEMO', sentryProjectSlug: 'demo-frontend',
  });
  vi.mocked(jiraSource.fetchAssignedJiraIssues).mockResolvedValue([]);
  vi.mocked(sentrySource.fetchSentryIssues).mockResolvedValue([]);
  vi.mocked(githubSource.fetchGithubIssues).mockResolvedValue([]);
});

describe('runPollCycle', () => {
  it('creates a new ticket with analysis for a fresh GitHub issue', async () => {
    vi.mocked(githubSource.fetchGithubIssues).mockResolvedValue([
      { source: 'github', sourceId: 'GH-linku/demo#1', title: 'Crash', url: 'u', body: 'b', projectKey: 'linku/demo' },
    ]);
    vi.mocked(analyze.analyzeIssue).mockResolvedValue({
      summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: [], confidence: 'high',
    });

    const summary = await runPollCycle(db);

    expect(summary.ticketsCreated).toBe(1);
    expect(listTickets(db)).toHaveLength(1);
    expect(listTickets(db)[0].analysis).toEqual({ summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: [], confidence: 'high' });
  });

  it('skips a GitHub issue that already has a ticket', async () => {
    vi.mocked(githubSource.fetchGithubIssues).mockResolvedValue([
      { source: 'github', sourceId: 'GH-linku/demo#1', title: 'Crash', url: 'u', body: 'b', projectKey: 'linku/demo' },
    ]);
    vi.mocked(analyze.analyzeIssue).mockResolvedValue({
      summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: [], confidence: 'high',
    });
    await runPollCycle(db);
    const second = await runPollCycle(db);
    expect(second.ticketsCreated).toBe(0);
    expect(analyze.analyzeIssue).toHaveBeenCalledTimes(1);
  });

  it('upserts every Jira issue as a todo and reconciles stale ones via todos.ts', async () => {
    vi.mocked(jiraSource.fetchAssignedJiraIssues).mockResolvedValue([
      { source: 'jira', sourceId: 'JIRA-DEMO-1', title: '[DEMO-1] Update env vars', url: 'u', body: 'b', projectKey: 'DEMO' },
    ]);
    await runPollCycle(db);
    expect(todos.upsertJiraTodo).toHaveBeenCalledTimes(1);
    expect(vi.mocked(todos.upsertJiraTodo).mock.calls[0][1].sourceId).toBe('JIRA-DEMO-1');
    expect(todos.reconcileJiraTodos).toHaveBeenCalledWith(db, ['JIRA-DEMO-1']);
  });

  it('records a source error without aborting the rest of the cycle', async () => {
    vi.mocked(jiraSource.fetchAssignedJiraIssues).mockRejectedValue(new Error('Jira API error 401'));
    vi.mocked(githubSource.fetchGithubIssues).mockResolvedValue([
      { source: 'github', sourceId: 'GH-linku/demo#2', title: 'Other', url: 'u', body: 'b', projectKey: 'linku/demo' },
    ]);
    vi.mocked(analyze.analyzeIssue).mockResolvedValue({
      summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: [], confidence: 'high',
    });

    const summary = await runPollCycle(db);

    expect(summary.sourceErrors).toEqual(['jira: Jira API error 401']);
    expect(summary.ticketsCreated).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/poller.test.ts`
Expected: FAIL — `Cannot find module '../src/poller.js'`.

- [ ] **Step 3: Write `engine/src/poller.ts`**

```ts
import type Database from 'better-sqlite3';
import { listProjects } from './projects.js';
import { fetchAssignedJiraIssues } from './sources/jira.js';
import { fetchSentryIssues } from './sources/sentry.js';
import { fetchGithubIssues } from './sources/github.js';
import { analyzeIssue } from './analyze.js';
import { findTicketBySource, createTicket } from './tickets.js';
import { upsertJiraTodo, reconcileJiraTodos } from './todos.js';
import type { SourceIssue, Project } from './types.js';

export interface PollSummary {
  jiraTodos: number;
  ticketsCreated: number;
  sourceErrors: string[];
}

function findProjectByKey(projects: Project[], field: 'jiraProjectKey' | 'githubRepo' | 'sentryProjectSlug', key: string): Project | null {
  return projects.find((p) => p[field] === key) ?? null;
}

export async function runPollCycle(db: Database.Database): Promise<PollSummary> {
  const projects = listProjects(db);
  const summary: PollSummary = { jiraTodos: 0, ticketsCreated: 0, sourceErrors: [] };

  const sentrySlugs = projects.filter((p) => p.sentryProjectSlug).map((p) => p.sentryProjectSlug!);
  const githubRepos = projects.filter((p) => p.githubRepo).map((p) => p.githubRepo!);

  const results = await Promise.allSettled([
    fetchAssignedJiraIssues(),
    fetchSentryIssues('workbench', sentrySlugs),
    fetchGithubIssues(githubRepos),
  ]);
  const names = ['jira', 'sentry', 'github'] as const;
  const issuesBySource: SourceIssue[][] = [[], [], []];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') issuesBySource[i] = result.value;
    else summary.sourceErrors.push(`${names[i]}: ${result.reason.message ?? String(result.reason)}`);
  });

  for (const issue of issuesBySource[0]) {
    const project = findProjectByKey(projects, 'jiraProjectKey', issue.projectKey);
    upsertJiraTodo(db, issue, project);
    summary.jiraTodos++;
  }
  if (results[0].status === 'fulfilled') {
    reconcileJiraTodos(db, issuesBySource[0].map((issue) => issue.sourceId));
  }

  for (const issue of [...issuesBySource[1], ...issuesBySource[2]]) {
    if (findTicketBySource(db, issue.source, issue.sourceId)) continue;
    const field = issue.source === 'sentry' ? 'sentryProjectSlug' : 'githubRepo';
    const project = findProjectByKey(projects, field, issue.projectKey);
    if (!project) continue;
    const analysis = await analyzeIssue(issue, project);
    createTicket(db, {
      source: issue.source, sourceId: issue.sourceId, projectId: project.id,
      title: issue.title, body: issue.body, url: issue.url, analysis,
    });
    summary.ticketsCreated++;
  }

  return summary;
}

export function startPoller(db: Database.Database, intervalMs: number = 5 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    runPollCycle(db).catch((err) => console.error('poll cycle failed', err));
  }, intervalMs);
  return () => clearInterval(timer);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/poller.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/poller.ts tests/poller.test.ts
git commit -m "Add background poller"
```

---

### Task 21: HTTP API — auth, server bootstrap, Today/Projects/Todos routes

New. A localhost-only Express server guarded by a bearer token. This task covers the three simplest resources; Tickets and PRs (which trigger jobs) are Task 22.

**Files:**
- Create: `engine/src/api/server.ts`
- Create: `engine/src/api/routes/today.ts`
- Create: `engine/src/api/routes/projects.ts`
- Create: `engine/src/api/routes/todos.ts`
- Test: `engine/tests/api/server.test.ts`

**Interfaces:**
- Consumes: `getTodayView` from `../todos.js`; `listProjects`, `getProject`, `createProject`, `updateProject`, `deleteProject` from `../projects.js`; `listTodos`, `createManualTodo`, `setTodoDone`, `promoteTodo` from `../todos.js`.
- Produces: `createServer(db: Database.Database, apiToken: string): express.Express` — `index.ts` (Task 23) calls this and then `app.listen(...)`. `POST /todos` is the exact endpoint the trimmed Raycast extension (a later plan) will call. `POST /todos/:id/promote` is the engine-side half of the spec's "Start fixing this" action.

- [ ] **Step 1: Write the failing test**

```ts
// engine/tests/api/server.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createManualTodo } from '../../src/todos.js';
import { createServer } from '../../src/api/server.js';

let db: Database.Database;
const TOKEN = 'test-token';
let app: ReturnType<typeof createServer>;

beforeEach(() => {
  db = openDb(':memory:');
  app = createServer(db, TOKEN);
});

function auth(req: request.Test): request.Test {
  return req.set('Authorization', `Bearer ${TOKEN}`);
}

describe('auth middleware', () => {
  it('rejects a request with no token', async () => {
    await request(app).get('/today').expect(401);
  });

  it('rejects a request with the wrong token', async () => {
    await request(app).get('/today').set('Authorization', 'Bearer wrong').expect(401);
  });

  it('accepts a request with the right token', async () => {
    await auth(request(app).get('/today')).expect(200);
  });
});

describe('GET /today', () => {
  it('returns needsInput and todos', async () => {
    createManualTodo(db, 'reply to client');
    const res = await auth(request(app).get('/today'));
    expect(res.body.needsInput).toEqual([]);
    expect(res.body.todos[0]).toMatchObject({ text: 'reply to client' });
  });
});

describe('projects routes', () => {
  it('creates, lists, updates, and deletes a project', async () => {
    const created = await auth(request(app).post('/projects')).send({
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    expect(created.status).toBe(201);

    expect((await auth(request(app).get('/projects'))).body).toHaveLength(1);

    const updated = await auth(request(app).patch(`/projects/${created.body.id}`)).send({ defaultBranch: 'develop' });
    expect(updated.body.defaultBranch).toBe('develop');

    await auth(request(app).delete(`/projects/${created.body.id}`)).expect(204);
    expect((await auth(request(app).get('/projects'))).body).toHaveLength(0);
  });

  it('404s for an unknown project id', async () => {
    await auth(request(app).get('/projects/999')).expect(404);
  });
});

describe('todos routes', () => {
  it('creates a todo via POST — the Raycast quick-add target', async () => {
    const res = await auth(request(app).post('/todos')).send({ text: 'renew SSL cert' });
    expect(res.status).toBe(201);
    expect(res.body.text).toBe('renew SSL cert');
  });

  it('rejects empty text', async () => {
    await auth(request(app).post('/todos')).send({ text: '' }).expect(400);
  });

  it('marks a todo done via PATCH', async () => {
    const created = await auth(request(app).post('/todos')).send({ text: 'x' });
    const res = await auth(request(app).patch(`/todos/${created.body.id}`)).send({ done: true });
    expect(res.body.done).toBe(true);
  });

  it('POST /todos/:id/promote rejects a manual todo with 400', async () => {
    const created = await auth(request(app).post('/todos')).send({ text: 'not a jira item' });
    const res = await auth(request(app).post(`/todos/${created.body.id}/promote`));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('cannot be promoted');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && pnpm vitest run tests/api/server.test.ts`
Expected: FAIL — `Cannot find module '../../src/api/server.js'`.

- [ ] **Step 3: Write `engine/src/api/routes/today.ts`**

```ts
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { getTodayView } from '../../todos.js';

export function registerTodayRoutes(app: Express, db: Database.Database): void {
  app.get('/today', (_req, res) => {
    res.json(getTodayView(db));
  });
}
```

- [ ] **Step 4: Write `engine/src/api/routes/projects.ts`**

```ts
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { listProjects, getProject, createProject, updateProject, deleteProject } from '../../projects.js';

export function registerProjectsRoutes(app: Express, db: Database.Database): void {
  app.get('/projects', (_req, res) => res.json(listProjects(db)));

  app.get('/projects/:id', (req, res) => {
    const project = getProject(db, Number(req.params.id));
    if (!project) { res.status(404).json({ error: 'not found' }); return; }
    res.json(project);
  });

  app.post('/projects', (req, res) => {
    res.status(201).json(createProject(db, req.body));
  });

  app.patch('/projects/:id', (req, res) => {
    const project = updateProject(db, Number(req.params.id), req.body);
    if (!project) { res.status(404).json({ error: 'not found' }); return; }
    res.json(project);
  });

  app.delete('/projects/:id', (req, res) => {
    deleteProject(db, Number(req.params.id));
    res.status(204).end();
  });
}
```

- [ ] **Step 5: Write `engine/src/api/routes/todos.ts`**

```ts
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { listTodos, createManualTodo, setTodoDone, promoteTodo } from '../../todos.js';

export function registerTodosRoutes(app: Express, db: Database.Database): void {
  app.get('/todos', (_req, res) => res.json(listTodos(db, { done: false })));

  app.post('/todos', (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    res.status(201).json(createManualTodo(db, text));
  });

  app.patch('/todos/:id', (req, res) => {
    const todo = setTodoDone(db, Number(req.params.id), Boolean(req.body?.done));
    if (!todo) { res.status(404).json({ error: 'not found' }); return; }
    res.json(todo);
  });

  app.post('/todos/:id/promote', async (req, res) => {
    try {
      res.json(await promoteTodo(db, Number(req.params.id)));
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });
}
```

- [ ] **Step 6: Write `engine/src/api/server.ts`**

```ts
import express from 'express';
import type Database from 'better-sqlite3';
import { registerTodayRoutes } from './routes/today.js';
import { registerProjectsRoutes } from './routes/projects.js';
import { registerTodosRoutes } from './routes/todos.js';

export function createServer(db: Database.Database, apiToken: string): express.Express {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    if (req.header('authorization') !== `Bearer ${apiToken}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });

  registerTodayRoutes(app, db);
  registerProjectsRoutes(app, db);
  registerTodosRoutes(app, db);

  return app;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd engine && pnpm vitest run tests/api/server.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 8: Commit**

```bash
cd engine && git add src/api/server.ts src/api/routes/today.ts src/api/routes/projects.ts src/api/routes/todos.ts tests/api/server.test.ts
git commit -m "Add HTTP API: auth, server, Today/Projects/Todos routes"
```

---

### Task 22: HTTP API — Tickets and PRs routes

New. Every route that triggers a long-running Claude/git operation wraps it in `acquireJob`/`finishJob` (Task 16) so a second request against the same ticket/PR gets a `409` instead of racing a worktree. The Merge button and a "merge it" chat message both end up calling `sendPrMessage(db, prId, 'merge it')` — one code path, so behavior can't drift between the two triggers the spec calls for.

**Files:**
- Create: `engine/src/api/routes/tickets.ts`
- Create: `engine/src/api/routes/prs.ts`
- Modify: `engine/src/api/server.ts` — register the two new route modules.
- Test: `engine/tests/api/tickets.test.ts`
- Test: `engine/tests/api/prs.test.ts`

**Interfaces:**
- Consumes: `listTickets`, `getTicket`, `listTicketMessages` from `../../tickets.js`; `sendTicketMessage` from `../../ticketChat.js`; `runFixPipeline` from `../../fixPipeline.js`; `listPrs`, `getPr`, `listPrMessages` from `../../prs.js`; `getProject` from `../../projects.js`; `sendPrMessage` from `../../prChat.js`; `acquireJob`, `finishJob` from `../../jobs.js`; `openWorktree`, `getDiff`, `removeWorktree` from `../../git.js`.
- Produces: the full ticket/PR HTTP surface the desktop app (a later plan) drives: `GET/POST /tickets`, `GET /tickets/:id`, `POST /tickets/:id/messages`, `POST /tickets/:id/create-pr`, `GET /prs`, `GET /prs/:id`, `GET /prs/:id/diff`, `POST /prs/:id/messages`, `POST /prs/:id/merge`.

- [ ] **Step 1: Write the failing tests**

```ts
// engine/tests/api/tickets.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createProject } from '../../src/projects.js';
import { createTicket } from '../../src/tickets.js';
import * as ticketChat from '../../src/ticketChat.js';
import * as fixPipeline from '../../src/fixPipeline.js';
import { createServer } from '../../src/api/server.js';

vi.mock('../../src/ticketChat.js');
vi.mock('../../src/fixPipeline.js');

const TOKEN = 'test-token';
let db: Database.Database;
let app: ReturnType<typeof createServer>;
let ticketId: number;

function auth(req: request.Test): request.Test {
  return req.set('Authorization', `Bearer ${TOKEN}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  app = createServer(db, TOKEN);
  const projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  ticketId = createTicket(db, {
    source: 'github', sourceId: 'GH-1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
  }).id;
});

describe('POST /tickets/:id/messages', () => {
  it('runs the chat turn and returns the reply', async () => {
    vi.mocked(ticketChat.sendTicketMessage).mockResolvedValue('sounds good');
    const res = await auth(request(app).post(`/tickets/${ticketId}/messages`)).send({ text: 'add retry logic' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'sounds good' });
  });

  it('rejects a second concurrent message with 409', async () => {
    let resolveChat: (v: string) => void;
    vi.mocked(ticketChat.sendTicketMessage).mockReturnValue(new Promise((r) => { resolveChat = r; }));

    const first = auth(request(app).post(`/tickets/${ticketId}/messages`)).send({ text: 'a' });
    await new Promise((r) => setTimeout(r, 10));
    const second = await auth(request(app).post(`/tickets/${ticketId}/messages`)).send({ text: 'b' });

    expect(second.status).toBe(409);
    resolveChat!('done');
    await first;
  });
});

describe('POST /tickets/:id/create-pr', () => {
  it('runs the fix pipeline and returns its result', async () => {
    vi.mocked(fixPipeline.runFixPipeline).mockResolvedValue({ ticketStatus: 'in_review', prId: 5 });
    const res = await auth(request(app).post(`/tickets/${ticketId}/create-pr`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ticketStatus: 'in_review', prId: 5 });
  });

  it('returns 500 with the error message when the pipeline throws', async () => {
    vi.mocked(fixPipeline.runFixPipeline).mockRejectedValue(new Error('implement session produced no changes'));
    const res = await auth(request(app).post(`/tickets/${ticketId}/create-pr`));
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('implement session produced no changes');
  });
});
```

```ts
// engine/tests/api/prs.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db.js';
import { createProject } from '../../src/projects.js';
import { createTicket } from '../../src/tickets.js';
import { recordPr } from '../../src/prs.js';
import * as prChat from '../../src/prChat.js';
import * as git from '../../src/git.js';
import { createServer } from '../../src/api/server.js';

vi.mock('../../src/prChat.js');
vi.mock('../../src/git.js');

const TOKEN = 'test-token';
let db: Database.Database;
let app: ReturnType<typeof createServer>;
let prId: number;

function auth(req: request.Test): request.Test {
  return req.set('Authorization', `Bearer ${TOKEN}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  app = createServer(db, TOKEN);
  const projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  const ticketId = createTicket(db, {
    source: 'github', sourceId: 'GH-1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
  }).id;
  prId = recordPr(db, { ticketId, projectId, branch: 'fix/gh-1', number: 5, url: 'https://x/pull/5', status: 'open' }).id;
});

describe('GET /prs/:id/diff', () => {
  it('opens the worktree, returns the diff, and cleans up', async () => {
    vi.mocked(git.openWorktree).mockResolvedValue('/repos/demo/.worktrees/fix-gh-1');
    vi.mocked(git.getDiff).mockResolvedValue('--- a/x.ts\n+++ b/x.ts');
    vi.mocked(git.removeWorktree).mockResolvedValue(undefined);

    const res = await auth(request(app).get(`/prs/${prId}/diff`));

    expect(res.body).toEqual({ diff: '--- a/x.ts\n+++ b/x.ts' });
    expect(git.removeWorktree).toHaveBeenCalledWith('/repos/demo', '/repos/demo/.worktrees/fix-gh-1');
  });
});

describe('POST /prs/:id/messages', () => {
  it('routes through sendPrMessage and returns its result', async () => {
    vi.mocked(prChat.sendPrMessage).mockResolvedValue({ action: 'revised', reply: 'done' });
    const res = await auth(request(app).post(`/prs/${prId}/messages`)).send({ text: 'also guard email' });
    expect(res.body).toEqual({ action: 'revised', reply: 'done' });
    expect(prChat.sendPrMessage).toHaveBeenCalledWith(db, prId, 'also guard email');
  });
});

describe('POST /prs/:id/merge', () => {
  it('calls sendPrMessage with the canonical merge phrase — same path as the chat trigger', async () => {
    vi.mocked(prChat.sendPrMessage).mockResolvedValue({ action: 'merged', reply: 'Merged https://x/pull/5.' });
    const res = await auth(request(app).post(`/prs/${prId}/merge`));
    expect(res.body.action).toBe('merged');
    expect(prChat.sendPrMessage).toHaveBeenCalledWith(db, prId, 'merge it');
  });

  it('rejects a merge while a chat revision is already running on the same PR', async () => {
    let resolveChat: (v: any) => void;
    vi.mocked(prChat.sendPrMessage).mockReturnValueOnce(new Promise((r) => { resolveChat = r; }));

    const chatCall = auth(request(app).post(`/prs/${prId}/messages`)).send({ text: 'x' });
    await new Promise((r) => setTimeout(r, 10));
    const mergeCall = await auth(request(app).post(`/prs/${prId}/merge`));

    expect(mergeCall.status).toBe(409);
    resolveChat!({ action: 'revised', reply: 'ok' });
    await chatCall;
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && pnpm vitest run tests/api/tickets.test.ts tests/api/prs.test.ts`
Expected: FAIL — `Cannot find module '../../src/api/routes/tickets.js'` / `'prs.js'`, plus a `404` from the not-yet-registered routes.

- [ ] **Step 3: Write `engine/src/api/routes/tickets.ts`**

```ts
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { listTickets, getTicket, listTicketMessages } from '../../tickets.js';
import { sendTicketMessage } from '../../ticketChat.js';
import { runFixPipeline } from '../../fixPipeline.js';
import { acquireJob, finishJob } from '../../jobs.js';

export function registerTicketsRoutes(app: Express, db: Database.Database): void {
  app.get('/tickets', (_req, res) => res.json(listTickets(db)));

  app.get('/tickets/:id', (req, res) => {
    const ticket = getTicket(db, Number(req.params.id));
    if (!ticket) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ ...ticket, messages: listTicketMessages(db, ticket.id) });
  });

  app.post('/tickets/:id/messages', async (req, res) => {
    const ticketId = Number(req.params.id);
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) { res.status(400).json({ error: 'text is required' }); return; }

    const job = acquireJob(db, 'spar', 'ticket', ticketId);
    if (!job) { res.status(409).json({ error: 'already working on this' }); return; }

    try {
      const reply = await sendTicketMessage(db, ticketId, text);
      finishJob(db, job.id, 'done');
      res.json({ reply });
    } catch (err) {
      finishJob(db, job.id, 'failed', String(err));
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/tickets/:id/create-pr', async (req, res) => {
    const ticketId = Number(req.params.id);
    const job = acquireJob(db, 'fix', 'ticket', ticketId);
    if (!job) { res.status(409).json({ error: 'already working on this' }); return; }

    try {
      const result = await runFixPipeline(db, ticketId);
      finishJob(db, job.id, 'done');
      res.json(result);
    } catch (err) {
      finishJob(db, job.id, 'failed', String(err));
      res.status(500).json({ error: String(err) });
    }
  });
}
```

- [ ] **Step 4: Write `engine/src/api/routes/prs.ts`**

```ts
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { listPrs, getPr, listPrMessages } from '../../prs.js';
import { getProject } from '../../projects.js';
import { sendPrMessage } from '../../prChat.js';
import { acquireJob, finishJob } from '../../jobs.js';
import { openWorktree, getDiff, removeWorktree } from '../../git.js';

export function registerPrsRoutes(app: Express, db: Database.Database): void {
  app.get('/prs', (_req, res) => res.json(listPrs(db)));

  app.get('/prs/:id', (req, res) => {
    const pr = getPr(db, Number(req.params.id));
    if (!pr) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ ...pr, messages: listPrMessages(db, pr.id) });
  });

  app.get('/prs/:id/diff', async (req, res) => {
    const pr = getPr(db, Number(req.params.id));
    if (!pr) { res.status(404).json({ error: 'not found' }); return; }
    const project = getProject(db, pr.projectId);
    if (!project) { res.status(404).json({ error: 'project not found' }); return; }

    const worktreePath = await openWorktree(project, pr.branch);
    try {
      res.json({ diff: await getDiff(worktreePath, project.defaultBranch) });
    } finally {
      await removeWorktree(project.repoPath, worktreePath);
    }
  });

  app.post('/prs/:id/messages', async (req, res) => {
    const prId = Number(req.params.id);
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) { res.status(400).json({ error: 'text is required' }); return; }

    const job = acquireJob(db, 'pr-chat', 'pr', prId);
    if (!job) { res.status(409).json({ error: 'already working on this' }); return; }

    try {
      const result = await sendPrMessage(db, prId, text);
      finishJob(db, job.id, 'done');
      res.json(result);
    } catch (err) {
      finishJob(db, job.id, 'failed', String(err));
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/prs/:id/merge', async (req, res) => {
    const prId = Number(req.params.id);
    const job = acquireJob(db, 'merge', 'pr', prId);
    if (!job) { res.status(409).json({ error: 'already working on this' }); return; }

    try {
      const result = await sendPrMessage(db, prId, 'merge it');
      finishJob(db, job.id, 'done');
      res.json(result);
    } catch (err) {
      finishJob(db, job.id, 'failed', String(err));
      res.status(500).json({ error: String(err) });
    }
  });
}
```

- [ ] **Step 5: Modify `engine/src/api/server.ts`** to register the new routes

```ts
import express from 'express';
import type Database from 'better-sqlite3';
import { registerTodayRoutes } from './routes/today.js';
import { registerProjectsRoutes } from './routes/projects.js';
import { registerTodosRoutes } from './routes/todos.js';
import { registerTicketsRoutes } from './routes/tickets.js';
import { registerPrsRoutes } from './routes/prs.js';

export function createServer(db: Database.Database, apiToken: string): express.Express {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    if (req.header('authorization') !== `Bearer ${apiToken}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });

  registerTodayRoutes(app, db);
  registerProjectsRoutes(app, db);
  registerTodosRoutes(app, db);
  registerTicketsRoutes(app, db);
  registerPrsRoutes(app, db);

  return app;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd engine && pnpm vitest run tests/api/tickets.test.ts tests/api/prs.test.ts`
Expected: PASS (4 + 4 tests).

- [ ] **Step 7: Commit**

```bash
cd engine && git add src/api/routes/tickets.ts src/api/routes/prs.ts src/api/server.ts tests/api/tickets.test.ts tests/api/prs.test.ts
git commit -m "Add HTTP API: Tickets and PRs routes with job locking"
```

---

### Task 23: Entry point — wire db, jobs, poller, and server together

New. This is bootstrap/wiring code with no branching logic of its own (matching issue-agent's own `cli.ts`, which is also untested directly) — verified by actually running the process and hitting it with `curl`, not a unit test. Login-item / launch-at-login registration is explicitly **out of scope** for this plan: that's owned by the `.app` bundle and belongs in the desktop-app plan, once there's an app bundle for `SMAppService` to register. Until then, the engine runs via `pnpm start`.

**Files:**
- Create: `engine/src/index.ts`

**Interfaces:**
- Consumes: `openDb`, `DB_PATH` from `./db.js`; `reconcileInterruptedJobs` from `./jobs.js`; `getOrCreateApiToken` from `./keychain.js`; `startPoller` from `./poller.js`; `createServer` from `./api/server.js`.
- Produces: the running engine process itself — nothing later in this plan depends on it, since it's the top of the dependency graph.

- [ ] **Step 1: Write `engine/src/index.ts`**

```ts
import { openDb, DB_PATH } from './db.js';
import { reconcileInterruptedJobs } from './jobs.js';
import { getOrCreateApiToken } from './keychain.js';
import { startPoller } from './poller.js';
import { createServer } from './api/server.js';

const PORT = 4173;

async function main(): Promise<void> {
  const db = openDb(DB_PATH);

  const interrupted = reconcileInterruptedJobs(db);
  if (interrupted > 0) console.log(`Marked ${interrupted} job(s) interrupted from a previous run.`);

  const apiToken = await getOrCreateApiToken();
  const stopPoller = startPoller(db);
  const app = createServer(db, apiToken);
  const server = app.listen(PORT, () => {
    console.log(`Workbench engine listening on http://localhost:${PORT}`);
  });

  const shutdown = () => {
    stopPoller();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the full test suite to confirm nothing regressed**

Run: `cd engine && pnpm test`
Expected: PASS — every test file from Tasks 1-22.

- [ ] **Step 3: Typecheck the whole project**

Run: `cd engine && pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Manually verify the process boots and serves requests**

Run: `cd engine && pnpm start` in one terminal. In another:

```bash
TOKEN=$(security find-generic-password -s workbench -a api-token -w)
curl -s http://localhost:4173/today -H "Authorization: Bearer $TOKEN"
```

Expected: `{"needsInput":[],"todos":[]}` (an empty Today view — no projects are configured yet, so the poller has nothing to fetch). Stop the process with Ctrl+C in the first terminal; confirm it exits cleanly.

- [ ] **Step 5: Commit**

```bash
cd engine && git add src/index.ts
git commit -m "Wire db, jobs, poller, and server together in the entry point"
```

---

## Manual end-to-end verification (after all tasks)

Once `config.json`-equivalent setup is done through the API instead of a file — `POST /projects` with a real repo path, `security add-generic-password -s workbench -a jira-api-token -w <token>` (and `jira-base-url`, `jira-email`, `sentry-auth-token`) — a full dry run looks like:

1. `pnpm start`, wait for the first poll cycle (5 minutes, or lower `startPoller`'s interval locally for a manual test).
2. `curl .../today` — confirm a Jira todo and/or a new ticket (from a real assigned Sentry/GitHub issue) show up.
3. `curl -X POST .../tickets/<id>/messages -d '{"text":"go ahead"}'` — confirm a reply comes back and the ticket status moves to `sparring`.
4. `curl -X POST .../tickets/<id>/create-pr` — confirm a real PR opens on GitHub and the ticket moves to `in_review` or `needs_attention`.
5. `curl -X POST .../prs/<id>/messages -d '{"text":"also handle the null case in the other branch"}'` — confirm the PR gets a new commit.
6. `curl -X POST .../prs/<id>/merge` — confirm the PR actually merges on GitHub and the branch is deleted.

This is the point at which the desktop-app plan (next) has a real API to build against.

## Known scope boundaries

Three things the design spec describes are deliberately not fully built in this plan — noted here so they're a visible follow-up rather than a silent gap:

- **Native notifications** (spec's Components section). Firing a real macOS notification and having a click bring a window forward requires `UNUserNotificationCenter`, which needs an app bundle — a bare Node process can't register for it properly. The engine already exposes everything a notifier needs to poll (`GET /today`, ticket/PR status); wiring actual notifications belongs in the desktop-app plan.
- **Retry-with-backoff and per-source auto-pause on repeated auth failure** (spec's Error Handling section). `runPollCycle` (Task 20) already isolates one failing source from the others each cycle and reports it in `sourceErrors` — safe, but it retries on the next plain 5-minute cycle rather than backing off, and never persists a "paused" state or surfaces it in Projects settings. Worth a small follow-up task once the core pipeline has real usage to tune against.
- **Reconciling PRs merged or closed outside the app** (spec's Error Handling section). The poller currently only fetches *new* issues; it doesn't re-check already-open PRs against GitHub's actual state. Until that exists, a PR merged by hand in GitHub will keep showing as `open` in Workbench until the next chat/merge action against it fails and surfaces the mismatch. A follow-up poller pass over `listPrs(db, { status: 'open' })` calling `gh pr view --json state` would close this.
- **Login-at-launch** for the engine process itself (noted in Task 23) is intentionally out of scope here — `SMAppService` registration needs the `.app` bundle, which doesn't exist until the desktop-app plan.

