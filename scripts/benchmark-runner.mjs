import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { docker, probeContainer } from './lib/container-probe.mjs';

const samples = [];
const image = JSON.parse(
  await docker(['image', 'inspect', '--format', '{{json .}}', 'releasecheck-runner:local']),
);
for (let repetition = 1; repetition <= 3; repetition++) {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const variant of ['baseline', 'regression']) {
      const started = performance.now();
      const metrics = JSON.parse(
        await probeContainer({
          command: ['/app/benchmark-entry.mjs'],
          input: JSON.stringify({
            url: `http://127.0.0.1:4174/${variant === 'regression' ? '?regression=1' : ''}`,
            fixtureOrigin: 'http://127.0.0.1:4174',
            width,
            height,
          }),
        }),
      );
      assert.ok(Number.isFinite(metrics.memoryPeakBytes) && metrics.memoryPeakBytes > 0);
      assert.equal(metrics.oomKills, 0);
      assert.ok(metrics.screenshotBytes > 0);
      assert.equal(metrics.findings > 0, variant === 'regression');
      samples.push({
        repetition,
        width,
        height,
        variant,
        lifecycleMs: performance.now() - started,
        ...metrics,
      });
      console.log(
        `${width}×${height} ${variant}: ${(metrics.memoryPeakBytes / 1024 ** 2).toFixed(1)} MiB peak, ${metrics.elapsedMs.toFixed(0)} ms capture`,
      );
    }
  }
}
const report = {
  measuredAt: new Date().toISOString(),
  image: { id: image.Id, bytes: image.Size, architecture: image.Architecture, os: image.Os },
  limits: {
    cpus: 1,
    memoryMiB: 768,
    pids: 128,
    tmpMiB: 256,
    shmMiB: 128,
    network: 'none',
    concurrency: 1,
  },
  method:
    'Twelve fresh containers; Linux cgroup v2 memory.peak/cpu.stat read after Chromium closes. Lifecycle includes create/attach/remove. No queue, DB, API, diff or host daemon overhead included. Warm image/browser filesystem caches; no hosted-server throughput claim.',
  summary: {
    maxMemoryMiB: Math.max(...samples.map((s) => s.memoryPeakBytes)) / 1024 ** 2,
    maxCaptureMs: Math.max(...samples.map((s) => s.elapsedMs)),
    maxLifecycleMs: Math.max(...samples.map((s) => s.lifecycleMs)),
    maxCpuUsageMs: Math.max(...samples.map((s) => s.cpuUsageMs)),
    maxScreenshotBytes: Math.max(...samples.map((s) => s.screenshotBytes)),
  },
  samples,
};
const path = resolve(process.argv[2] ?? '.local/runner-benchmark.json');
await mkdir(dirname(path), { recursive: true });
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Benchmark saved: ${path}`);
