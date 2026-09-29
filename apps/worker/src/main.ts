import { createPool } from '@releasecheck/db';
import { LocalStorage } from '@releasecheck/storage';
import { startWorker } from './worker.js';
import { ContainerRunner } from './container-runner.js';
import { executeCapture } from './runner.js';

if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test')
  throw new Error(
    'Worker is local-only until deployment hardening is complete. Set NODE_ENV=development.',
  );
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const backend = process.env.RUNNER_BACKEND ?? 'process';
if (backend !== 'process' && backend !== 'docker') throw new Error('Invalid RUNNER_BACKEND');
const origin = process.env.FIXTURE_ORIGIN ?? 'http://127.0.0.1:4174';
if (backend === 'docker' && origin !== 'http://127.0.0.1:4174')
  throw new Error('Container fixture requires http://127.0.0.1:4174');
const containers =
  backend === 'docker'
    ? await ContainerRunner.create(process.env.RUNNER_OWNER_ID ?? '', process.env.RUNNER_IMAGE)
    : undefined;
const pool = createPool(process.env.DATABASE_URL);
try {
  const runner = await startWorker(
    pool,
    new LocalStorage(process.env.ARTIFACT_DIR ?? '.artifacts'),
    origin,
    containers ? (input) => containers.execute(input) : executeCapture,
  );
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void runner.stop();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await runner.promise;
} finally {
  try {
    await containers?.close();
  } finally {
    await pool.end();
  }
}
