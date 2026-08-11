import { describe, expect, it } from 'vitest';
import { adfToText, mapJiraIssue } from '../../src/sources/jira.js';

describe('adfToText', () => {
  it('joins paragraph text nodes with newlines', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
      ],
    };
    expect(adfToText(doc).trim()).toBe('First line\nSecond line');
  });
});

describe('mapJiraIssue', () => {
  it('maps a plain string description', () => {
    const raw = { key: 'ACV-12', fields: { summary: 'Fix login redirect', description: 'Redirect loops on logout.', project: { key: 'ACV' } } };
    const issue = mapJiraIssue(raw, 'https://x.atlassian.net');
    expect(issue).toEqual({
      source: 'jira', sourceId: 'JIRA-ACV-12', title: '[ACV-12] Fix login redirect',
      url: 'https://x.atlassian.net/browse/ACV-12', body: 'Redirect loops on logout.', projectKey: 'ACV',
    });
  });

  it('converts an ADF description', () => {
    const raw = {
      key: 'ACV-13',
      fields: {
        summary: 'Crash on save', project: { key: 'ACV' },
        description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Stack trace attached.' }] }] },
      },
    };
    expect(mapJiraIssue(raw, 'https://x.atlassian.net').body.trim()).toBe('Stack trace attached.');
  });

  it('returns an empty body when description is null', () => {
    const raw = { key: 'ACV-14', fields: { summary: 'No description', description: null, project: { key: 'ACV' } } };
    expect(mapJiraIssue(raw, 'https://x.atlassian.net').body).toBe('');
  });
});
