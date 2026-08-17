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

async function search(filter: '--author=@me' | '--assignee=@me'): Promise<any[]> {
  const { stdout } = await execa('gh', [
    'search', 'prs', filter, '--state=open', '--limit', String(SEARCH_LIMIT),
    '--json', 'number,title,url,repository,updatedAt,isDraft',
  ]);
  const rows = JSON.parse(stdout || '[]');
  if (rows.length === SEARCH_LIMIT) {
    console.warn(`github prs: ${filter} hit the ${SEARCH_LIMIT} result cap, some pull requests are missing`);
  }
  return rows;
}

export async function fetchMyOpenPrs(repoSlugs: string[]): Promise<GithubPr[]> {
  const mapped = new Set(repoSlugs.map(toRepoSlug));
  if (mapped.size === 0) return [];

  let authored: any[];
  let assigned: any[];
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
      if (!mapped.has(repo)) continue;
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
  take(authored, 'authoredByMe');
  take(assigned, 'assignedToMe');
  return [...byUrl.values()];
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
