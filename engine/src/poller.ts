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
import { POLL_INTERVAL_MS } from './config.js';
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

/// One search pair plus, at most, one review lookup per pull request. A failed
/// review lookup keeps whatever the row already had, so a single flaky call
/// cannot quietly downgrade an approved PR to "Needs review".
///
/// `force` skips the unchanged check below and looks every pull request up. The
/// interval poller leaves it off, because being a cycle behind on a pull request
/// nobody touched costs nothing. The Refresh button turns it on, because someone
/// who clicked it is looking at the screen and wants the truth, and it is the only
/// way back from a review state GitHub failed to bump `updatedAt` for.
async function syncGithubPrs(
  db: Database.Database,
  projects: Project[],
  force = false
): Promise<number> {
  const mapped = projects.filter((p) => p.githubRepo);
  const { prs: found, truncated } = await fetchMyOpenPrs(mapped.map((p) => p.githubRepo!));
  const seen: Array<{ projectId: number; number: number }> = [];

  for (const pr of found) {
    // Lowered on both sides for the same reason fetchMyOpenPrs does it: GitHub
    // repo names are case-insensitive and a project holds whatever was pasted.
    const project = mapped.find((p) => toRepoSlug(p.githubRepo!).toLowerCase() === pr.repo.toLowerCase());
    if (!project) continue;

    const previous = findPrByNumber(db, project.id, pr.number);
    let reviewState = previous?.reviewState ?? null;
    let branch = previous?.branch ?? '';

    // The search already reported when GitHub last touched this pull request. If
    // that has not moved since the stored row, the lookup can only hand back what
    // is already there, so it is skipped: on a quiet cycle this takes the per-PR
    // calls to zero, which is the bulk of the engine's GitHub traffic.
    //
    // Both stored fields have to be present to skip. A row that has never been
    // looked up has a null review state and an empty branch, and matching on
    // `updatedAt` alone would leave it that way for as long as the pull request
    // sits still, which is exactly when it would never recover.
    const unchanged =
      previous !== null &&
      previous.githubUpdatedAt === pr.updatedAt &&
      previous.reviewState !== null &&
      branch !== '';

    if (force || !unchanged) {
      try {
        const detail = await fetchPrDetail(pr.repo, pr.number);
        reviewState = detail.reviewState;
        if (detail.headRefName) branch = detail.headRefName;
      } catch (err) {
        console.error('github prs: detail lookup failed for', pr.url, String(err));
      }
    }

    upsertGithubPr(db, {
      projectId: project.id, number: pr.number, title: pr.title, url: pr.url,
      githubUpdatedAt: pr.updatedAt, isDraft: pr.isDraft,
      authoredByMe: pr.authoredByMe, assignedToMe: pr.assignedToMe,
      reviewRequestedByMe: pr.reviewRequestedByMe, reviewState, branch,
    });
    seen.push({ projectId: project.id, number: pr.number });
  }

  // A truncated search means the list above is known to be incomplete, so a pull
  // request missing from it may just have fallen off the cap rather than closed.
  // Upserting what was found is still safe; deleting the rest is not.
  if (truncated) {
    console.warn('github prs: search results were truncated, skipping reconciliation this cycle to avoid deleting pull requests that fell off the end');
  } else {
    reconcileGithubPrs(db, mapped.map((p) => p.id), seen);
  }
  return seen.length;
}

/// Upserts the fetched Jira issues and deletes the todos that are gone.
///
/// Shared by the full cycle and the quick poll because of the reconcile guard
/// below, not for tidiness: an empty Jira result on a setup that already has todos
/// is far more likely a credential or Keychain problem than an empty board, and
/// reconciling would delete every todo along with its done state. Duplicating that
/// rule into a second caller is how you lose the lot.
///
/// Only call this when the fetch actually succeeded; a failed fetch must not be
/// mistaken for an empty board.
export function applyJiraIssues(
  db: Database.Database,
  projects: Project[],
  issues: SourceIssue[]
): number {
  for (const issue of issues) {
    const project = findProjectByKey(projects, 'jiraProjectKey', issue.projectKey);
    upsertJiraTodo(db, issue, project);
  }
  const sourceIds = issues.map((issue) => issue.sourceId);
  if (sourceIds.length > 0 || countJiraTodos(db) === 0) {
    reconcileJiraTodos(db, sourceIds);
  } else {
    console.warn('Jira returned 0 issues while jira todos exist; skipping reconciliation this cycle');
  }
  return issues.length;
}

/// Jira and pull requests only, for the header's refresh button.
///
/// It deliberately skips the Sentry and GitHub issue pass, because that runs
/// analyzeIssue (a Claude call) sequentially per new issue and would turn one click
/// into a multi-minute wait. The interval poller still runs the full cycle, so
/// nothing is lost, only delayed.
///
/// The pull request sync runs forced here: this is the deliberate, occasional,
/// user-initiated fetch, so it pays for certainty where the interval poller
/// deliberately does not.
export async function runQuickPoll(db: Database.Database): Promise<PollSummary> {
  const projects = listProjects(db);
  const summary: PollSummary = { jiraTodos: 0, ticketsCreated: 0, prsSynced: 0, sourceErrors: [] };

  try {
    summary.jiraTodos = applyJiraIssues(db, projects, await fetchAssignedJiraIssues());
  } catch (err) {
    summary.sourceErrors.push(`jira: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    summary.prsSynced = await syncGithubPrs(db, projects, true);
  } catch (err) {
    summary.sourceErrors.push(`githubPrs: ${err instanceof Error ? err.message : String(err)}`);
  }

  return summary;
}

// A cycle is unbounded (every analyzeIssue may take minutes), so two overlapping
// cycles would analyse the same new issue twice. The guard lives out here rather
// than inside startPoller's closure so the refresh endpoint respects it too.
// Keyed by database, so one test's :memory: database cannot leak this into the next.
const inFlight = new WeakMap<Database.Database, Promise<PollSummary>>();

export function isPolling(db: Database.Database): boolean {
  return inFlight.has(db);
}

/// Runs a cycle, or hands back the one already running. A caller that arrives
/// mid-cycle rides along on it instead of starting a second one.
export function pollOnce(
  db: Database.Database,
  run: (db: Database.Database) => Promise<PollSummary>
): Promise<PollSummary> {
  const existing = inFlight.get(db);
  if (existing) return existing;

  const promise = run(db).finally(() => { inFlight.delete(db); });
  inFlight.set(db, promise);
  return promise;
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

  if (results[0].status === 'fulfilled') {
    summary.jiraTodos = applyJiraIssues(db, projects, issuesBySource[0]);
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

export function startPoller(db: Database.Database, intervalMs: number = POLL_INTERVAL_MS): () => void {
  const tick = (): void => {
    // The timer skips rather than riding along: the interval comes round again
    // shortly, and a warning is more useful than a silently queued duplicate. The
    // refresh endpoint does ride along, because a user who clicked wants a result.
    if (isPolling(db)) {
      console.warn('previous poll cycle is still running; skipping this one');
      return;
    }
    pollOnce(db, runPollCycle)
      .then((summary) => {
        for (const error of summary.sourceErrors) console.error('poll cycle error:', error);
      })
      .catch((err) => console.error('poll cycle failed', err));
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
