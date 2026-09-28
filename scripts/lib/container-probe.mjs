import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const profile = fileURLToPath(new URL('../../docker/seccomp_profile.json', import.meta.url));
export function docker(args, { input = '', timeout = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      args,
      { timeout, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function removeProbe(name) {
  await docker(['rm', '--force', name], { timeout: 15_000 });
  if ((await docker(['ps', '--all', '--quiet', '--filter', `name=^/${name}$`])).trim())
    throw new Error('Probe container cleanup failed');
}

// Test harness only: the worker needs durable ownership and crash reconciliation
// before it can use this container boundary in production.
export async function probeContainer({ input = '', command, inspect, timeout } = {}) {
  const name = `releasecheck-probe-${randomUUID()}`;
  try {
    const id = (
      await docker([
        'create',
        '--name',
        name,
        '--label',
        'io.releasecheck.role=container-probe',
        '--init',
        '--interactive',
        '--network=none',
        '--read-only',
        '--user=1000:1000',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--security-opt',
        `seccomp=${profile}`,
        '--memory=768m',
        '--memory-swap=768m',
        '--cpus=1',
        '--pids-limit=128',
        '--shm-size=128m',
        '--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=256m,mode=1777',
        ...(command ? ['--entrypoint=node'] : []),
        'releasecheck-runner:local',
        ...(command ?? []),
      ])
    ).trim();
    if (inspect) await inspect(JSON.parse(await docker(['inspect', id]))[0]);
    return await docker(['start', '--attach', '--interactive', id], { input, timeout });
  } finally {
    // Remove only the unique container allocated by this invocation, even when
    // attach timed out; killing the CLI alone does not stop its container.
    await removeProbe(name);
  }
}
