import { readFile } from 'node:fs/promises';
import { captureFixture, captureInputSchema } from '@releasecheck/checks';
import { createFixtureServer } from './fixtures/demo-site/dist/server.js';

const deadline = setTimeout(() => process.exit(124), 60_000);
let raw = '';
for await (const chunk of process.stdin) {
  raw += chunk;
  if (Buffer.byteLength(raw) > 8192) throw new Error('Benchmark input exceeds limit');
}
const input = captureInputSchema.parse(JSON.parse(raw));
if (input.fixtureOrigin !== 'http://127.0.0.1:4174') throw new Error('Invalid fixture origin');
const fixture = createFixtureServer();
await new Promise((resolve, reject) => {
  fixture.once('error', reject);
  fixture.listen(4174, '127.0.0.1', resolve);
});
const started = performance.now();
try {
  const result = await captureFixture(input);
  if (!result.ok) throw new Error('Benchmark capture failed');
  const elapsedMs = performance.now() - started;
  const stats = (text) =>
    Object.fromEntries(
      text
        .trim()
        .split('\n')
        .map((line) => {
          const [key, value] = line.split(/\s+/);
          return [key, Number(value)];
        }),
    );
  const memoryPeakBytes = Number(await readFile('/sys/fs/cgroup/memory.peak', 'utf8'));
  const cpu = stats(await readFile('/sys/fs/cgroup/cpu.stat', 'utf8'));
  const memory = stats(await readFile('/sys/fs/cgroup/memory.events', 'utf8'));
  if (!(memoryPeakBytes > 0) || !(cpu.usage_usec > 0) || memory.oom_kill !== 0)
    throw new Error('Invalid cgroup metrics or OOM detected');
  process.stdout.write(
    JSON.stringify({
      elapsedMs,
      memoryPeakBytes,
      cpuUsageMs: cpu.usage_usec / 1000,
      cpuThrottledMs: cpu.throttled_usec / 1000,
      oomKills: memory.oom_kill,
      screenshotBytes: Buffer.byteLength(result.screenshot, 'base64'),
      findings: result.findings.length,
      browserVersion: result.browserVersion,
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.versions.node,
    }),
  );
} finally {
  fixture.closeAllConnections();
  await new Promise((resolve) => fixture.close(resolve));
  clearTimeout(deadline);
}
