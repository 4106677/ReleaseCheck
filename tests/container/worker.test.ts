import { randomUUID } from 'node:crypto';
import { execFile, fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createPool, Repository, migrate } from '@releasecheck/db';
import { LocalStorage } from '@releasecheck/storage';
import { DEMO_PROJECT_ID, isTerminal } from '@releasecheck/contracts';
import { makeWorkerUtils } from 'graphile-worker';
import { ContainerRunner } from '../../apps/worker/dist/container-runner.js';
import { startWorker } from '../../apps/worker/dist/worker.js';
import { buildApp } from '../../apps/api/dist/app.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Container tests require a disposable _test database');
const pool = createPool(url);
const repository = new Repository(pool);
const origin = 'http://127.0.0.1:4174';
const owner = randomUUID();
const hangImage = `releasecheck-runner-test:${randomUUID()}`;
const extraIds: string[] = [];
let folder: string;
let storage: LocalStorage;
let containers: ContainerRunner | undefined;
let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
let child: ChildProcess | undefined;
let utils: Awaited<ReturnType<typeof makeWorkerUtils>>;
let killedWorker: string | undefined;
let app: ReturnType<typeof buildApp>;
const request = {
  url: `${origin}/`,
  fixtureOrigin: origin,
  width: 1440 as const,
  height: 900 as const,
};

function docker(args: string[], input = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = execFile(
      'docker',
      args,
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    command.stdin!.on('error', () => {});
    command.stdin!.end(input);
  });
}
async function owned() {
  return (
    await docker([
      'ps',
      '--all',
      '--quiet',
      '--no-trunc',
      '--filter',
      `label=io.releasecheck.owner=${owner}`,
    ])
  )
    .trim()
    .split('\n')
    .filter(Boolean);
}
async function waitFor<T>(read: () => Promise<T>, ready: (result: T) => boolean) {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    const result = await read();
    if (ready(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Container test condition timed out');
}
const createRun = (variant: 'baseline' | 'regression' = 'baseline') =>
  repository.createRun({ variant, viewport: 'desktop' }, randomUUID(), origin);
const finished = (id: string) =>
  waitFor(
    () => repository.getRun(id),
    (run) => !!run && isTerminal(run.status),
  );

beforeAll(async () => {
  await migrate(pool);
  utils = await makeWorkerUtils({ pgPool: pool });
  folder = await mkdtemp(join(tmpdir(), 'releasecheck-container-'));
  storage = new LocalStorage(folder);
  // A deliberately stalled trusted test image exercises the real CLI timeout and
  // worker SIGKILL without adding test hooks to the production runner.
  await docker(
    ['build', '--network=none', '-t', hangImage, '-f', '-', '.'],
    'FROM releasecheck-runner:local\nENTRYPOINT ["node", "-e", "setInterval(() => {}, 1000)"]\n',
  );
});
beforeEach(async () => {
  await pool.query(
    'SELECT graphile_worker.remove_job(key) FROM graphile_worker.jobs WHERE key IS NOT NULL',
  );
  await pool.query('TRUNCATE rc_baselines, rc_captures, rc_artifacts, rc_runs');
  app = buildApp(repository, storage, origin);
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  child = undefined;
  await worker?.stop();
  worker = undefined;
  await containers?.close();
  containers = undefined;
  for (const id of new Set([...(await owned()), ...extraIds.splice(0)]))
    await docker(['rm', '--force', id]);
  if (killedWorker) {
    await utils.forceUnlockWorkers([killedWorker]);
    killedWorker = undefined;
  }
  await app.close();
});
afterAll(async () => {
  await utils?.release();
  await pool.end();
  if (folder) await rm(folder, { recursive: true, force: true });
  await docker(['image', 'rm', hangImage]);
});

it('publishes container artifacts and baseline comparisons through the PostgreSQL queue', async () => {
  containers = await ContainerRunner.create(owner);
  worker = await startWorker(pool, storage, origin, (input) => containers!.execute(input));
  const baseline = await finished((await createRun()).id);
  expect(baseline?.status).toBe('completed');
  const approval = await app.inject({
    method: 'POST',
    url: `/api/projects/${DEMO_PROJECT_ID}/baselines`,
    payload: { runId: baseline!.id, expectedVersion: 0 },
  });
  expect(approval.statusCode).toBe(200);
  const repeat = await finished((await createRun()).id);
  expect(repeat?.comparison).toMatchObject({ status: 'matched', changedPixels: 0 });
  expect(repeat?.verdict).toBe('pass');
  const regression = await finished((await createRun('regression')).id);
  expect(regression?.comparison?.status).toBe('changed');
  expect(regression?.verdict).toBe('attention');
  const artifact = await app.inject(`/api/artifacts/${regression!.capture!.artifactId}`);
  expect(artifact.statusCode).toBe(200);
  expect(artifact.rawPayload.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(await owned()).toEqual([]);
});

it('bounds a stalled container to 60 seconds and removes it after attach timeout', async () => {
  containers = await ContainerRunner.create(owner, hangImage);
  await expect(containers.execute(request)).rejects.toThrow('CONTAINER_TIMEOUT');
  expect(await owned()).toEqual([]);
});

it('runs an independent janitor without DB/image configuration and preserves unrelated containers', async () => {
  const ids: string[] = [];
  for (const [installation, expires, role] of [
    [owner, String(Date.now() - 1000), 'capture'],
    [owner, String(Date.now() - 1000), 'capture'],
    [owner, String(Date.now() + 600_000), 'capture'],
    [randomUUID(), String(Date.now() - 1000), 'capture'],
    [owner, 'invalid', 'capture'],
    [owner, String(Date.now() - 1000), 'another-service'],
  ]) {
    ids.push(
      (
        await docker([
          'create',
          '--network=none',
          '--label',
          `io.releasecheck.role=${role}`,
          '--label',
          `io.releasecheck.owner=${installation}`,
          '--label',
          `io.releasecheck.expires-at=${expires}`,
          hangImage,
        ])
      ).trim(),
    );
  }
  extraIds.push(ids[3]!); // Foreign test fixture is not returned by owned().
  await docker(['start', ids[0]!, ids[2]!]);
  const env: NodeJS.ProcessEnv = {
    RUNNER_OWNER_ID: owner,
    RUNNER_IMAGE: 'deliberately-missing-image',
  };
  for (const key of [
    'PATH',
    'HOME',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_CONFIG',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
    'XDG_RUNTIME_DIR',
  ])
    if (process.env[key]) env[key] = process.env[key];
  const entry = new URL('../../apps/worker/dist/janitor-main.js', import.meta.url);
  // The daemon cleans on startup, then remains alive without a worker or DB.
  child = fork(entry, [], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env });
  await waitFor(owned, (remaining) => !remaining.includes(ids[0]!) && !remaining.includes(ids[1]!));
  expect(child.exitCode).toBeNull();
  for (const id of ids.slice(2))
    expect((await docker(['inspect', '--format', '{{.Id}}', id])).trim()).toBe(id);
  // Also exercise the next sweep, not only the startup path.
  const expiredLater = (
    await docker([
      'create',
      '--network=none',
      '--label',
      'io.releasecheck.role=capture',
      '--label',
      `io.releasecheck.owner=${owner}`,
      '--label',
      `io.releasecheck.expires-at=${Date.now() - 1000}`,
      hangImage,
    ])
  ).trim();
  await waitFor(owned, (remaining) => !remaining.includes(expiredLater));
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  expect((await exited)[0]).toBe(0);
  child = undefined;
  // Missing ownership fails closed, with a stable event and nonzero exit status.
  const result = await new Promise<{ code: number; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
        [fileURLToPath(entry), '--once'],
      { env: { PATH: process.env.PATH }, timeout: 10_000 },
      (error, _stdout, stderr) => resolve({ code: Number(error?.code ?? 0), stderr }),
    );
  });
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toEqual({ event: 'container_cleanup_failed' });
});

