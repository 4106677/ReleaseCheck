import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runRunnerProcess } from '../../apps/worker/dist/process-supervisor.js';
const script = fileURLToPath(new URL('../helpers/runner-process-fixture.mjs', import.meta.url));
const limits = { timeoutMs: 1000, stdoutBytes: 1024 };
it('accepts valid output and rejects malformed output without leaking stderr', async () => {
  expect(await runRunnerProcess(script, { mode: 'normal' }, {}, limits)).toEqual({ ok: true });
  await expect(runRunnerProcess(script, { mode: 'invalid' }, {}, limits)).rejects.toThrow(
    'RUNNER_INVALID_OUTPUT',
  );
  await expect(runRunnerProcess(script, { mode: 'stderr' }, {}, limits)).rejects.toThrow(
    /^RUNNER_EXIT_FAILED$/,
  );
});
it.each([
  ['timeout', 'RUNNER_TIMEOUT'],
  ['overflow', 'RUNNER_OUTPUT_LIMIT'],
  ['exit', 'RUNNER_EXIT_FAILED'],
])('cleans up a detached browser process after %s', async (mode, error) => {
  const folder = await mkdtemp(join(tmpdir(), 'releasecheck-process-'));
  const pidFile = join(folder, 'pid');
  let pid: number | undefined;
  try {
    await expect(runRunnerProcess(script, { mode, pidFile }, {}, limits)).rejects.toThrow(error);
    pid = Number(await readFile(pidFile, 'utf8'));
    // Wait for the killed descendant to be reaped by its parent or init.
    for (let i = 0; i < 50; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Detached browser survived runner termination');
  } finally {
    if (pid) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    }
    await rm(folder, { recursive: true, force: true });
  }
});
