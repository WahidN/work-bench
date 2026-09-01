// The engine's port lives here rather than in index.ts because the Jira OAuth
// redirect URI is assembled from it, and Atlassian matches that URI exactly. Two
// copies of this number would break the flow with an opaque Atlassian error and
// nothing in the codebase pointing at the cause.
export const ENGINE_PORT = 4173;

/// How often the poller runs a full cycle.
///
/// Every cycle costs a Jira search, a GitHub issue search per mapped repo, three
/// pull request searches, and one more call for each pull request GitHub says has
/// changed. Five minutes was needlessly chatty for a board one person works from:
/// twelve cycles an hour to notice something that is usually still the same. At
/// fifteen the traffic drops by two thirds, and the header's Refresh button covers
/// the moments where waiting for the next cycle is not acceptable.
///
/// The environment variable is the escape hatch. It is read once at startup, so
/// changing it means restarting the engine.
const DEFAULT_POLL_INTERVAL_MS = 15 * 60 * 1000;

function readPollInterval(): number {
  const raw = Number(process.env.WORKBENCH_POLL_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_POLL_INTERVAL_MS;
}

export const POLL_INTERVAL_MS = readPollInterval();
