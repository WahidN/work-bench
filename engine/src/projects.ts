import type Database from 'better-sqlite3';
import type { Project, ProjectMessage, ProjectStatus } from './types.js';

function rowToProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    repoPath: row.repo_path,
    defaultBranch: row.default_branch,
    githubRepo: row.github_repo,
    jiraProjectKey: row.jira_project_key,
    sentryProjectSlug: row.sentry_project_slug,
    status: row.status,
    blurb: row.blurb,
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
  status?: ProjectStatus;
  blurb?: string;
}

export function createProject(db: Database.Database, input: ProjectInput): Project {
  const result = db
    .prepare(
      `INSERT INTO projects (name, repo_path, default_branch, github_repo, jira_project_key, sentry_project_slug, status, blurb)
       VALUES (@name, @repoPath, @defaultBranch, @githubRepo, @jiraProjectKey, @sentryProjectSlug, @status, @blurb)`
    )
    .run({ ...input, status: input.status ?? 'active', blurb: input.blurb ?? '' });
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
     github_repo = @githubRepo, jira_project_key = @jiraProjectKey, sentry_project_slug = @sentryProjectSlug,
     status = @status, blurb = @blurb
     WHERE id = @id`
  ).run({ ...merged, repoPath: merged.repoPath, defaultBranch: merged.defaultBranch, id });
  return getProject(db, id);
}

// The chat thread belongs to the project, so it goes with it. The schema has no
// ON DELETE CASCADE, and adding one would not reach databases that already exist.
// Tickets and todos are deliberately left to the foreign key, so deleting a
// project that still has those keeps failing and the route keeps answering 409.
export function deleteProject(db: Database.Database, id: number): void {
  db.transaction(() => {
    db.prepare('DELETE FROM project_messages WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  })();
}

function rowToProjectMessage(row: any): ProjectMessage {
  return {
    id: row.id,
    projectId: row.project_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function listProjectMessages(db: Database.Database, projectId: number): ProjectMessage[] {
  return db
    .prepare('SELECT * FROM project_messages WHERE project_id = ? ORDER BY id')
    .all(projectId)
    .map(rowToProjectMessage);
}

export function addProjectMessage(
  db: Database.Database,
  projectId: number,
  role: 'user' | 'assistant',
  content: string
): ProjectMessage {
  const result = db
    .prepare('INSERT INTO project_messages (project_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(projectId, role, content, new Date().toISOString());
  return rowToProjectMessage(
    db.prepare('SELECT * FROM project_messages WHERE id = ?').get(result.lastInsertRowid)
  );
}
