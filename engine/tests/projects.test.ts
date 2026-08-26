import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { listProjects, getProject, createProject, updateProject, deleteProject, listProjectMessages, addProjectMessage, setProjectNotes } from '../src/projects.js';
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

describe('project status and blurb', () => {
  it('defaults a new project to active with an empty blurb', () => {
    const project = createProject(db, {
      name: 'atlas', repoPath: '/repos/atlas', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });

    expect(project.status).toBe('active');
    expect(project.blurb).toBe('');
  });

  it('accepts a status and a blurb on create', () => {
    const project = createProject(db, {
      name: 'drydock', repoPath: '/repos/drydock', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
      status: 'paused', blurb: 'Build pipeline consolidation.',
    });

    expect(project.status).toBe('paused');
    expect(project.blurb).toBe('Build pipeline consolidation.');
  });

  it('updates the status and blurb without disturbing the other fields', () => {
    const project = createProject(db, {
      name: 'ledger', repoPath: '/repos/ledger', defaultBranch: 'main',
      githubRepo: 'acme/ledger', jiraProjectKey: 'LED', sentryProjectSlug: null,
    });

    const updated = updateProject(db, project.id, { status: 'planning', blurb: 'Q3 discovery.' })!;

    expect(updated.status).toBe('planning');
    expect(updated.blurb).toBe('Q3 discovery.');
    expect(updated.githubRepo).toBe('acme/ledger');
    expect(updated.jiraProjectKey).toBe('LED');
    expect(updated.repoPath).toBe('/repos/ledger');
  });

  it('rejects a status outside the allowed set', () => {
    const project = createProject(db, {
      name: 'relay', repoPath: '/repos/relay', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });

    expect(() => updateProject(db, project.id, { status: 'archived' as any })).toThrow(/CHECK/);
  });
});

describe('setProjectNotes', () => {
  it('writes notes and leaves every other column untouched', () => {
    const db = openDb(':memory:');
    const project = createProject(db, {
      name: 'Atlas Payments', repoPath: '/repos/atlas', defaultBranch: 'main',
      githubRepo: 'acme/atlas', jiraProjectKey: 'ATL', sentryProjectSlug: null,
    });

    const updated = setProjectNotes(db, project.id, 'Ship the card capture rewrite.');

    expect(updated).toEqual({ ...project, notes: 'Ship the card capture rewrite.' });
  });

  it('starts a project off with empty notes', () => {
    const db = openDb(':memory:');
    const project = createProject(db, {
      name: 'Relay', repoPath: '/repos/relay', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });

    expect(project.notes).toBe('');
  });

  it('accepts an empty string, because clearing your notes is a real edit', () => {
    const db = openDb(':memory:');
    const project = createProject(db, {
      name: 'Relay', repoPath: '/repos/relay', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    setProjectNotes(db, project.id, 'something');

    expect(setProjectNotes(db, project.id, '')?.notes).toBe('');
  });

  it('returns null for a project that does not exist', () => {
    const db = openDb(':memory:');
    expect(setProjectNotes(db, 999, 'x')).toBeNull();
  });

  it('is not disturbed by updateProject, which must leave notes alone', () => {
    const db = openDb(':memory:');
    const project = createProject(db, {
      name: 'Atlas', repoPath: '/repos/atlas', defaultBranch: 'main',
      githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
    });
    setProjectNotes(db, project.id, 'keep me');

    const updated = updateProject(db, project.id, { blurb: 'new blurb' });

    expect(updated?.notes).toBe('keep me');
    expect(updated?.blurb).toBe('new blurb');
  });
});
