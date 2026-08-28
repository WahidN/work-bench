import { getSecret } from '../keychain.js';
import { getConnection, getAccessToken } from './jiraAuth.js';
import type { SourceIssue, JiraStatusCategory } from '../types.js';

export function adfToText(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  let out = (node.content ?? []).map(adfToText).join('');
  if (['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(node.type)) out += '\n';
  return out;
}

/// Atlassian's documented category keys, confirmed against a real response from this
/// instance. An unrecognised key yields null rather than a guess: a wrong category
/// would file the group under active work, which is worse than filing it last.
const STATUS_CATEGORIES: Record<string, JiraStatusCategory> = {
  new: 'todo',
  indeterminate: 'in_progress',
  done: 'done',
};

/// `siteUrl` is the Jira site's own host, not the API host. Under OAuth the API lives
/// at api.atlassian.com while browse links must point at the site itself.
export function mapJiraIssue(raw: any, siteUrl: string): SourceIssue {
  const description = raw.fields.description;
  const body = typeof description === 'string' ? description : description ? adfToText(description).trim() : '';
  return {
    source: 'jira',
    sourceId: `JIRA-${raw.key}`,
    title: `[${raw.key}] ${raw.fields.summary}`,
    url: `${siteUrl}/browse/${raw.key}`,
    body,
    projectKey: raw.fields.project.key,
    statusName: raw.fields.status?.name ?? null,
    statusCategory: STATUS_CATEGORIES[raw.fields.status?.statusCategory?.key] ?? null,
  };
}

export async function fetchAssignedJiraIssues(): Promise<SourceIssue[]> {
  const connection = await getConnection();
  // Not being set up yet is not an error: a fresh install must not log one every cycle.
  if (!connection.connected || !connection.siteUrl) return [];

  const cloudId = await getSecret('jira-cloud-id');
  // Throws "reconnect in Settings" when the refresh token is dead, which lands in
  // PollSummary.sourceErrors and therefore in the refresh button's alert.
  const accessToken = await getAccessToken();
  const apiBase = `https://api.atlassian.com/ex/jira/${cloudId}`;

  // Everything assigned to the user, with no status filter. The previous
  // `AND statusCategory != Done` silently dropped any workflow status mapped to the
  // Done category, so an issue parked in In Review or Blocked never reached the app
  // even though it is still the user's work. The assignee clause is the search
  // restriction Jira requires: it rejects a query with no restriction at all.
  // Newest first, so if this ever needs a cap the useful end is already in front.
  const jql = 'assignee = currentUser() ORDER BY updated DESC';

  const issues: any[] = [];
  let nextPageToken: string | undefined;
  do {
    const params = new URLSearchParams({ jql, fields: 'summary,description,project,status', maxResults: '100' });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const res = await fetch(`${apiBase}/rest/api/3/search/jql?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Jira API error ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    issues.push(...(data.issues ?? []));
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  // The Basic-auth era /myself probe is gone. It existed because Jira answered
  // rejected Basic credentials with HTTP 200 and an empty list, so a dead token was
  // indistinguishable from an empty board. Under OAuth a dead token cannot get this
  // far: getAccessToken above fails loudly first, so the probe could no longer catch
  // anything and would only cost a request on every genuinely empty poll.
  return issues.map((raw) => mapJiraIssue(raw, connection.siteUrl!));
}
