import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { captureInputSchema, captureOutputSchema, type CaptureInput } from '@releasecheck/checks';

const role = 'io.releasecheck.role';
const ownerLabel = 'io.releasecheck.owner';
const expiryLabel = 'io.releasecheck.expires-at';
const profile = fileURLToPath(new URL('../../../docker/seccomp_profile.json', import.meta.url));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const imageId = /^sha256:[a-f0-9]{64}$/;
const containerId = /^[a-f0-9]{64}$/;

// CLI errors can contain raw container output; only stable codes leave this module.
async function docker(
  args: string[],
  input = '',
  timeout = 10_000,
  maxBuffer = 256 * 1024,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      'PATH',
      'HOME',
      'DOCKER_HOST',
      'DOCKER_CONTEXT',
      'DOCKER_CONFIG',
      'DOCKER_TLS_VERIFY',
      'DOCKER_CERT_PATH',
      'XDG_RUNTIME_DIR',
    ]) {
      if (process.env[key]) env[key] = process.env[key];
    }
    const child = execFile('docker', args, { timeout, maxBuffer, env }, (error, stdout) => {
      if (error) reject(new Error(error.killed ? 'CONTAINER_TIMEOUT' : 'CONTAINER_COMMAND_FAILED'));
      else resolve(stdout);
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

interface ContainerInfo {
  Id: string;
  Name: string;
  Config: { Labels: Record<string, string> | null };
}

export class ContainerRunner {
  private timer: ReturnType<typeof setInterval> | undefined;
  private reconciliation: Promise<void> | undefined;
  private stopped = false;

  private constructor(
    private readonly owner: string,
    private readonly image: string,
  ) {}

  static async create(owner: string, image = 'releasecheck-runner:local') {
    if (!uuid.test(owner)) throw new Error('RUNNER_OWNER_ID must be a stable installation UUID');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/@:-]{0,255}$/.test(image))
      throw new Error('Invalid runner image');
    const resolved = (await docker(['image', 'inspect', '--format', '{{.Id}}', image])).trim();
    if (!imageId.test(resolved)) throw new Error('CONTAINER_IMAGE_INVALID');
    const runner = new ContainerRunner(owner, resolved);
    await runner.reconcile();
    runner.timer = setInterval(() => {
      void runner.reconcile().catch(() => console.error('Container reconciliation failed'));
    }, 15_000);
    runner.timer.unref();
    return runner;
  }

  // Installation labels survive worker crashes. Never delete another installation
  // or a live attempt: only this owner's expired containers are reclaimed.
  reconcile(): Promise<void> {
    if (!this.reconciliation) {
      this.reconciliation = this.reapExpired().finally(() => {
        this.reconciliation = undefined;
      });
    }
    return this.reconciliation;
  }

  private async reapExpired() {
    const ids = (
      await docker([
        'ps',
        '--all',
        '--quiet',
        '--no-trunc',
        '--filter',
        `label=${role}=capture`,
        '--filter',
        `label=${ownerLabel}=${this.owner}`,
      ])
    )
      .trim()
      .split('\n')
      .filter(Boolean);
    // Bound each sweep; subsequent ticks continue after removals.
    const sweepDeadline = Date.now() + 10_000;
    for (const id of ids.slice(0, 100)) {
      if (Date.now() >= sweepDeadline) break;
      if (!containerId.test(id)) throw new Error('CONTAINER_ID_INVALID');
      const info = await this.inspectOwned(id);
      if (!info) continue;
      const expiry = info.Config.Labels?.[expiryLabel];
      if (!expiry || !/^\d{13}$/.test(expiry)) continue;
      if (Number(expiry) <= Date.now()) await this.removeOwned(id);
    }
  }

  private async inspectOwned(id: string): Promise<ContainerInfo | undefined> {
    // `ps` avoids treating a concurrent successful removal as a Docker failure.
    const found = (
      await docker(['ps', '--all', '--quiet', '--no-trunc', '--filter', `id=${id}`])
    ).trim();
    if (!found) return undefined;
    let info: ContainerInfo;
    try {
      [info] = JSON.parse(await docker(['inspect', id])) as [ContainerInfo];
    } catch (error) {
      if (!(await docker(['ps', '--all', '--quiet', '--filter', `id=${id}`])).trim())
        return undefined;
      throw error;
    }
    if (
      info.Id !== id ||
      info.Config.Labels?.[role] !== 'capture' ||
      info.Config.Labels?.[ownerLabel] !== this.owner
    )
      throw new Error('CONTAINER_OWNERSHIP_MISMATCH');
    return info;
  }

  private async removeOwned(id: string) {
    if (await this.inspectOwned(id)) {
      try {
        await docker(['rm', '--force', id]);
      } catch (error) {
        if ((await docker(['ps', '--all', '--quiet', '--filter', `id=${id}`])).trim()) throw error;
      }
    }
  }

  async execute(input: CaptureInput) {
    if (this.stopped) throw new Error('CONTAINER_RUNNER_STOPPED');
    const request = captureInputSchema.parse(input);
    const serialized = JSON.stringify(request);
    if (Buffer.byteLength(serialized) > 8192) throw new Error('CONTAINER_INPUT_LIMIT');
    if (request.fixtureOrigin !== 'http://127.0.0.1:4174')
      throw new Error('CONTAINER_FIXTURE_ORIGIN_INVALID');
    const name = `releasecheck-capture-${randomUUID()}`;
    let id: string | undefined;
    try {
      id = (
        await docker([
          'create',
          '--name',
          name,
          '--label',
          `${role}=capture`,
          '--label',
          `${ownerLabel}=${this.owner}`,
          '--label',
          `${expiryLabel}=${Date.now() + 90_000}`,
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
          this.image,
        ])
      ).trim();
      if (!containerId.test(id)) throw new Error('CONTAINER_ID_INVALID');
      const output = await docker(
        ['start', '--attach', '--interactive', id],
        serialized,
        60_000,
        6 * 1024 * 1024,
      );
      try {
        return captureOutputSchema.parse(JSON.parse(output));
      } catch {
        throw new Error('CONTAINER_OUTPUT_INVALID');
      }
    } finally {
      // Create may succeed in the daemon even if the CLI loses its response.
      // Recover the ID only by our exact random name, then verify ownership.
      if (!id || !containerId.test(id)) {
        id = (
          await docker(['ps', '--all', '--quiet', '--no-trunc', '--filter', `name=^/${name}$`])
        ).trim();
      }
      if (id && containerId.test(id)) await this.removeOwned(id);
    }
  }

  async close() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.reconciliation;
  }
}
