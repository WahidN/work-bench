import { describe, expect, it } from 'vitest';
import { runClaude, extractJson, claudeJson } from '../src/claude.js';

describe('runClaude', () => {
  it('passes prompt and allowedTools through to the binary', async () => {
    const out = await runClaude({ cwd: process.cwd(), prompt: 'hello', allowedTools: ['Read'], binary: 'echo' });
    expect(out).toContain('hello');
    expect(out).toContain('--allowedTools Read');
  });

  it('strips known secret env vars from the subprocess', async () => {
    process.env.JIRA_API_TOKEN = 'super-secret';
    const out = await runClaude({
      cwd: process.cwd(),
      prompt: 'typeof process.env.JIRA_API_TOKEN',
      allowedTools: [],
      binary: 'node',
    });
    expect(out.trim()).toBe('undefined');
    delete process.env.JIRA_API_TOKEN;
  });
});

describe('extractJson', () => {
  it('extracts a balanced JSON object out of surrounding prose', () => {
    const text = 'Here is the result: {"a": 1, "note": "use {braces} carefully"} — done.';
    expect(extractJson(text)).toEqual({ a: 1, note: 'use {braces} carefully' });
  });

  it('returns null when nothing parses', () => {
    expect(extractJson('no json here')).toBeNull();
  });
});

describe('claudeJson', () => {
  it('throws after 2 failed attempts', async () => {
    await expect(
      claudeJson(
        { cwd: process.cwd(), prompt: 'not json', allowedTools: [], binary: 'echo' },
        (v: any): v is any => false
      )
    ).rejects.toThrow('Claude did not return valid JSON after 2 attempts');
  });
});
