import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket } from '../src/tickets.js';
import { recordPr } from '../src/prs.js';
import { buildReplyPrompt, draftReviewReply } from '../src/prReplyDraft.js';
import * as claude from '../src/claude.js';
import * as detail from '../src/sources/githubPrDetail.js';

vi.mock('../src/claude.js');
vi.mock('../src/sources/githubPrDetail.js');

let db: Database.Database;
let prId: number;

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  const projectId = createProject(db, {
    name: 'demo', repoPath: '/tmp/demo', defaultBranch: 'main',
    githubRepo: 'linku/demo', jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
  const ticketId = createTicket(db, {
    source: 'github', sourceId: 'GH-1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
  }).id;
  prId = recordPr(db, {
    ticketId, projectId, branch: 'fix/x', number: 23, url: 'https://x/pull/23', status: 'open',
  }).id;
});

describe('buildReplyPrompt', () => {
  it('carries the reviewer, their comment, the file and the hunk', () => {
    const prompt = buildReplyPrompt(
      { id: 1, author: 'sana', body: 'Does the ledger row stay pending?', path: 'src/capture.ts', diffHunk: '@@ -1 +1 @@\n+x' },
      'Retry card capture on 5xx'
    );
    expect(prompt).toContain('sana');
    expect(prompt).toContain('Does the ledger row stay pending?');
    expect(prompt).toContain('src/capture.ts');
    expect(prompt).toContain('@@ -1 +1 @@');
    expect(prompt).toContain('Retry card capture on 5xx');
  });

  it('tells the agent to write only the reply and to change nothing', () => {
    const prompt = buildReplyPrompt(
      { id: 1, author: 'sana', body: 'q', path: 'p', diffHunk: 'h' }, 'title'
    );
    expect(prompt).toMatch(/do not make any changes/i);
  });
});

describe('draftReviewReply', () => {
  it('returns the draft and writes nothing to GitHub', async () => {
    vi.mocked(detail.fetchReviewComment).mockResolvedValue({
      id: 1, author: 'sana', body: 'q', path: 'src/capture.ts', diffHunk: '@@ -1 +1 @@',
    });
    vi.mocked(claude.runClaude).mockResolvedValue('The ledger row is closed in the catch.');

    const draft = await draftReviewReply(db, prId, 1);

    expect(draft).toBe('The ledger row is closed in the catch.');
    expect(vi.mocked(claude.runClaude).mock.calls[0][0]).toMatchObject({
      cwd: '/tmp/demo',
      allowedTools: ['Read', 'Grep', 'Glob'],
    });
  });

  it('throws for an unknown pull request', async () => {
    await expect(draftReviewReply(db, 9999, 1)).rejects.toThrow(/not found/);
  });
});
