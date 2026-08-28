// Separate from poller.test.ts because this one runs against the real todos
// module, to prove nothing is actually deleted from the database.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { listTodos, upsertJiraTodo } from '../src/todos.js';
import * as jiraSource from '../src/sources/jira.js';
import * as sentrySource from '../src/sources/sentry.js';
import * as githubSource from '../src/sources/github.js';
import { getSecret } from '../src/keychain.js';
import { runPollCycle } from '../src/poller.js';

vi.mock('../src/sources/jira.js');
vi.mock('../src/sources/sentry.js');
vi.mock('../src/sources/github.js');
vi.mock('../src/keychain.js');

let db: Database.Database;

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  const project = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: 'DEMO', sentryProjectSlug: null,
  });
  upsertJiraTodo(db, { source: 'jira', sourceId: 'JIRA-DEMO-1', title: 'Update env vars', url: 'u', body: 'b', projectKey: 'DEMO', statusName: null, statusCategory: null }, project);
  upsertJiraTodo(db, { source: 'jira', sourceId: 'JIRA-DEMO-2', title: 'Renew cert', url: 'u', body: 'b', projectKey: 'DEMO', statusName: null, statusCategory: null }, project);

  vi.mocked(jiraSource.fetchAssignedJiraIssues).mockResolvedValue([]);
  vi.mocked(sentrySource.fetchSentryIssues).mockResolvedValue([]);
  vi.mocked(githubSource.fetchGithubIssues).mockResolvedValue([]);
  vi.mocked(getSecret).mockResolvedValue(null);
});

describe('runPollCycle jira todo safety', () => {
  it('keeps existing jira todos when the Jira fetch comes back empty', async () => {
    await runPollCycle(db);

    expect(listTodos(db).map((t) => t.sourceId)).toEqual(['JIRA-DEMO-1', 'JIRA-DEMO-2']);
  });

  it('still removes a jira todo that is genuinely gone from a non-empty result', async () => {
    vi.mocked(jiraSource.fetchAssignedJiraIssues).mockResolvedValue([
      { source: 'jira', sourceId: 'JIRA-DEMO-1', title: 'Update env vars', url: 'u', body: 'b', projectKey: 'DEMO', statusName: null, statusCategory: null },
    ]);

    await runPollCycle(db);

    expect(listTodos(db).map((t) => t.sourceId)).toEqual(['JIRA-DEMO-1']);
  });
});
