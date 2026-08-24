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

export interface SourceIssue {
  source: TicketSource;
  sourceId: string;
  title: string;
  url: string;
  body: string;
  projectKey: string;
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
