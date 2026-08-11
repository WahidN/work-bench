import type Database from 'better-sqlite3';
import { listProjects } from './projects.js';
import { fetchAssignedJiraIssues } from './sources/jira.js';
import { fetchSentryIssues } from './sources/sentry.js';
import { fetchGithubIssues } from './sources/github.js';
import { analyzeIssue } from './analyze.js';
import { findTicketBySource, createTicket } from './tickets.js';
import { upsertJiraTodo, reconcileJiraTodos } from './todos.js';
import { getSecret } from './keychain.js';
import type { SourceIssue, Project } from './types.js';

export interface PollSummary {
  jiraTodos: number;
  ticketsCreated: number;
  sourceErrors: string[];
}

function findProjectByKey(projects: Project[], field: 'jiraProjectKey' | 'githubRepo' | 'sentryProjectSlug', key: string): Project | null {
  return projects.find((p) => p[field] === key) ?? null;
}

export async function runPollCycle(db: Database.Database): Promise<PollSummary> {
  const projects = listProjects(db);
  const summary: PollSummary = { jiraTodos: 0, ticketsCreated: 0, sourceErrors: [] };

  const sentrySlugs = projects.filter((p) => p.sentryProjectSlug).map((p) => p.sentryProjectSlug!);
  const githubRepos = projects.filter((p) => p.githubRepo).map((p) => p.githubRepo!);

  // Without an org there is no Sentry URL to call, so skip the fetch the same
  // way fetchSentryIssues skips a missing token or empty project list.
  const sentryOrg = await getSecret('sentry-org');

  const results = await Promise.allSettled([
    fetchAssignedJiraIssues(),
    sentryOrg ? fetchSentryIssues(sentryOrg, sentrySlugs) : Promise.resolve([]),
    fetchGithubIssues(githubRepos),
  ]);
  const names = ['jira', 'sentry', 'github'] as const;
  const issuesBySource: SourceIssue[][] = [[], [], []];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') issuesBySource[i] = result.value;
    else summary.sourceErrors.push(`${names[i]}: ${result.reason.message ?? String(result.reason)}`);
  });

  for (const issue of issuesBySource[0]) {
    const project = findProjectByKey(projects, 'jiraProjectKey', issue.projectKey);
    upsertJiraTodo(db, issue, project);
    summary.jiraTodos++;
  }
  if (results[0].status === 'fulfilled') {
    reconcileJiraTodos(db, issuesBySource[0].map((issue) => issue.sourceId));
  }

  for (const issue of [...issuesBySource[1], ...issuesBySource[2]]) {
    if (findTicketBySource(db, issue.source, issue.sourceId)) continue;
    const field = issue.source === 'sentry' ? 'sentryProjectSlug' : 'githubRepo';
    const project = findProjectByKey(projects, field, issue.projectKey);
    if (!project) continue;
    const analysis = await analyzeIssue(issue, project);
    createTicket(db, {
      source: issue.source, sourceId: issue.sourceId, projectId: project.id,
      title: issue.title, body: issue.body, url: issue.url, analysis,
    });
    summary.ticketsCreated++;
  }

  return summary;
}

export function startPoller(db: Database.Database, intervalMs: number = 5 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    runPollCycle(db).catch((err) => console.error('poll cycle failed', err));
  }, intervalMs);
  return () => clearInterval(timer);
}
