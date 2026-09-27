import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool, Repository, migrate } from '@releasecheck/db';
import { LocalStorage } from '@releasecheck/storage';
import { DEMO_PROJECT_ID, groupFindings, isTerminal, type Run } from '@releasecheck/contracts';
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
  await pool.query('TRUNCATE rc_baselines, rc_captures, rc_artifacts, rc_runs');
  await pool.query('UPDATE rc_projects SET max_diff_basis_points = 10, settings_version = 1');
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

  it('approves a baseline, persists matched/changed results and preserves historical evidence', async () => {
    worker = await startWorker(pool, storage, origin);
    const capture = async (variant: 'baseline' | 'regression') =>
      waitForRun((await post({ variant })).json().id);
    const approve = (runId: string, expectedVersion: number) =>
      app.inject({
        method: 'POST',
        url: `/api/projects/${DEMO_PROJECT_ID}/baselines`,
        payload: { runId, expectedVersion },
      });
    const original = await capture('baseline');
    expect(original.comparison).toEqual({ status: 'no_baseline' });
    expect(original.verdict).toBe('inconclusive');
    const approval = await approve(original.id, 0);
    expect(approval.statusCode).toBe(200);
    expect(approval.json().baseline.version).toBe(1);
    expect((await approve(original.id, 0)).json()).toEqual(approval.json());
    const same = await capture('baseline');
    expect(same.verdict).toBe('pass');
    expect(same.comparison).toMatchObject({
      status: 'matched',
      changedPixels: 0,
      baseline: { version: 1, sourceRunId: original.id },
    });
    const changed = await capture('regression');
    expect(changed.verdict).toBe('attention');
    expect(changed.comparison?.status).toBe('changed');
    if (changed.comparison?.status !== 'changed') throw new Error('Expected comparison');
    expect(changed.comparison.diffRatio).toBeGreaterThan(changed.comparison.maxDiffRatio);
    const diff = await app.inject(`/api/artifacts/${changed.comparison.diffArtifactId}`);
    expect(diff.statusCode).toBe(200);
    expect(diff.rawPayload.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect((await approve(changed.id, 0)).json().code).toBe('BASELINE_VERSION_CONFLICT');

    // Freeze a queued Run at v1, then approve v2 before its worker starts.
    await worker.stop();
    worker = undefined;
    const key = randomUUID();
    const queued = (await post({ variant: 'regression' }, key)).json().id;
    expect((await approve(changed.id, 1)).json().baseline.version).toBe(2);
    expect((await post({ variant: 'regression' }, key)).json().id).toBe(queued);
    worker = await startWorker(pool, storage, origin);
    const frozen = await waitForRun(queued);
    expect(frozen.comparison).toMatchObject({ status: 'changed', baseline: { version: 1 } });
    expect((await repository.getRun(changed.id))?.comparison).toEqual(changed.comparison);
    const acceptedVisual = await capture('regression');
    expect(acceptedVisual.comparison).toMatchObject({
      status: 'matched',
      changedPixels: 0,
      baseline: { version: 2 },
    });
    expect(acceptedVisual.verdict).toBe('attention'); // Accepting pixels never clears JS/HTTP errors.
    expect((await approve(original.id, 0)).json().code).toBe('BASELINE_VERSION_CONFLICT');
  });

  it('serializes concurrent baseline decisions and rejects unfinished or legacy captures', async () => {
    const approve = (runId: string, expectedVersion: number) =>
      app.inject({
        method: 'POST',
        url: `/api/projects/${DEMO_PROJECT_ID}/baselines`,
        payload: { runId, expectedVersion },
      });
    const queued = (await post()).json().id;
    expect((await approve(queued, 0)).json().code).toBe('CAPTURE_NOT_ELIGIBLE');
    worker = await startWorker(pool, storage, origin);
    const first = await waitForRun(queued);
    const second = await waitForRun((await post()).json().id);
    const decisions = await Promise.all([approve(first.id, 0), approve(second.id, 0)]);
    expect(decisions.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect((await pool.query('SELECT count(*)::int AS n FROM rc_baselines')).rows[0].n).toBe(1);
    const legacy = await waitForRun((await post()).json().id);
    await pool.query('UPDATE rc_captures SET profile_hash = NULL WHERE run_id = $1', [legacy.id]);
    expect((await approve(legacy.id, 1)).json().code).toBe('CAPTURE_NOT_ELIGIBLE');
    expect((await approve(randomUUID(), 0)).statusCode).toBe(409);
    expect((await approve(first.id, -1)).statusCode).toBe(400);
  });

  it('does not compare a baseline from a different capture environment', async () => {
    worker = await startWorker(pool, storage, origin);
    const original = await waitForRun((await post()).json().id);
    // Simulate a capture produced before a browser/OS upgrade.
    await pool.query('UPDATE rc_captures SET profile_hash = $1 WHERE run_id = $2', [
      'a'.repeat(64),
      original.id,
    ]);
    await repository.approveBaseline({ runId: original.id, expectedVersion: 0 });
    const fresh = await waitForRun((await post()).json().id);
    expect(fresh.comparison).toEqual({ status: 'incompatible', reason: 'profile' });
    expect(fresh.verdict).toBe('inconclusive');
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM rc_artifacts WHERE run_id = $1', [
          fresh.id,
        ])
      ).rows[0].n,
    ).toBe(1);
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

  it('reports the deliberate JavaScript, HTTP and broken-link regressions', async () => {
    const response = await post({ variant: 'regression' });
    worker = await startWorker(pool, storage, origin);
    const result = await waitForRun(response.json().id);
    expect(result.status).toBe('completed');
    expect(result.verdict).toBe('attention');
    const grouped = groupFindings(result.capture!.findings);
    expect(grouped).toHaveLength(2);
    expect(result.capture?.links?.results).toEqual([
      expect.objectContaining({
        status: 'broken',
        httpStatus: 404,
        url: `${origin}/missing-shipping`,
      }),
    ]);
    const network = grouped.find((group) => group.kind === 'http')!;
    expect(network.relation).toBe('resource');
    expect(network.observations.map(({ finding }) => finding.kind).sort()).toEqual([
      'console',
      'http',
    ]);
    expect(
      network.observations.find(({ finding }) => finding.kind === 'http')?.finding.request,
    ).toMatchObject({ method: 'GET', status: 404, resourceType: 'fetch' });
    expect(
      grouped.find((group) => group.kind === 'javascript')?.observations[0]?.finding.stack,
    ).toContain('Demo regression: cart is unavailable');
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
    const { id } = await repository.createRun(
      { variant: 'baseline', viewport: 'desktop' },
      randomUUID(),
      closedOrigin,
    );
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
    const { id } = await repository.createRun(
      { variant: 'baseline', viewport: 'desktop' },
      randomUUID(),
      origin,
    );
    const first = await repository.claim(id);
    const second = await repository.claim(id);
    const artifact = { id: randomUUID(), key: `${randomUUID()}.png`, checksum: 'test', bytes: 100 };
    const capture = {
      width: 1440,
      height: 900,
      browserVersion: 'test',
      profileHash: null,
      findings: [],
    };
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

describe('project settings', () => {
  const url = `/api/projects/${DEMO_PROJECT_ID}`;
  const patch = (payload: object) => app.inject({ method: 'PATCH', url, payload });
  it('validates settings and rejects stale conflicting saves while accepting an exact retry', async () => {
    expect((await app.inject(url)).json()).toMatchObject({
      settingsVersion: 1,
      maxDiffBasisPoints: 10,
    });
    for (const value of [-1, 501, 0.5, '10']) {
      expect((await patch({ expectedVersion: 1, maxDiffBasisPoints: value })).statusCode).toBe(400);
    }
    expect(
      (await patch({ expectedVersion: 1, maxDiffBasisPoints: 20, url: 'https://example.com' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers: { origin: 'https://example.com' },
          payload: { expectedVersion: 1, maxDiffBasisPoints: 20 },
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject(`/api/projects/${randomUUID()}`)).statusCode).toBe(404);
    const results = await Promise.all(
      [20, 30].map((maxDiffBasisPoints) => patch({ expectedVersion: 1, maxDiffBasisPoints })),
    );
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    const saved = results.find((result) => result.statusCode === 200)!.json();
    expect(saved.settingsVersion).toBe(2);
    const retry = await patch({ expectedVersion: 1, maxDiffBasisPoints: saved.maxDiffBasisPoints });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(saved);
  });

  it('freezes tolerance when queued and uses updated settings only for subsequent runs', async () => {
    worker = await startWorker(pool, storage, origin);
    const original = await waitForRun((await post()).json().id);
    await repository.approveBaseline({ runId: original.id, expectedVersion: 0 });
    await worker.stop();
    worker = undefined;
    const key = randomUUID();
    const queued = (await post({ variant: 'regression' }, key)).json();
    expect((await patch({ expectedVersion: 1, maxDiffBasisPoints: 200 })).statusCode).toBe(200);
    expect((await post({ variant: 'regression' }, key)).json().id).toBe(queued.id);
    worker = await startWorker(pool, storage, origin);
    const frozen = await waitForRun(queued.id);
    expect(frozen.comparison).toMatchObject({ status: 'changed', maxDiffRatio: 0.001 });
    const next = await waitForRun((await post({ variant: 'regression' })).json().id);
    expect(next.comparison).toMatchObject({ status: 'matched', maxDiffRatio: 0.02 });
    expect(next.verdict).toBe('attention'); // Browser errors cannot be hidden by visual tolerance.
    expect((await repository.getRun(queued.id))?.comparison).toEqual(frozen.comparison);
  });
});

it('keeps desktop and mobile baselines independent, including queued snapshots', async () => {
  worker = await startWorker(pool, storage, origin);
  const capture = async (viewport: 'desktop' | 'mobile', variant = 'baseline') =>
    waitForRun((await post({ viewport, variant })).json().id);
  const desktop = await capture('desktop');
  await repository.approveBaseline({ runId: desktop.id, expectedVersion: 0 });
  const mobile = await capture('mobile');
  expect(mobile.viewport).toBe('mobile');
  expect(mobile.capture).toMatchObject({ width: 390, height: 844 });
  expect(mobile.capture!.profileHash).not.toBe(desktop.capture!.profileHash);
  expect(mobile.comparison).toMatchObject({ status: 'no_baseline' });
  await repository.approveBaseline({ runId: mobile.id, expectedVersion: 0 });
  const unchanged = await capture('mobile');
  expect(unchanged.verdict).toBe('pass');
  expect(unchanged.comparison).toMatchObject({
    status: 'matched',
    baseline: { sourceRunId: mobile.id, version: 1 },
  });
  const changed = await capture('mobile', 'regression');
  expect(changed.comparison).toMatchObject({
    status: 'changed',
    baseline: { sourceRunId: mobile.id },
  });
  await worker.stop();
  worker = undefined;
  const key = randomUUID();
  const queued = (await post({ viewport: 'mobile' }, key)).json().id;
  expect((await post({ viewport: 'desktop' }, key)).statusCode).toBe(409);
  await repository.approveBaseline({ runId: changed.id, expectedVersion: 1 });
  worker = await startWorker(pool, storage, origin);
  expect((await waitForRun(queued)).comparison).toMatchObject({
    status: 'matched',
    baseline: { sourceRunId: mobile.id, version: 1 },
  });
  expect((await capture('desktop')).comparison).toMatchObject({
    status: 'matched',
    baseline: { sourceRunId: desktop.id, version: 1 },
  });
});

it('does not pass matched pixels when links are broken or coverage is incomplete', async () => {
  worker = await startWorker(pool, storage, origin);
  const original = await waitForRun((await post()).json().id);
  await repository.approveBaseline({ runId: original.id, expectedVersion: 0 });
  const matched = await waitForRun((await post()).json().id);
  expect(matched.verdict).toBe('pass');
  await worker.stop();
  worker = undefined;
  for (const [status, truncated, verdict] of [
    ['broken', false, 'attention'],
    ['unverified', false, 'inconclusive'],
    ['ok', true, 'inconclusive'],
  ] as const) {
    const id = (await post()).json().id;
    const claim = await repository.claim(id);
    const artifact = { id: randomUUID(), key: `${randomUUID()}.png`, checksum: 'test', bytes: 100 };
    const diff = { ...artifact, id: randomUUID(), key: `${randomUUID()}.png` };
    if (matched.comparison?.status !== 'matched') throw new Error('Expected matched fixture');
    await repository.complete(
      id,
      claim!.attempt,
      {
        width: 1440,
        height: 900,
        browserVersion: matched.capture!.browserVersion,
        profileHash: matched.capture!.profileHash,
        findings: [],
        links: { results: [{ url: `${origin}/test`, status }], truncated, skipped: 0 },
      },
      artifact,
      { ...matched.comparison, diffArtifactId: diff.id },
      diff,
    );
    expect((await repository.getRun(id))?.verdict).toBe(verdict);
  }
});

it('enforces session ownership for reports, artifacts and mutations, including logout and expiry', async () => {
  worker = await startWorker(pool, storage, origin);
  const captured = await waitForRun((await post()).json().id);
  const owner = '00000000-0000-4000-8000-000000000002';
  const stranger = randomUUID();
  await pool.query('INSERT INTO rc_users (id, display_name) VALUES ($1, $2)', [
    stranger,
    'Other user',
  ]);
  const ownerToken = await repository.createSession(owner);
  const foreignToken = await repository.createSession(stranger);
  const secureApp = buildApp(repository, storage, origin, false, 'session');
  const read = (url: string, token = ownerToken) =>
    secureApp.inject({ url, headers: { cookie: `rc_session=${token}` } });
  try {
    expect((await secureApp.inject('/api/projects')).statusCode).toBe(401);
    expect((await read('/api/projects', 'forged')).statusCode).toBe(401);
    expect((await read('/api/projects', foreignToken)).json()).toEqual([]);
    for (const url of [
      `/api/projects/${DEMO_PROJECT_ID}`,
      `/api/projects/${DEMO_PROJECT_ID}/runs`,
      `/api/runs/${captured.id}`,
      `/api/runs/${captured.id}/baseline`,
      `/api/artifacts/${captured.capture!.artifactId}`,
    ]) {
      expect((await read(url)).statusCode).toBe(200);
      expect((await read(url, foreignToken)).statusCode).toBe(404);
    }
    const payload = { expectedVersion: 1, maxDiffBasisPoints: 20 };
    const url = `/api/projects/${DEMO_PROJECT_ID}`;
    expect(
      (
        await secureApp.inject({
          method: 'PATCH',
          url,
          payload,
          headers: { cookie: `rc_session=${ownerToken}` },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await secureApp.inject({
          method: 'PATCH',
          url,
          payload,
          headers: { cookie: `rc_session=${foreignToken}`, origin: 'http://127.0.0.1:5173' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await secureApp.inject({
          method: 'PATCH',
          url,
          payload,
          headers: { cookie: `rc_session=${ownerToken}`, origin: 'http://127.0.0.1:5173' },
        })
      ).statusCode,
    ).toBe(200);
    const stored = await pool.query('SELECT token_hash FROM rc_sessions WHERE user_id = $1', [
      owner,
    ]);
    expect(stored.rows.some((row) => row.token_hash === ownerToken)).toBe(false);
    const logout = await secureApp.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `rc_session=${ownerToken}`, origin: 'http://127.0.0.1:5173' },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers['set-cookie']).toContain('Max-Age=0');
    expect((await read('/api/auth/session')).statusCode).toBe(401);
    await pool.query(
      "UPDATE rc_sessions SET expires_at = clock_timestamp() - interval '1 second' WHERE user_id = $1",
      [stranger],
    );
    expect((await read('/api/auth/session', foreignToken)).statusCode).toBe(401);
  } finally {
    await secureApp.close();
    await pool.query('DELETE FROM rc_sessions');
    await pool.query('DELETE FROM rc_users WHERE id = $1', [stranger]);
  }
});

it('binds OAuth to a browser, consumes state once and grants only the configured owner', async () => {
  const config = {
    clientId: 'test-client',
    clientSecret: 'test-secret',
    ownerId: '1234',
    appOrigin: 'http://127.0.0.1:5173' as const,
  };
  let providerId = '1234';
  let calls = 0;
  let challenge = '';
  const oauthApp = buildApp(
    repository,
    storage,
    origin,
    false,
    'session',
    config,
    async (code, verifier) => {
      calls++;
      expect(code).toBe('test-code');
      const { createHash } = await import('node:crypto');
      expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
      return providerId;
    },
  );
  async function begin() {
    const response = await oauthApp.inject('/api/auth/github');
    expect(response.statusCode).toBe(302);
    const url = new URL(response.headers.location!);
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('');
    challenge = url.searchParams.get('code_challenge')!;
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    return {
      cookie,
      url: `/api/auth/github/callback?code=test-code&state=${url.searchParams.get('state')}`,
    };
  }
  try {
    const flow = await begin();
    expect((await oauthApp.inject(flow.url)).headers.location).toContain('auth_error');
    expect(calls).toBe(0);
    const response = await oauthApp.inject({ url: flow.url, headers: { cookie: flow.cookie } });
    expect(response.headers.location).toBe(`${config.appOrigin}/`);
    const cookies = response.headers['set-cookie'] as string[];
    const session = cookies.find((cookie) => cookie.startsWith('rc_session='))!;
    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Lax');
    expect(
      (await oauthApp.inject({ url: '/api/projects', headers: { cookie: session.split(';')[0]! } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await oauthApp.inject({ url: flow.url, headers: { cookie: flow.cookie } })).headers.location,
    ).toContain('auth_error');
    expect(calls).toBe(1);
    providerId = '9999';
    const denied = await begin();
    expect(
      (await oauthApp.inject({ url: denied.url, headers: { cookie: denied.cookie } })).headers
        .location,
    ).toContain('auth_error');
    const expired = await begin();
    await pool.query(
      "UPDATE rc_oauth_states SET expires_at = clock_timestamp() - interval '1 second'",
    );
    expect(
      (await oauthApp.inject({ url: expired.url, headers: { cookie: expired.cookie } })).headers
        .location,
    ).toContain('auth_error');
    expect(calls).toBe(2);
  } finally {
    await oauthApp.close();
    await pool.query('DELETE FROM rc_oauth_states');
    await pool.query('DELETE FROM rc_sessions');
  }
});
