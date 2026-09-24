import { createPool } from '@releasecheck/db';
import { LocalStorage } from '@releasecheck/storage';
import { startWorker } from './worker.js';

if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test')
  throw new Error(
    'Worker is local-only until runner isolation is implemented. Set NODE_ENV=development.',
  );
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = createPool(process.env.DATABASE_URL);
const runner = await startWorker(
  pool,
  new LocalStorage(process.env.ARTIFACT_DIR ?? '.artifacts'),
  process.env.FIXTURE_ORIGIN ?? 'http://127.0.0.1:4174',
);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void runner.stop();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  await runner.promise;
} finally {
  await pool.end();
}
