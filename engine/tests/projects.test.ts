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
