import { execa } from 'execa';

const SECRET_ENV_VARS = ['JIRA_API_TOKEN', 'JIRA_EMAIL', 'JIRA_BASE_URL', 'SENTRY_AUTH_TOKEN', 'WORKBENCH_API_TOKEN'];

function subprocessEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const name of SECRET_ENV_VARS) delete env[name];
  return env;
}

export interface ClaudeCallOptions {
  cwd: string;
  prompt: string;
  allowedTools: string[];
  timeoutMs?: number;
  binary?: string;
}

export async function runClaude(opts: ClaudeCallOptions): Promise<string> {
  const args = ['-p', opts.prompt];
  const binary = opts.binary ?? 'claude';

  if (binary === 'node') {
    args.push('--', '--allowedTools', opts.allowedTools.join(','), '--output-format', 'text');
  } else {
    args.push('--allowedTools', opts.allowedTools.join(','), '--output-format', 'text');
  }

  const { stdout } = await execa(binary, args, {
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? 15 * 60 * 1000,
    env: subprocessEnv(),
    extendEnv: false,
  });
  return stdout;
}

export function extractJson<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const candidates: string[] = [text.slice(start, end + 1)];
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i <= end; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) { candidates.push(text.slice(start, i + 1)); break; }
    }
  }
  for (const candidate of candidates) {
    try { return JSON.parse(candidate) as T; } catch { /* try next candidate */ }
  }
  return null;
}

export async function claudeJson<T>(
  opts: ClaudeCallOptions,
  validate: (v: any) => v is T
): Promise<T> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const output = await runClaude(opts);
    const parsed = extractJson<T>(output);
    if (parsed !== null && validate(parsed)) return parsed;
  }
  throw new Error('Claude did not return valid JSON after 2 attempts');
}
