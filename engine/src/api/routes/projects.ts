import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { listProjects, getProject, createProject, updateProject, deleteProject } from '../../projects.js';

export function registerProjectsRoutes(app: Express, db: Database.Database): void {
  app.get('/projects', (_req, res) => res.json(listProjects(db)));

  app.get('/projects/:id', (req, res) => {
    const project = getProject(db, Number(req.params.id));
    if (!project) { res.status(404).json({ error: 'not found' }); return; }
    res.json(project);
  });

  app.post('/projects', (req, res) => {
    res.status(201).json(createProject(db, req.body));
  });

  app.patch('/projects/:id', (req, res) => {
    const project = updateProject(db, Number(req.params.id), req.body);
    if (!project) { res.status(404).json({ error: 'not found' }); return; }
    res.json(project);
  });

  app.delete('/projects/:id', (req, res) => {
    deleteProject(db, Number(req.params.id));
    res.status(204).end();
  });
}
