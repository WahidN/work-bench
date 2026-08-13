import type { Express } from 'express';
import type Database from 'better-sqlite3';
import {
  listProjects, getProject, createProject, updateProject, deleteProject, listProjectMessages,
} from '../../projects.js';
import { sendProjectMessage } from '../../projectChat.js';

export function registerProjectsRoutes(app: Express, db: Database.Database): void {
  app.get('/projects', (_req, res) => res.json(listProjects(db)));

  app.get('/projects/:id', (req, res) => {
    const project = getProject(db, Number(req.params.id));
    if (!project) { res.status(404).json({ error: 'not found' }); return; }
    res.json(project);
  });

  app.get('/projects/:id/messages', (req, res) => {
    const project = getProject(db, Number(req.params.id));
    if (!project) { res.status(404).json({ error: 'not found' }); return; }
    res.json(listProjectMessages(db, project.id));
  });

  app.post('/projects/:id/messages', async (req, res) => {
    const projectId = Number(req.params.id);
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) { res.status(400).json({ error: 'text is required' }); return; }
    if (!getProject(db, projectId)) { res.status(404).json({ error: 'not found' }); return; }

    try {
      const reply = await sendProjectMessage(db, projectId, text);
      res.json({ reply });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/projects', (req, res) => {
    const { name, repoPath, defaultBranch } = req.body ?? {};
    for (const [field, value] of Object.entries({ name, repoPath, defaultBranch })) {
      if (typeof value !== 'string' || !value.trim()) {
        res.status(400).json({ error: `${field} is required` });
        return;
      }
    }
    res.status(201).json(createProject(db, {
      name, repoPath, defaultBranch,
      githubRepo: req.body.githubRepo ?? null,
      jiraProjectKey: req.body.jiraProjectKey ?? null,
      sentryProjectSlug: req.body.sentryProjectSlug ?? null,
    }));
  });

  app.patch('/projects/:id', (req, res) => {
    const project = updateProject(db, Number(req.params.id), req.body);
    if (!project) { res.status(404).json({ error: 'not found' }); return; }
    res.json(project);
  });

  app.delete('/projects/:id', (req, res) => {
    try {
      deleteProject(db, Number(req.params.id));
    } catch (err) {
      if (String(err).includes('FOREIGN KEY constraint failed')) {
        res.status(409).json({ error: 'project still has tickets or todos referencing it' });
        return;
      }
      throw err;
    }
    res.status(204).end();
  });
}
