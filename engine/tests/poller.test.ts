import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { listTickets } from '../src/tickets.js';
import * as jiraSource from '../src/sources/jira.js';
import * as sentrySource from '../src/sources/sentry.js';
import * as githubSource from '../src/sources/github.js';
import { fetchMyOpenPrs, fetchPrDetail } from '../src/sources/githubPrs.js';
import * as analyze from '../src/analyze.js';
import * as todos from '../src/todos.js';
import { listPrs, upsertGithubPr } from '../src/prs.js';
import { getSecret } from '../src/keychain.js';
import { runPollCycle, startPoller } from '../src/poller.js';

vi.mock('../src/sources/jira.js');
vi.mock('../src/sources/sentry.js');
// A factory keeps toRepoSlug real: poller.ts uses it to match a pull request's
// repo against a project, and an automocked toRepoSlug would just return
// undefined, so every pull request would fail to match its project.
vi.mock('../src/sources/github.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sources/github.js')>();
  return { ...actual, fetchGithubIssues: vi.fn() };
});
vi.mock('../src/sources/githubPrs.js');
vi.mock('../src/analyze.js');
vi.mock('../src/todos.js');
vi.mock('../src/keychain.js');

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
  vi.mocked(fetchMyOpenPrs).mockResolvedValue([]);
  vi.mocked(getSecret).mockResolvedValue('linku-bv');
  vi.mocked(todos.countJiraTodos).mockReturnValue(0);
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

  it('passes the Sentry org from the keychain, not a hardcoded one', async () => {
    await runPollCycle(db);

    expect(getSecret).toHaveBeenCalledWith('sentry-org');
    expect(sentrySource.fetchSentryIssues).toHaveBeenCalledWith('linku-bv', ['demo-frontend']);
  });

  it('skips Sentry without an error when the org secret is not set', async () => {
    vi.mocked(getSecret).mockResolvedValue(null);

    const summary = await runPollCycle(db);

    expect(sentrySource.fetchSentryIssues).not.toHaveBeenCalled();
    expect(summary.sourceErrors).toEqual([]);
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

  it('keeps going when one issue fails to analyse and records why', async () => {
    vi.mocked(githubSource.fetchGithubIssues).mockResolvedValue([
      { source: 'github', sourceId: 'GH-linku/demo#1', title: 'Broken', url: 'u', body: 'b', projectKey: 'linku/demo' },
      { source: 'github', sourceId: 'GH-linku/demo#2', title: 'Fine', url: 'u', body: 'b', projectKey: 'linku/demo' },
    ]);
    vi.mocked(analyze.analyzeIssue)
      .mockRejectedValueOnce(new Error('Claude did not return valid JSON after 2 attempts'))
      .mockResolvedValue({ summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: [], confidence: 'high' });

    const summary = await runPollCycle(db);

    expect(summary.ticketsCreated).toBe(1);
    expect(listTickets(db).map((t) => t.sourceId)).toEqual(['GH-linku/demo#2']);
    expect(summary.sourceErrors).toEqual([
      'github:GH-linku/demo#1 analysis failed: Claude did not return valid JSON after 2 attempts',
    ]);
  });

  it('skips Jira reconciliation when an empty result would wipe existing todos', async () => {
    vi.mocked(todos.countJiraTodos).mockReturnValue(3);

    await runPollCycle(db);

    expect(todos.reconcileJiraTodos).not.toHaveBeenCalled();
  });

  it('still reconciles an empty Jira result when there are no jira todos to lose', async () => {
    vi.mocked(todos.countJiraTodos).mockReturnValue(0);

    await runPollCycle(db);

    expect(todos.reconcileJiraTodos).toHaveBeenCalledWith(db, []);
  });

  it('syncs github pull requests and reports the count', async () => {
    const db = openDb(':memory:');
    createProject(db, { name: 'P', repoPath: '/tmp/p', defaultBranch: 'main', githubRepo: 'linku/demo', jiraProjectKey: null, sentryProjectSlug: null, status: 'active', blurb: '' });

    vi.mocked(fetchMyOpenPrs).mockResolvedValue([{
      repo: 'linku/demo', number: 24, title: 'Guard the deploy', url: 'u',
      updatedAt: '2026-08-17T10:00:00Z', isDraft: false, authoredByMe: true, assignedToMe: false,
    }]);
    vi.mocked(fetchPrDetail).mockResolvedValue({ reviewState: 'approved', headRefName: 'feat/deploy-guard' });

    const summary = await runPollCycle(db);
    expect(summary.prsSynced).toBe(1);
    expect(listPrs(db)[0]).toMatchObject({
      number: 24, title: 'Guard the deploy', reviewState: 'approved', branch: 'feat/deploy-guard',
    });
  });

  it('maps a pull request whose repo casing differs from the project', async () => {
    const db = openDb(':memory:');
    createProject(db, { name: 'P', repoPath: '/tmp/p', defaultBranch: 'main', githubRepo: 'Linku/ACV-Website', jiraProjectKey: null, sentryProjectSlug: null, status: 'active', blurb: '' });

    vi.mocked(fetchMyOpenPrs).mockResolvedValue([{
      repo: 'linku/acv-website', number: 24, title: 'Guard the deploy', url: 'u',
      updatedAt: '2026-08-17T10:00:00Z', isDraft: false, authoredByMe: true, assignedToMe: false,
    }]);
    vi.mocked(fetchPrDetail).mockResolvedValue({ reviewState: 'approved', headRefName: 'feat/deploy-guard' });

    const summary = await runPollCycle(db);
    expect(summary.prsSynced).toBe(1);
    expect(listPrs(db)).toHaveLength(1);
  });

  it('reports a github pull request failure without aborting the cycle', async () => {
    const db = openDb(':memory:');
    vi.mocked(fetchMyOpenPrs).mockRejectedValue(new Error('gh exploded'));
    const summary = await runPollCycle(db);
    expect(summary.sourceErrors.some((e) => e.includes('gh exploded'))).toBe(true);
  });

  it('keeps the previous review state and branch when the per-PR lookup fails', async () => {
    const db = openDb(':memory:');
    const project = createProject(db, { name: 'P', repoPath: '/tmp/p', defaultBranch: 'main', githubRepo: 'linku/demo', jiraProjectKey: null, sentryProjectSlug: null, status: 'active', blurb: '' });
    upsertGithubPr(db, { projectId: project.id, number: 24, title: 't', url: 'u', githubUpdatedAt: 'x', isDraft: false, authoredByMe: true, assignedToMe: false, reviewState: 'approved', branch: 'feat/keep-me' });

    vi.mocked(fetchMyOpenPrs).mockResolvedValue([{
      repo: 'linku/demo', number: 24, title: 't', url: 'u',
      updatedAt: '2026-08-17T11:00:00Z', isDraft: false, authoredByMe: true, assignedToMe: false,
    }]);
    vi.mocked(fetchPrDetail).mockRejectedValue(new Error('rate limited'));

    await runPollCycle(db);
    expect(listPrs(db)[0]).toMatchObject({ reviewState: 'approved', branch: 'feat/keep-me' });
  });
});

describe('startPoller', () => {
  it('runs a first cycle immediately instead of after the first interval', async () => {
    const stop = startPoller(db, 60_000);
    await vi.waitFor(() => expect(githubSource.fetchGithubIssues).toHaveBeenCalledTimes(1));
    stop();
  });

  it('skips a tick while the previous cycle is still running', async () => {
    let releaseFetch: () => void;
    vi.mocked(githubSource.fetchGithubIssues).mockReturnValueOnce(
      new Promise((resolve) => { releaseFetch = () => resolve([]); })
    );

    const stop = startPoller(db, 5);
    await new Promise((r) => setTimeout(r, 40));

    expect(githubSource.fetchGithubIssues).toHaveBeenCalledTimes(1);

    stop();
    releaseFetch!();
    await new Promise((r) => setTimeout(r, 10));
  });
});
