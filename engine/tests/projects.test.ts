import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { listProjects, getProject, createProject, updateProject, deleteProject, listProjectMessages, addProjectMessage } from '../src/projects.js';
import { createTicket } from '../src/tickets.js';

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

  it('deleteProject also removes the chat thread, so a used project stays deletable', () => {
    const created = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    addProjectMessage(db, created.id, 'user', 'catch me up');
    addProjectMessage(db, created.id, 'assistant', 'two PRs are waiting');

    deleteProject(db, created.id);

    expect(getProject(db, created.id)).toBeNull();
    expect(listProjectMessages(db, created.id)).toEqual([]);
  });

  it('deleteProject still fails while a ticket references the project, and keeps the thread', () => {
    const created = createProject(db, {
      name: 'busy', repoPath: '/repos/busy', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    addProjectMessage(db, created.id, 'user', 'catch me up');
    createTicket(db, {
      source: 'github', sourceId: 'GH-9', projectId: created.id,
      title: 't', body: 'b', url: 'u', analysis: null,
    });

    expect(() => deleteProject(db, created.id)).toThrow(/FOREIGN KEY constraint failed/);
    expect(getProject(db, created.id)).not.toBeNull();
    expect(listProjectMessages(db, created.id)).toHaveLength(1);
  });
});

describe('project messages', () => {
  it('returns an empty thread for a project with no messages', () => {
    const project = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    expect(listProjectMessages(db, project.id)).toEqual([]);
  });

  it('appends messages and returns them in insertion order', () => {
    const project = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    addProjectMessage(db, project.id, 'user', 'what should I do first?');
    addProjectMessage(db, project.id, 'assistant', 'start with the refund retry');

    expect(listProjectMessages(db, project.id).map((m) => [m.role, m.content])).toEqual([
      ['user', 'what should I do first?'],
      ['assistant', 'start with the refund retry'],
    ]);
  });

  it('keeps each project thread separate', () => {
    const a = createProject(db, {
      name: 'a', repoPath: '/repos/a', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    const b = createProject(db, {
      name: 'b', repoPath: '/repos/b', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    addProjectMessage(db, a.id, 'user', 'for a');

    expect(listProjectMessages(db, a.id)).toHaveLength(1);
    expect(listProjectMessages(db, b.id)).toEqual([]);
  });

  it('returns the row it inserted, with the project id mapped from snake_case', () => {
    const project = createProject(db, {
      name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    const message = addProjectMessage(db, project.id, 'user', 'hi');

    expect(message.projectId).toBe(project.id);
    expect(message.role).toBe('user');
    expect(message.content).toBe('hi');
    expect(message.createdAt).toBeTypeOf('string');
  });
});
