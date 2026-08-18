import { execa } from 'execa';
import { toRepoSlug } from './github.js';
import type {
  PrConversationItem, PrDetailFile, PrDetailView, PrReviewState, PrReviewThread,
} from '../types.js';

const VIEW_FIELDS = [
  'title', 'url', 'state', 'isDraft', 'reviewDecision', 'baseRefName', 'headRefName',
  'author', 'createdAt', 'additions', 'deletions', 'changedFiles', 'commits', 'reviews', 'comments',
].join(',');

// isResolved is not available on the REST API, so the threads have to come from
// GraphQL. databaseId is carried along because replying is REST only and needs it.
const THREADS_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviewThreads(first:100){
        nodes{
          isResolved isOutdated path line diffSide
          comments(first:50){ nodes{ databaseId author{login} body createdAt } }
        }
      }
    }
  }
}`;

/// GitHub reports no decision at all when nobody has reviewed yet, which reads
/// the same as an explicit REVIEW_REQUIRED to a person looking at the list.
export function reviewStateFrom(decision: string | null | undefined): PrReviewState | null {
  if (decision === 'APPROVED') return 'approved';
  if (decision === 'CHANGES_REQUESTED') return 'changes_requested';
  return 'review_required';
}

function toFile(row: any): PrDetailFile {
  return {
    path: row.filename,
    status: row.status,
    additions: row.additions ?? 0,
    deletions: row.deletions ?? 0,
    // GitHub omits the patch entirely for very large files. Null is the signal
    // to render "diff too large" rather than an empty file.
    patch: typeof row.patch === 'string' ? row.patch : null,
  };
}

function toThread(node: any): PrReviewThread {
  return {
    path: node.path,
    line: node.line ?? null,
    diffSide: node.diffSide ?? 'RIGHT',
    isResolved: !!node.isResolved,
    isOutdated: !!node.isOutdated,
    comments: (node.comments?.nodes ?? []).map((c: any) => ({
      id: c.databaseId,
      author: c.author?.login ?? '',
      body: c.body ?? '',
      createdAt: c.createdAt,
    })),
  };
}

/// An empty COMMENTED review is just the envelope GitHub wraps inline comments
/// in, and those already appear in the Files tab. An empty approval or change
/// request is a real event with no words, so it stays.
function keepsReview(review: any): boolean {
  if ((review.body ?? '').trim().length > 0) return true;
  return review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED';
}

function toConversation(view: any): PrConversationItem[] {
  const reviews: PrConversationItem[] = (view.reviews ?? []).filter(keepsReview).map((r: any) => ({
    kind: 'review' as const,
    author: r.author?.login ?? '',
    body: r.body ?? '',
    createdAt: r.submittedAt,
    state: r.state ?? null,
  }));
  const comments: PrConversationItem[] = (view.comments ?? []).map((c: any) => ({
    kind: 'comment' as const,
    author: c.author?.login ?? '',
    body: c.body ?? '',
    createdAt: c.createdAt,
    state: null,
  }));
  return [...reviews, ...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function fetchPrDetailView(repo: string, number: number): Promise<PrDetailView> {
  const slug = toRepoSlug(repo);
  const [owner, name] = slug.split('/');

  const [viewRaw, filesRaw, threadsRaw] = await Promise.all([
    execa('gh', ['pr', 'view', String(number), '--repo', slug, '--json', VIEW_FIELDS]),
    execa('gh', ['api', `repos/${slug}/pulls/${number}/files?per_page=100`]),
    execa('gh', [
      'api', 'graphql', '-f', `query=${THREADS_QUERY}`,
      '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`,
    ]),
  ]);

  const view = JSON.parse(viewRaw.stdout || '{}');
  const files = JSON.parse(filesRaw.stdout || '[]').map(toFile);
  const threadNodes = JSON.parse(threadsRaw.stdout || '{}')
    ?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];

  return {
    title: view.title ?? '',
    url: view.url ?? '',
    state: view.state ?? '',
    isDraft: !!view.isDraft,
    reviewState: reviewStateFrom(view.reviewDecision),
    author: view.author?.login ?? '',
    createdAt: view.createdAt ?? '',
    baseRefName: view.baseRefName ?? '',
    headRefName: view.headRefName ?? '',
    commitCount: (view.commits ?? []).length,
    changedFiles: view.changedFiles ?? files.length,
    additions: view.additions ?? 0,
    deletions: view.deletions ?? 0,
    files,
    threads: threadNodes.map(toThread),
    conversation: toConversation(view),
  };
}

export interface ReviewCommentDetail {
  id: number;
  author: string;
  body: string;
  path: string;
  diffHunk: string;
}

/// Drafting needs the hunk the comment hangs off, which the thread payload does
/// not carry, so the comment is fetched on its own by its REST id.
export async function fetchReviewComment(repo: string, commentId: number): Promise<ReviewCommentDetail> {
  const slug = toRepoSlug(repo);
  const { stdout } = await execa('gh', ['api', `repos/${slug}/pulls/comments/${commentId}`]);
  const row = JSON.parse(stdout || '{}');
  return {
    id: row.id,
    author: row.user?.login ?? '',
    body: row.body ?? '',
    path: row.path ?? '',
    diffHunk: row.diff_hunk ?? '',
  };
}

/// The only write in this file. in_reply_to is what makes GitHub thread the
/// reply under the original comment instead of starting a new one.
export async function postReviewCommentReply(
  repo: string,
  number: number,
  commentId: number,
  body: string
): Promise<{ id: number }> {
  const slug = toRepoSlug(repo);
  const { stdout } = await execa('gh', [
    'api', `repos/${slug}/pulls/${number}/comments`,
    '-f', `body=${body}`,
    '-F', `in_reply_to=${commentId}`,
  ]);
  return JSON.parse(stdout || '{}');
}
