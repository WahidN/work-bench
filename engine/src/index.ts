import { openDb, DB_PATH } from './db.js';
import { reconcileInterruptedJobs } from './jobs.js';
import { reconcileUnfinishedCommentFixes } from './prCommentFixStore.js';
import { getOrCreateApiToken } from './keychain.js';
import { startPoller } from './poller.js';
import { createServer } from './api/server.js';
import { ENGINE_PORT } from './config.js';

async function main(): Promise<void> {
  const db = openDb(DB_PATH);

  const interrupted = reconcileInterruptedJobs(db);
  if (interrupted > 0) console.log(`Marked ${interrupted} job(s) interrupted from a previous run.`);

  const interruptedFixes = reconcileUnfinishedCommentFixes(db);
  if (interruptedFixes > 0) console.log(`Failed ${interruptedFixes} comment fix(es) left running.`);

  const apiToken = await getOrCreateApiToken();
  const stopPoller = startPoller(db);
  const app = createServer(db, apiToken);
  // Loopback only: this API runs claude -p with Bash enabled and gh pr merge,
  // so it must never be reachable from the LAN.
  const server = app.listen(ENGINE_PORT, '127.0.0.1', () => {
    console.log(`Workbench engine listening on http://localhost:${ENGINE_PORT}`);
  });

  const shutdown = () => {
    stopPoller();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
