import type Database from 'better-sqlite3';
import { listProjects } from './projects.js';
import { fetchAssignedJiraIssues } from './sources/jira.js';
import { fetchSentryIssues } from './sources/sentry.js';
import { fetchGithubIssues, toRepoSlug } from './sources/github.js';
import { fetchMyOpenPrs, fetchPrDetail } from './sources/githubPrs.js';
import { analyzeIssue } from './analyze.js';
import { findTicketBySource, createTicket } from './tickets.js';
import { upsertJiraTodo, reconcileJiraTodos, countJiraTodos } from './todos.js';
import { upsertGithubPr, reconcileGithubPrs, findPrByNumber } from './prs.js';
import { getSecret } from './keychain.js';
import type { SourceIssue, Project } from './types.js';

export interface PollSummary {
  jiraTodos: number;
  ticketsCreated: number;
  prsSynced: number;
  sourceErrors: string[];
}

function findProjectByKey(projects: Project[], field: 'jiraProjectKey' | 'githubRepo' | 'sentryProjectSlug', key: string): Project | null {
  return projects.find((p) => p[field] === key) ?? null;
}

/// One search pair plus one review lookup per pull request. A failed review
/// lookup keeps whatever the row already had, so a single flaky call cannot
/// quietly downgrade an approved PR to "Needs review".
async function syncGithubPrs(db: Database.Database, projects: Project[]): Promise<number> {
  const mapped = projects.filter((p) => p.githubRepo);
  const found = await fetchMyOpenPrs(mapped.map((p) => p.githubRepo!));
  const seen: Array<{ projectId: number; number: number }> = [];

  for (const pr of found) {
    const project = mapped.find((p) => toRepoSlug(p.githubRepo!) === pr.repo);
    if (!project) continue;

    const previous = findPrByNumber(db, project.id, pr.number);
    let reviewState = previous?.reviewState ?? null;
    let branch = previous?.branch ?? '';
    try {
      const detail = await fetchPrDetail(pr.repo, pr.number);
      reviewState = detail.reviewState;
      if (detail.headRefName) branch = detail.headRefName;
    } catch (err) {
      console.error('github prs: detail lookup failed for', pr.url, String(err));
    }

    upsertGithubPr(db, {
      projectId: project.id, number: pr.number, title: pr.title, url: pr.url,
      githubUpdatedAt: pr.updatedAt, isDraft: pr.isDraft,
      authoredByMe: pr.authoredByMe, assignedToMe: pr.assignedToMe, reviewState, branch,
    });
    seen.push({ projectId: project.id, number: pr.number });
  }

  reconcileGithubPrs(db, mapped.map((p) => p.id), seen);
  return seen.length;
}

export async function runPollCycle(db: Database.Database): Promise<PollSummary> {
  const projects = listProjects(db);
  const summary: PollSummary = { jiraTodos: 0, ticketsCreated: 0, prsSynced: 0, sourceErrors: [] };

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
    const sourceIds = issuesBySource[0].map((issue) => issue.sourceId);
    // An empty Jira result on a setup that has Jira todos is more likely a
    // credential or Keychain problem than a genuinely empty board, and
    // reconciling would delete every todo with its done state. Skip instead.
    if (sourceIds.length > 0 || countJiraTodos(db) === 0) {
      reconcileJiraTodos(db, sourceIds);
    } else {
      console.warn('Jira returned 0 issues while jira todos exist; skipping reconciliation this cycle');
    }
  }

  for (const issue of [...issuesBySource[1], ...issuesBySource[2]]) {
    if (findTicketBySource(db, issue.source, issue.sourceId)) continue;
    const field = issue.source === 'sentry' ? 'sentryProjectSlug' : 'githubRepo';
    const project = findProjectByKey(projects, field, issue.projectKey);
    if (!project) continue;
    // One issue Claude cannot analyse must not abort the rest of the cycle,
    // otherwise it blocks every newer issue on every future cycle too.
    try {
      const analysis = await analyzeIssue(issue, project);
      createTicket(db, {
        source: issue.source, sourceId: issue.sourceId, projectId: project.id,
        title: issue.title, body: issue.body, url: issue.url, analysis,
      });
      summary.ticketsCreated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.sourceErrors.push(`${issue.source}:${issue.sourceId} analysis failed: ${message}`);
    }
  }

  try {
    summary.prsSynced = await syncGithubPrs(db, projects);
  } catch (err) {
    summary.sourceErrors.push(`githubPrs: ${err instanceof Error ? err.message : String(err)}`);
  }

  return summary;
}

export function startPoller(db: Database.Database, intervalMs: number = 5 * 60 * 1000): () => void {
  let running = false;

  const tick = (): void => {
    // A cycle is unbounded (every analyzeIssue may take minutes), so without
    // this guard a slow cycle would overlap the next one and analyse the same
    // issue twice.
    if (running) {
      console.warn('previous poll cycle is still running; skipping this one');
      return;
    }
    running = true;
    runPollCycle(db)
      .then((summary) => {
        for (const error of summary.sourceErrors) console.error('poll cycle error:', error);
      })
      .catch((err) => console.error('poll cycle failed', err))
      .finally(() => { running = false; });
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
