import { getSecret } from '../keychain.js';
import type { SourceIssue } from '../types.js';

export function mapSentryIssue(raw: any, projectKey: string, stack: string): SourceIssue {
  const body = [
    `Events: ${raw.count}, users affected: ${raw.userCount}`,
    `First seen: ${raw.firstSeen}`,
    stack,
  ].filter(Boolean).join('\n\n');
  return {
    source: 'sentry',
    sourceId: `SENTRY-${raw.id}`,
    title: raw.title ?? raw.metadata?.title ?? `Sentry issue ${raw.id}`,
    url: raw.permalink,
    body,
    projectKey,
  };
}

async function fetchLatestStack(token: string, issueId: string): Promise<string> {
  try {
    const res = await fetch(`https://sentry.io/api/0/issues/${issueId}/events/latest/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return '';
    const data: any = await res.json();
    const exception = data.entries?.find((e: any) => e.type === 'exception');
    const frames = exception?.data?.values?.[0]?.stacktrace?.frames ?? [];
    return frames
      .slice(-10)
      .map((f: any) => `${f.filename}:${f.lineNo} in ${f.function}`)
      .join('\n');
  } catch {
    return '';
  }
}

export async function fetchSentryIssues(org: string, projectSlugs: string[]): Promise<SourceIssue[]> {
  const token = await getSecret('sentry-auth-token');
  if (!token || projectSlugs.length === 0) return [];

  const results: SourceIssue[] = [];
  for (const slug of projectSlugs) {
    const res = await fetch(
      `https://sentry.io/api/0/projects/${org}/${slug}/issues/?query=assigned:me is:unresolved`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Sentry API error ${res.status} for project ${slug}`);
    const raws: any[] = await res.json();
    for (const raw of raws) {
      const stack = await fetchLatestStack(token, raw.id);
      results.push(mapSentryIssue(raw, slug, stack));
    }
  }
  return results;
}
