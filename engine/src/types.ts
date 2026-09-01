export type ProjectStatus = 'active' | 'paused' | 'planning';

export interface Project {
  id: number;
  name: string;
  repoPath: string;
  defaultBranch: string;
  githubRepo: string | null;
  jiraProjectKey: string | null;
  sentryProjectSlug: string | null;
  status: ProjectStatus;
  blurb: string;
  notes: string;
}

export type TodoSource = 'manual' | 'jira';

export type TodoPriority = 'high' | 'med' | 'low';

export interface Todo {
  id: number;
  source: TodoSource;
  sourceId: string | null;
  text: string;
  body: string;
  url: string | null;
  projectId: number | null;
  canPromote: boolean;
  done: boolean;
  promotedTicketId: number | null;
  priority: TodoPriority;
  dueAt: string | null;
  doneAt: string | null;
  pinned: boolean;
  /// The Jira workflow status and its category. Null for a manual todo, and null for
  /// a mirrored issue stored before statuses were recorded, until the next poll.
  statusName: string | null;
  statusCategory: JiraStatusCategory | null;
  createdAt: string;
}

export type TicketSource = 'sentry' | 'github' | 'jira';
export type TicketStatus = 'new' | 'sparring' | 'in_review' | 'done' | 'needs_attention';

export interface Ticket {
  id: number;
  source: TicketSource;
  sourceId: string;
  projectId: number;
  title: string;
  body: string;
  url: string;
  analysis: Analysis | null;
  status: TicketStatus;
  prId: number | null;
  pinned: boolean;
  createdAt: string;
}

export interface TicketMessage {
  id: number;
  ticketId: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export type PrStatus = 'open' | 'needs_attention' | 'merged';

export type PrReviewState = 'approved' | 'changes_requested' | 'review_required';

export interface Pr {
  id: number;
  ticketId: number | null;
  projectId: number;
  branch: string;
  number: number | null;
  url: string | null;
  status: PrStatus;
  lastReviewScore: number | null;
  pinned: boolean;
  title: string;
  reviewState: PrReviewState | null;
  isDraft: boolean;
  githubUpdatedAt: string | null;
  authoredByMe: boolean;
  assignedToMe: boolean;
  reviewRequestedByMe: boolean;
  messageCount: number;
  createdAt: string;
}

export interface PrMessage {
  id: number;
  prId: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface ProjectMessage {
  id: number;
  projectId: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface TodoMessage {
  id: number;
  todoId: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export type JobType = 'triage' | 'spar' | 'fix' | 'pr-chat' | 'merge';
export type JobTargetType = 'ticket' | 'pr';
export type JobStatus = 'running' | 'done' | 'failed' | 'interrupted';

export interface Job {
  id: number;
  type: JobType;
  targetType: JobTargetType;
  targetId: number;
  status: JobStatus;
  error: string | null;
  createdAt: string;
}

export interface Analysis {
  summary: string;
  rootCause: string;
  proposedFix: string;
  affectedFiles: string[];
  confidence: 'low' | 'medium' | 'high';
}

export interface ReviewScore {
  correctness: number;
  completeness: number;
  quality: number;
  tests: number;
  regressionRisk: number;
  findings: string[];
}

/// A remark about one line of a pull request, ready to be posted there.
///
/// Distinct from `ReviewScore` on purpose: that one answers "is this good enough
/// to merge" and its output is a verdict, this one answers "what should I say and
/// where" and its output is anchored text. `line` is the number on the right-hand
/// side of the diff, which is the only side a comment can be anchored to.
export interface ReviewFinding {
  path: string;
  line: number;
  body: string;
}

/// A finding that cannot be posted, with the reason it was dropped. Shown to the
/// user so a trimmed review is visible rather than silent.
export interface DiscardedFinding extends ReviewFinding {
  reason: string;
}

/// A finding on disk, waiting to be posted or discarded.
///
/// `commitSha` is the commit its line numbers were read from. It anchors the
/// comment when posted, and comparing it against the pull request's current head
/// is what says whether the remark has gone stale.
export interface StoredReviewFinding extends ReviewFinding {
  id: number;
  prId: number;
  commitSha: string;
  posted: boolean;
  createdAt: string;
}

/// The three Atlassian status categories, as stable tokens rather than Atlassian's
/// own keys: `new` reads as nothing useful at a call site, `todo` does.
export type JiraStatusCategory = 'todo' | 'in_progress' | 'done';

export interface SourceIssue {
  source: TicketSource;
  sourceId: string;
  title: string;
  url: string;
  body: string;
  projectKey: string;
  /// The workflow status exactly as the source names it. Null when the source sends
  /// none, which is every non-Jira source.
  statusName: string | null;
  /// Null when there is no status, and also when the category is one this code does
  /// not recognise: guessing would mis-file the group as active work.
  statusCategory: JiraStatusCategory | null;
}

export interface PrDetailFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface PrReviewComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface PrReviewThread {
  path: string;
  line: number | null;
  diffSide: string;
  isResolved: boolean;
  isOutdated: boolean;
  comments: PrReviewComment[];
}

export interface PrConversationItem {
  kind: 'review' | 'comment';
  author: string;
  body: string;
  createdAt: string;
  state: string | null;
}

export interface PrDetailView {
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  reviewState: PrReviewState | null;
  author: string;
  createdAt: string;
  baseRefName: string;
  headRefName: string;
  commitCount: number;
  changedFiles: number;
  additions: number;
  deletions: number;
  files: PrDetailFile[];
  threads: PrReviewThread[];
  conversation: PrConversationItem[];
}
