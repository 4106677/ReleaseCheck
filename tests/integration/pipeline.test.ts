import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool, Repository, migrate } from '@releasecheck/db';
import { LocalStorage } from '@releasecheck/storage';
import { DEMO_PROJECT_ID, isTerminal, type Run } from '@releasecheck/contracts';
import { captureProfileHash, compareCaptures } from '@releasecheck/checks';
import { buildApp } from '../../apps/api/dist/app.js';
import { startWorker } from '../../apps/worker/dist/worker.js';
import { createFixtureServer } from '../../fixtures/demo-site/dist/server.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.endsWith('_test')) {
  throw new Error(
    'Integration tests require TEST_DATABASE_URL pointing to a disposable database whose name ends with _test.',
  );
}
const pool = createPool(connectionString);
const repository = new Repository(pool);
let storage: LocalStorage;
let folder: string;
let fixture: Server;
let origin: string;
let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
let app: ReturnType<typeof buildApp>;
const post = (body: object = {}, key = randomUUID()) =>
  app.inject({
    method: 'POST',
    url: `/api/projects/${DEMO_PROJECT_ID}/runs`,
    headers: { host: 'localhost', 'idempotency-key': key },
    payload: body,
  });

async function waitForRun(id: string): Promise<Run> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const run = await repository.getRun(id);
    if (run && isTerminal(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Run ${id} did not reach a terminal state`);
}

beforeAll(async () => {
  await migrate(pool);
  await migrate(pool); // Applied migrations must be repeatable without resetting data.
  folder = await mkdtemp(join(tmpdir(), 'releasecheck-pipeline-'));
  storage = new LocalStorage(folder);
  fixture = createFixtureServer();
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  // This suite owns the explicitly named test database. No application data is touched.
  await pool.query(
    'SELECT graphile_worker.remove_job(key) FROM graphile_worker.jobs WHERE key IS NOT NULL',
  );
  await pool.query('TRUNCATE rc_captures, rc_artifacts, rc_runs');
  app = buildApp(repository, storage, origin);
});
afterEach(async () => {
  if (worker) {
    await worker.stop();
    worker = undefined;
  }
  await app?.close();
});
afterAll(async () => {
  if (fixture)
    await new Promise<void>((resolve, reject) =>
      fixture.close((error) => (error ? reject(error) : resolve())),
    );
  await pool.end();
  if (folder) await rm(folder, { recursive: true, force: true });
});

describe('API → PostgreSQL queue → browser → artifact', () => {
  it('compares independent browser captures without flagging the unchanged fixture', async () => {
    worker = await startWorker(pool, storage, origin);
    async function capture(variant: 'baseline' | 'regression') {
      const response = await post({ variant });
      expect(response.statusCode).toBe(202);
      const run = await waitForRun(response.json().id);
      expect(run.status).toBe('completed');
      const result = run.capture!;
      const artifact = await app.inject(`/api/artifacts/${result.artifactId}`);
      return {
        png: artifact.rawPayload,
        profileHash: captureProfileHash({
          browserVersion: result.browserVersion,
          width: result.width,
          height: result.height,
          platform: process.platform,
          architecture: process.arch,
          osRelease: release(),
        }),
      };
    }
    const original = await capture('baseline');
    const unchanged = compareCaptures(original, await capture('baseline'));
    expect(unchanged).toMatchObject({ status: 'matched', changedPixels: 0 });
    const regression = compareCaptures(original, await capture('regression'));
    expect(regression.status).toBe('changed');
    if (regression.status === 'incompatible') throw new Error('Fixture profiles should match');
    expect(regression.diffRatio).toBeGreaterThan(regression.maxDiffRatio);
  });

  it('rolls back the Run if the queue is unavailable, allowing a safe retry', async () => {
    const key = randomUUID();
    await pool.query('ALTER SCHEMA graphile_worker RENAME TO graphile_worker_unavailable');
    try {
      expect((await post({}, key)).statusCode).toBe(500);
      expect((await pool.query('SELECT count(*)::int AS n FROM rc_runs')).rows[0].n).toBe(0);
    } finally {
      await pool.query('ALTER SCHEMA graphile_worker_unavailable RENAME TO graphile_worker');
    }
    expect((await post({}, key)).statusCode).toBe(202);
  });

  it('deduplicates concurrent submissions and rejects conflicting reuse', async () => {
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => post({ variant: 'baseline' }, key)),
    );
    expect(responses.filter((response) => response.statusCode === 202)).toHaveLength(1);
    expect(new Set(responses.map((response) => response.json().id)).size).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM rc_runs')).rows[0].n).toBe(1);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM graphile_worker.jobs')).rows[0].n,
    ).toBe(1);
    expect((await post({ variant: 'regression' }, key)).statusCode).toBe(409);
    expect((await post()).json().code).toBe('RUN_ACTIVE');
  });

  it('persists a queued check across API restart and returns actual PNG bytes', async () => {
    const response = await post();
    expect(response.statusCode).toBe(202);
    const id: string = response.json().id;
    await app.close();
    app = buildApp(new Repository(pool), storage, origin);
    expect((await app.inject(`/api/runs/${id}`)).json().status).toBe('queued');
    worker = await startWorker(pool, storage, origin);
    const result = await waitForRun(id);
    expect(result.status).toBe('completed');
    expect(result.verdict).toBe('inconclusive');
    expect(result.capture?.findings).toEqual([]);
    expect(result.capture).toMatchObject({ width: 1440, height: 900 });
    const image = await app.inject(`/api/artifacts/${result.capture!.artifactId}`);
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');
    expect(image.rawPayload.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(image.rawPayload.length).toBeGreaterThan(1000);
  });

  it('reports the deliberate JavaScript and HTTP regressions', async () => {
    const response = await post({ variant: 'regression' });
    worker = await startWorker(pool, storage, origin);
    const result = await waitForRun(response.json().id);
    expect(result.status).toBe('completed');
    expect(result.verdict).toBe('attention');
    expect(result.capture?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'javascript',
          message: 'Demo regression: cart is unavailable',
        }),
        expect.objectContaining({ kind: 'http', message: 'HTTP 404' }),
      ]),
    );
  });

  it('marks an unavailable fixture as failed, without a screenshot or green verdict', async () => {
    const closedServer = createFixtureServer();
    await new Promise<void>((resolve) => closedServer.listen(0, '127.0.0.1', resolve));
    const closedOrigin = `http://127.0.0.1:${(closedServer.address() as AddressInfo).port}`;
    await new Promise<void>((resolve) => closedServer.close(() => resolve()));
    const { id } = await repository.createRun({ variant: 'baseline' }, randomUUID(), closedOrigin);
    worker = await startWorker(pool, storage, closedOrigin);
    const result = await waitForRun(id);
    expect(result).toMatchObject({
      status: 'failed',
      verdict: 'inconclusive',
      error: 'NAVIGATION_FAILED',
      capture: null,
    });
  });

  it('prevents stale attempts from publishing a result and ignores completed duplicates', async () => {
    const { id } = await repository.createRun({ variant: 'baseline' }, randomUUID(), origin);
    const first = await repository.claim(id);
    const second = await repository.claim(id);
    const artifact = { id: randomUUID(), key: `${randomUUID()}.png`, checksum: 'test', bytes: 100 };
    const capture = { width: 1440, height: 900, browserVersion: 'test', findings: [] };
    expect(await repository.complete(id, first!.attempt, capture, artifact)).toBe(false);
    expect((await pool.query('SELECT count(*)::int AS n FROM rc_artifacts')).rows[0].n).toBe(0);
    expect(await repository.complete(id, second!.attempt, capture, artifact)).toBe(true);
    expect(await repository.claim(id)).toBeNull();
    expect(await repository.complete(id, second!.attempt, capture, artifact)).toBe(false);
    expect((await pool.query('SELECT count(*)::int AS n FROM rc_captures')).rows[0].n).toBe(1);
  });

  it('rejects arbitrary targets, foreign browser origins and invalid resource IDs', async () => {
    expect((await post({ url: 'http://169.254.169.254/' })).statusCode).toBe(400);
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/projects/${DEMO_PROJECT_ID}/runs`,
      headers: { origin: 'https://example.com', 'idempotency-key': randomUUID() },
      payload: {},
    });
    expect(foreign.statusCode).toBe(403);
    expect((await app.inject('/api/runs/not-an-id')).statusCode).toBe(404);
    expect((await app.inject('/api/artifacts/not-an-id')).statusCode).toBe(404);
    expect((await pool.query('SELECT count(*)::int AS n FROM rc_runs')).rows[0].n).toBe(0);
  });
});
