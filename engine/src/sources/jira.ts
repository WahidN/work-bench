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
  const jql = 'assignee = currentUser() AND statusCategory != Done';

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
    issues.push(...data.issues);
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  return issues.map((raw) => mapJiraIssue(raw, baseUrl));
}
