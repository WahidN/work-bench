import type { Express } from 'express';
import {
  getConnection, saveClientCredentials, createAuthorizationState, consumeAuthorizationState,
  buildAuthorizeUrl, exchangeCode, chooseSite, disconnect, getClientId,
} from '../../sources/jiraAuth.js';

/// A deliberately plain page: no external assets, and it never renders the code, a
/// token or the client secret.
function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body style="font-family:-apple-system,system-ui,sans-serif;background:#161826;color:#e9e9ed;` +
    `display:flex;align-items:center;justify-content:center;height:100vh;margin:0">` +
    `<div style="text-align:center"><h1 style="font-size:20px;font-weight:500">${title}</h1>` +
    `<p style="color:#9397ab;font-size:14px">${body}</p></div></body></html>`;
}

/// Registered BEFORE createServer's auth middleware, because Atlassian redirects a
/// browser here and a browser cannot carry the bearer token. This is the only
/// unauthenticated route on the engine. consumeAuthorizationState is what protects
/// it: the state is single use and expires after ten minutes.
export function registerJiraCallbackRoute(app: Express): void {
  app.get('/oauth/jira/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';

    const pending = code ? consumeAuthorizationState(state) : null;
    if (!pending) {
      res.status(400).type('html').send(page(
        'Could not complete the connection',
        'That link is not valid any more. Start again from Settings in Workbench.'
      ));
      return;
    }

    try {
      await exchangeCode(code, pending.verifier);
      res.type('html').send(page('Jira connected', 'You can close this tab and go back to Workbench.'));
    } catch (err) {
      // Only the message, and only to the console: never the code or a token.
      console.error('jira oauth callback failed:', err instanceof Error ? err.message : 'unknown error');
      res.status(500).type('html').send(page(
        'Could not complete the connection',
        'Workbench could not finish the exchange. Check Settings and try again.'
      ));
    }
  });
}

export function registerSettingsRoutes(app: Express): void {
  app.get('/settings/jira', async (_req, res) => {
    try {
      res.json(await getConnection());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put('/settings/jira/client', async (req, res) => {
    const { clientId, clientSecret } = req.body ?? {};
    for (const value of [clientId, clientSecret]) {
      if (typeof value !== 'string' || !value.trim()) {
        res.status(400).json({ error: 'clientId and clientSecret are required' });
        return;
      }
    }
    await saveClientCredentials(clientId.trim(), clientSecret.trim());
    res.json({ ok: true });
  });

  app.post('/settings/jira/authorize', async (_req, res) => {
    const connection = await getConnection();
    if (!connection.hasClientCredentials) {
      res.status(400).json({ error: 'Set the client ID and secret first' });
      return;
    }
    const clientId = await getClientId();
    const { state, challenge } = createAuthorizationState();
    res.json({ url: buildAuthorizeUrl(clientId, state, challenge) });
  });

  app.post('/settings/jira/site', async (req, res) => {
    const cloudId = req.body?.cloudId;
    if (typeof cloudId !== 'string' || !cloudId.trim()) {
      res.status(400).json({ error: 'cloudId is required' });
      return;
    }
    try {
      await chooseSite(cloudId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/settings/jira', async (_req, res) => {
    await disconnect();
    res.json({ ok: true });
  });
}
