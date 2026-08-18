import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket, getTicket, updateTicketStatus } from '../src/tickets.js';
import { recordPr, getPr, listPrs, updatePrStatus, addPrMessage, listPrMessages, setPrPinned, upsertGithubPr, reconcileGithubPrs } from '../src/prs.js';

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

  it('defaults the github columns and counts messages', () => {
    const db = openDb(':memory:');
    const project = createProject(db, { name: 'P', repoPath: '/tmp/p', defaultBranch: 'main', githubRepo: 'linku/demo', jiraProjectKey: null, sentryProjectSlug: null, status: 'active', blurb: '' });
    const pr = recordPr(db, { ticketId: null, projectId: project.id, branch: 'fix/x', number: 7, url: 'u', status: 'open' });
    expect(pr.title).toBe('');
    expect(pr.reviewState).toBeNull();
    expect(pr.isDraft).toBe(false);
    expect(pr.githubUpdatedAt).toBeNull();
    expect(pr.authoredByMe).toBe(false);
    expect(pr.assignedToMe).toBe(false);
    expect(pr.messageCount).toBe(0);

    addPrMessage(db, pr.id, 'user', 'hello');
    expect(getPr(db, pr.id)!.messageCount).toBe(1);
    expect(listPrs(db)[0].messageCount).toBe(1);
  });
});

describe('a PR without a ticket', () => {
  it('reads back with a null ticketId', () => {
    db.prepare(
      `INSERT INTO prs (ticket_id, project_id, branch, number, url, status, created_at)
       VALUES (NULL, ?, 'feat/header', 23, 'https://github.com/x/pull/23', 'open', '2026-08-12T17:31:06.792Z')`
    ).run(projectId);

    expect(listPrs(db).map((p) => p.ticketId)).toEqual([null]);
  });
});

describe('pinning a PR', () => {
  it('defaults to not pinned and toggles both ways', () => {
    const pr = recordPr(db, {
      ticketId, projectId, branch: 'fix/gh-demo-1',
      number: 142, url: 'https://github.com/x/pull/142', status: 'open',
    });

    expect(pr.pinned).toBe(false);
    expect(setPrPinned(db, pr.id, true)!.pinned).toBe(true);
    expect(setPrPinned(db, pr.id, false)!.pinned).toBe(false);
  });

  it('returns null for a PR that does not exist', () => {
    expect(setPrPinned(db, 999, true)).toBeNull();
  });
});

describe('upserting a github PR', () => {
  it('converges a pipeline PR and its github twin onto one row', () => {
    const db = openDb(':memory:');
    const project = createProject(db, { name: 'P', repoPath: '/tmp/p', defaultBranch: 'main', githubRepo: 'linku/demo', jiraProjectKey: null, sentryProjectSlug: null, status: 'active', blurb: '' });
    const local = recordPr(db, { ticketId: null, projectId: project.id, branch: 'fix/x', number: 7, url: 'u', status: 'open' });

    const merged = upsertGithubPr(db, {
      projectId: project.id, number: 7, title: 'Fix x', url: 'u2',
      githubUpdatedAt: '2026-08-17T10:00:00Z', isDraft: false,
      authoredByMe: true, assignedToMe: false, reviewState: 'approved', branch: 'fix/x',
    });

    expect(merged.id).toBe(local.id);
    expect(listPrs(db)).toHaveLength(1);
    expect(merged.title).toBe('Fix x');
    expect(merged.branch).toBe('fix/x');
  });

  it('stores the head branch of a PR the pipeline never created', () => {
    const db = openDb(':memory:');
    const project = createProject(db, { name: 'P', repoPath: '/tmp/p', defaultBranch: 'main', githubRepo: 'linku/demo', jiraProjectKey: null, sentryProjectSlug: null, status: 'active', blurb: '' });
    const pr = upsertGithubPr(db, {
      projectId: project.id, number: 9, title: 'From github', url: 'u',
      githubUpdatedAt: '2026-08-17T10:00:00Z', isDraft: true,
      authoredByMe: false, assignedToMe: true, reviewState: null, branch: 'feat/from-github',
    });
    // The branch is what makes this row workable: openDetachedWorktree builds from
    // origin/<branch>, so the agent panel needs nothing to exist locally.
    expect(pr.branch).toBe('feat/from-github');
    expect(pr.ticketId).toBeNull();
    expect(pr.isDraft).toBe(true);
  });
});

describe('reconciling github PRs', () => {
  it('deletes a PR that no longer comes back from github', () => {
    const db = openDb(':memory:');
    const project = createProject(db, { name: 'P', repoPath: '/tmp/p', defaultBranch: 'main', githubRepo: 'linku/demo', jiraProjectKey: null, sentryProjectSlug: null, status: 'active', blurb: '' });
    recordPr(db, { ticketId: null, projectId: project.id, branch: 'a', number: 1, url: 'u1', status: 'open' });
    recordPr(db, { ticketId: null, projectId: project.id, branch: 'b', number: 2, url: 'u2', status: 'open' });

    const removed = reconcileGithubPrs(db, [project.id], [{ projectId: project.id, number: 1 }]);
    expect(removed).toBe(1);
    expect(listPrs(db).map((p) => p.number)).toEqual([1]);
  });

  it('never deletes a PR that has no number yet', () => {
    const db = openDb(':memory:');
    const project = createProject(db, { name: 'P', repoPath: '/tmp/p', defaultBranch: 'main', githubRepo: 'linku/demo', jiraProjectKey: null, sentryProjectSlug: null, status: 'active', blurb: '' });
    recordPr(db, { ticketId: null, projectId: project.id, branch: 'a', number: null, url: null, status: 'open' });
    reconcileGithubPrs(db, [project.id], [{ projectId: project.id, number: 99 }]);
    expect(listPrs(db)).toHaveLength(1);
  });

  it('deletes a pipeline PR that a ticket still points at', () => {
    const db = openDb(':memory:');
    const project = createProject(db, { name: 'P', repoPath: '/tmp/p', defaultBranch: 'main', githubRepo: 'linku/demo', jiraProjectKey: null, sentryProjectSlug: null, status: 'active', blurb: '' });
    const ticket = createTicket(db, {
      source: 'github', sourceId: 'GH-demo#1', projectId: project.id, title: 't', body: 'b', url: 'u', analysis: null,
    });
    const pr = recordPr(db, { ticketId: ticket.id, projectId: project.id, branch: 'fix/gh-demo-1', number: 42, url: 'u42', status: 'open' });
    updateTicketStatus(db, ticket.id, 'in_review', pr.id);

    const removed = reconcileGithubPrs(db, [project.id], [{ projectId: project.id, number: 7 }]);

    expect(removed).toBe(1);
    expect(listPrs(db)).toEqual([]);
    expect(getTicket(db, ticket.id)!.prId).toBeNull();
  });

  it('skips reconciliation entirely when the fetch came back empty', () => {
    const db = openDb(':memory:');
    const project = createProject(db, { name: 'P', repoPath: '/tmp/p', defaultBranch: 'main', githubRepo: 'linku/demo', jiraProjectKey: null, sentryProjectSlug: null, status: 'active', blurb: '' });
    recordPr(db, { ticketId: null, projectId: project.id, branch: 'a', number: 1, url: 'u1', status: 'open' });
    expect(reconcileGithubPrs(db, [project.id], [])).toBe(0);
    expect(listPrs(db)).toHaveLength(1);
  });
});
