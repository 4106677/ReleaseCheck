import { setTimeout as delay } from 'node:timers/promises';
import { ContainerReconciler } from './container-runner.js';

// No database, capture image or worker required. The deployment supervisor owns
// this process independently of API/worker; a failed sweep exits nonzero.
const shutdown = new AbortController();
const stop = () => shutdown.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--once'))
    throw new Error('Unsupported janitor arguments');
  const reconciler = new ContainerReconciler(process.env.RUNNER_OWNER_ID ?? '');
  do {
    await reconciler.reconcile();
    console.log(
      JSON.stringify({ event: 'container_cleanup_completed', at: new Date().toISOString() }),
    );
    if (args[0] === '--once' || shutdown.signal.aborted) break;
    try {
      await delay(15_000, undefined, { signal: shutdown.signal });
    } catch (error) {
      if (!shutdown.signal.aborted) throw error;
    }
  } while (!shutdown.signal.aborted);
} catch {
  console.error(JSON.stringify({ event: 'container_cleanup_failed' }));
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
