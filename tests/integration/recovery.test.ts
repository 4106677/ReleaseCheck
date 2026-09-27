import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeWorkerUtils } from 'graphile-worker';
import { createPool, Repository, migrate } from '@releasecheck/db';
import { LocalStorage } from '@releasecheck/storage';
import { DEMO_PROJECT_ID, isTerminal } from '@releasecheck/contracts';
import { buildApp } from '../../apps/api/dist/app.js';
import { startWorker } from '../../apps/worker/dist/worker.js';
import { createFixtureServer } from '../../fixtures/demo-site/dist/server.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.endsWith('_test'))
  throw new Error('Recovery tests require a disposable database ending in _test.');
const pool = createPool(connectionString);
const repository = new Repository(pool);
let folder: string;
let storage: LocalStorage;
let fixture: Server;
let origin: string;
let utils: Awaited<ReturnType<typeof makeWorkerUtils>>;
let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
let child: ChildProcess | undefined;
let killedWorkerId: string | undefined;
let app: ReturnType<typeof buildApp>;

async function waitFor<T>(read: () => Promise<T>, ready: (value: T) => boolean) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Recovery condition did not become true');
}
const create = () =>
  repository.createRun({ variant: 'baseline', viewport: 'desktop' }, randomUUID(), origin);
const expire = (id: string) =>
  pool.query(
    "UPDATE rc_runs SET attempt_deadline = clock_timestamp() - interval '1 second' WHERE id = $1",
    [id],
  );
const queueJob = async (id: string) =>
  (
    await pool.query<{
      id: string;
      locked_by: string | null;
      attempts: number;
      max_attempts: number;
    }>(
      'SELECT id::text, locked_by, attempts, max_attempts FROM graphile_worker.jobs WHERE key = $1',
      [id],
    )
  ).rows[0]!;

beforeAll(async () => {
  await migrate(pool);
  utils = await makeWorkerUtils({ pgPool: pool });
  folder = await mkdtemp(join(tmpdir(), 'releasecheck-recovery-'));
  storage = new LocalStorage(folder);
  fixture = createFixtureServer();
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  await pool.query(
    'SELECT graphile_worker.remove_job(key) FROM graphile_worker.jobs WHERE key IS NOT NULL',
  );
  await pool.query('TRUNCATE rc_baselines, rc_captures, rc_artifacts, rc_runs');
  await pool.query('UPDATE rc_projects SET max_diff_basis_points = 10, settings_version = 1');
  app = buildApp(repository, storage, origin);
});
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const closed = once(child, 'exit');
    child.kill('SIGKILL');
    await closed;
  }
  child = undefined;
  if (worker) {
    await worker.stop();
    worker = undefined;
  }
  await app.close();
  // Test cleanup only: the child was conclusively SIGKILLed and its exit awaited.
  if (killedWorkerId) {
    await utils.forceUnlockWorkers([killedWorkerId]);
    killedWorkerId = undefined;
  }
});
afterAll(async () => {
  await utils?.release();
  await pool.end();
  if (fixture) await new Promise<void>((resolve) => fixture.close(() => resolve()));
  if (folder) await rm(folder, { recursive: true, force: true });
});

describe('Interrupted check recovery', () => {
  it('recovers a real SIGKILL on the final attempt through the API timer and allows a new check', async () => {
    await app.ready();
    const { id } = await create();
    const job = await queueJob(id);
    await utils.rescheduleJobs([job.id], { maxAttempts: 1 });
    child = fork(new URL('../helpers/crash-worker.mjs', import.meta.url), [], {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: {
        ...process.env,
        TEST_DATABASE_URL: connectionString,
        RECOVERY_ARTIFACT_DIR: folder,
        RECOVERY_FIXTURE_ORIGIN: origin,
      },
    });
    const message = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(() => {
        throw new Error('Crash helper exited before claim');
      }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('Crash helper timeout')), 15_000);
        timer.unref();
      }),
    ]);
    expect(message[0]).toEqual({ type: 'claimed' });
    const locked = await queueJob(id);
    killedWorkerId = locked.locked_by!;
    expect(locked).toMatchObject({ attempts: 1, max_attempts: 1 });
    expect(await repository.recoverRuns()).toEqual([]); // A live final attempt is not failed.
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    expect((await exited)[1]).toBe('SIGKILL');
    expect((await repository.getRun(id))?.status).toBe('running');
    await expire(id); // Advance only the domain deadline; never touch queue internals.
    const recovered = await waitFor(
      () => repository.getRun(id),
      (run) => run?.status === 'failed',
    );
    expect(recovered).toMatchObject({
      verdict: 'inconclusive',
      error: 'RUN_DEADLINE_EXCEEDED',
      capture: null,
    });
    expect((await queueJob(id)).locked_by).toBe(killedWorkerId); // Recovery did not force-unlock.
    worker = await startWorker(pool, storage, origin);
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${DEMO_PROJECT_ID}/runs`,
      headers: { 'idempotency-key': randomUUID() },
      payload: { variant: 'baseline' },
    });
    expect(response.statusCode).toBe(202);
    const next = await waitFor(
      () => repository.getRun(response.json().id),
      (run) => !!run && isTerminal(run.status),
    );
    expect(next?.status).toBe('completed');
    expect((await repository.getRun(id))?.error).toBe('RUN_DEADLINE_EXCEEDED');
  });

  it('does not publish an expired result, even before the reconciler runs', async () => {
    const { id } = await create();
    const claim = await repository.claim(id);
    await expire(id);
    expect(
      await repository.complete(
        id,
        claim!.attempt,
        { width: 1440, height: 900, browserVersion: 'test', profileHash: null, findings: [] },
        { id: randomUUID(), key: `${randomUUID()}.png`, checksum: 'test', bytes: 100 },
      ),
    ).toBe(false);
    expect(await repository.claim(id)).toBeNull();
    const results = await Promise.all([repository.recoverRuns(), repository.recoverRuns()]);
    expect(results.flat()).toEqual([{ id, error: 'RUN_DEADLINE_EXCEEDED' }]);
    expect((await pool.query('SELECT count(*)::int AS n FROM rc_artifacts')).rows[0].n).toBe(0);
  });

  it('preserves queued work and backoff, but recovers exhausted or missing jobs', async () => {
    const { id } = await create();
    const job = await queueJob(id);
    await utils.rescheduleJobs([job.id], { attempts: 1, runAt: new Date(Date.now() + 60_000) });
    expect(await repository.recoverRuns()).toEqual([]);
    await repository.claim(id);
    expect(await repository.recoverRuns()).toEqual([]);
    await utils.permanentlyFailJobs([job.id], 'Test exhausted queue');
    expect(await repository.recoverRuns()).toEqual([
      { id, error: 'CAPTURE_INFRASTRUCTURE_FAILED' },
    ]);
    const missing = await create();
    await utils.completeJobs([(await queueJob(missing.id)).id]);
    expect(await repository.recoverRuns()).toEqual([
      { id: missing.id, error: 'QUEUE_JOB_MISSING' },
    ]);
  });

  it('recovers stale runs on worker restart without changing completed reports', async () => {
    const { id } = await create();
    await repository.claim(id);
    await expire(id);
    worker = await startWorker(pool, storage, origin);
    expect((await repository.getRun(id))?.status).toBe('failed');
    const next = await create();
    const completed = await waitFor(
      () => repository.getRun(next.id),
      (run) => run?.status === 'completed',
    );
    await expire(next.id);
    expect(await repository.recoverRuns()).toEqual([]);
    expect(await repository.getRun(next.id)).toEqual(completed);
  });
});
