import { getSecret } from '../keychain.js';
import type { SourceIssue } from '../types.js';

export function adfToText(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  let out = (node.content ?? []).map(adfToText).join('');
  if (['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(node.type)) out += '\n';
  return out;
}

export function mapJiraIssue(raw: any, baseUrl: string): SourceIssue {
  const description = raw.fields.description;
  const body = typeof description === 'string' ? description : description ? adfToText(description).trim() : '';
  return {
    source: 'jira',
    sourceId: `JIRA-${raw.key}`,
    title: `[${raw.key}] ${raw.fields.summary}`,
    url: `${baseUrl}/browse/${raw.key}`,
    body,
    projectKey: raw.fields.project.key,
  };
}

export async function fetchAssignedJiraIssues(): Promise<SourceIssue[]> {
  const baseUrl = (await getSecret('jira-base-url'))?.replace(/\/$/, '');
  const email = await getSecret('jira-email');
  const token = await getSecret('jira-api-token');
  if (!baseUrl || !email || !token) return [];

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
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
    const params = new URLSearchParams({ jql, fields: 'summary,description,project', maxResults: '100' });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const res = await fetch(`${baseUrl}/rest/api/3/search/jql?${params}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) throw new Error(`Jira API error ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    issues.push(...(data.issues ?? []));
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  // Jira's search endpoint answers a request with rejected credentials with HTTP 200
  // and an empty issue list rather than a 401, so an expired token is indistinguishable
  // from an empty board. That silence is expensive: the app simply stops showing new
  // issues, and the reconcile guard is the only thing standing between a dead token
  // and every todo being deleted. So when the result is empty, and only then, ask an
  // endpoint that does authenticate honestly, and turn a bad token into a real error.
  if (issues.length === 0) {
    const me = await fetch(`${baseUrl}/rest/api/3/myself`, { headers: { Authorization: `Basic ${auth}` } });
    if (!me.ok) {
      throw new Error(
        `Jira credentials rejected (${me.status} from /myself). The search endpoint returns an ` +
        `empty list instead of failing, so this would otherwise look like an empty board. ` +
        `Refresh the jira-api-token in the Keychain.`
      );
    }
  }

  return issues.map((raw) => mapJiraIssue(raw, baseUrl));
}
