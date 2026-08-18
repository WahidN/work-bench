import { execa } from 'execa';
import { toRepoSlug } from './github.js';
import type { PrReviewState } from '../types.js';

// One gh call can return at most this many pull requests. Hitting the cap is
// logged rather than silently truncating the inbox.
const SEARCH_LIMIT = 100;

export interface GithubPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  isDraft: boolean;
  authoredByMe: boolean;
  assignedToMe: boolean;
}

async function search(filter: '--author=@me' | '--assignee=@me'): Promise<{ rows: any[]; truncated: boolean }> {
  const { stdout } = await execa('gh', [
    'search', 'prs', filter, '--state=open', '--limit', String(SEARCH_LIMIT),
    '--json', 'number,title,url,repository,updatedAt,isDraft',
  ]);
  const rows = JSON.parse(stdout || '[]');
  const truncated = rows.length === SEARCH_LIMIT;
  if (truncated) {
    console.warn(`github prs: ${filter} hit the ${SEARCH_LIMIT} result cap, some pull requests are missing`);
  }
  return { rows, truncated };
}

export interface FetchMyOpenPrsResult {
  prs: GithubPr[];
  // True when either search hit the result cap, meaning the list below is known
  // to be incomplete. The caller must not treat it as the full set of open pull
  // requests, since that mistakes a partial fetch for a genuinely shrunk one.
  truncated: boolean;
}

export async function fetchMyOpenPrs(repoSlugs: string[]): Promise<FetchMyOpenPrsResult> {
  // GitHub repo names are case-insensitive, and a project can hold any casing the
  // user pasted, so the match is lowered on both sides. Only the comparison: the
  // repo kept on the result is GitHub's own, which gh pr view is called with.
  const mapped = new Set(repoSlugs.map((slug) => toRepoSlug(slug).toLowerCase()));
  if (mapped.size === 0) return { prs: [], truncated: false };

  let authored: { rows: any[]; truncated: boolean };
  let assigned: { rows: any[]; truncated: boolean };
  try {
    authored = await search('--author=@me');
    assigned = await search('--assignee=@me');
  } catch (err) {
    throw new Error(`GitHub PR search failed: ${String(err)}`);
  }

  const byUrl = new Map<string, GithubPr>();
  const take = (rows: any[], key: 'authoredByMe' | 'assignedToMe') => {
    for (const row of rows) {
      const repo = row.repository?.nameWithOwner ?? '';
      if (!mapped.has(repo.toLowerCase())) continue;
      const existing = byUrl.get(row.url);
      if (existing) {
        existing[key] = true;
        continue;
      }
      byUrl.set(row.url, {
        repo, number: row.number, title: row.title, url: row.url,
        updatedAt: row.updatedAt, isDraft: !!row.isDraft,
        authoredByMe: key === 'authoredByMe', assignedToMe: key === 'assignedToMe',
      });
    }
  };
  take(authored.rows, 'authoredByMe');
  take(assigned.rows, 'assignedToMe');
  return { prs: [...byUrl.values()], truncated: authored.truncated || assigned.truncated };
}

export interface GithubPrDetail {
  reviewState: PrReviewState | null;
  headRefName: string;
}

/// One call for both, because the head branch is what lets the agent panel
/// build a worktree for a pull request this engine did not create.
export async function fetchPrDetail(repo: string, number: number): Promise<GithubPrDetail> {
  const { stdout } = await execa('gh', [
    'pr', 'view', String(number), '--repo', repo, '--json', 'reviewDecision,headRefName',
  ]);
  const parsed = JSON.parse(stdout || '{}');
  const decision = parsed.reviewDecision;
  const reviewState: PrReviewState =
    decision === 'APPROVED' ? 'approved' : decision === 'CHANGES_REQUESTED' ? 'changes_requested' : 'review_required';
  return { reviewState, headRefName: parsed.headRefName ?? '' };
}
