// Only launched by the recovery integration test against its disposable database.
// Hang inside execute after captureTask has durably claimed the Run, without
// launching Chromium; SIGKILL then tests actual queue-lock crash semantics.
import { run } from 'graphile-worker';
import { createPool, Repository } from '@releasecheck/db';
import { LocalStorage } from '@releasecheck/storage';
import { captureTask } from '../../apps/worker/dist/worker.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test') || !process.send)
  throw new Error('Crash helper requires a test database and parent IPC');
const pool = createPool(url);
const worker = await run({
  pgPool: pool,
  concurrency: 1,
  pollInterval: 50,
  noHandleSignals: true,
  parsedCronItems: [],
  taskList: {
    capture_run: captureTask(
      new Repository(pool),
      new LocalStorage(process.env.RECOVERY_ARTIFACT_DIR),
      process.env.RECOVERY_FIXTURE_ORIGIN,
      async () => {
        process.send({ type: 'claimed' });
        return new Promise(() => {});
      },
    ),
  },
});
await worker.promise;