it('reconciles a killed worker container on restart without touching live or foreign ownership', async () => {
  const run = await createRun();
  child = fork(new URL('../../apps/worker/dist/main.js', import.meta.url), [], {
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: url,
      ARTIFACT_DIR: folder,
      FIXTURE_ORIGIN: origin,
      RUNNER_BACKEND: 'docker',
      RUNNER_OWNER_ID: owner,
      RUNNER_IMAGE: hangImage,
    },
  });
  const ids = await waitFor(owned, (ids) => ids.length === 1);
  const id = ids[0]!;
  await waitFor(
    () => docker(['inspect', '--format', '{{.State.Running}}', id]),
    (value) => value.trim() === 'true',
  );
  expect((await repository.getRun(run.id))?.status).toBe('running');
  killedWorker = (
    await pool.query('SELECT locked_by FROM graphile_worker.jobs WHERE key = $1', [run.id])
  ).rows[0].locked_by;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  containers = await ContainerRunner.create(owner);
  expect(await owned()).toEqual([id]); // Restart never removes an unexpired lease.
  await containers.close();
  containers = undefined;

  // Two decoys remain: another installation's expired container and our live one.
  for (const [installation, expires] of [
    [randomUUID(), Date.now() - 1],
    [owner, Date.now() + 600_000],
  ] as const) {
    extraIds.push(
      (
        await docker([
          'create',
          '--label',
          'io.releasecheck.role=capture',
          '--label',
          `io.releasecheck.owner=${installation}`,
          '--label',
          `io.releasecheck.expires-at=${expires}`,
          hangImage,
        ])
      ).trim(),
    );
  }
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 91_000); // Advance only the reconciler clock.
  containers = await ContainerRunner.create(owner);
  vi.restoreAllMocks();
  expect(await owned()).toEqual([extraIds[1]]);
  for (const decoy of extraIds)
    expect((await docker(['inspect', '--format', '{{.Id}}', decoy])).trim()).toBe(decoy);
  // Domain recovery remains separate from Docker cleanup and never unlocks jobs.
  await pool.query(
    "UPDATE rc_runs SET attempt_deadline = clock_timestamp() - interval '1 second' WHERE id = $1",
    [run.id],
  );
  await repository.recoverRuns();
  expect((await repository.getRun(run.id))?.error).toBe('RUN_DEADLINE_EXCEEDED');
  worker = await startWorker(pool, storage, origin, (input) => containers!.execute(input));
  expect((await finished((await createRun()).id))?.status).toBe('completed');
});
