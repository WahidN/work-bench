import { openDb, DB_PATH } from './db.js';
import { reconcileInterruptedJobs } from './jobs.js';
import { getOrCreateApiToken } from './keychain.js';
import { startPoller } from './poller.js';
import { createServer } from './api/server.js';

const PORT = 4173;

async function main(): Promise<void> {
  const db = openDb(DB_PATH);

  const interrupted = reconcileInterruptedJobs(db);
  if (interrupted > 0) console.log(`Marked ${interrupted} job(s) interrupted from a previous run.`);

  const apiToken = await getOrCreateApiToken();
  const stopPoller = startPoller(db);
  const app = createServer(db, apiToken);
  const server = app.listen(PORT, () => {
    console.log(`Workbench engine listening on http://localhost:${PORT}`);
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
