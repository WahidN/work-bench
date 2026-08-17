import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket } from '../src/tickets.js';
import { recordPr, getPr, listPrs, updatePrStatus, addPrMessage, listPrMessages, setPrPinned } from '../src/prs.js';

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
