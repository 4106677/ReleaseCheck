import assert from 'node:assert/strict';
import { captureOutputSchema, compareCaptures } from '@releasecheck/checks';
import { probeContainer } from './lib/container-probe.mjs';

await probeContainer({
  inspect(container) {
    const config = container.HostConfig;
    assert.equal(config.NetworkMode, 'none');
    assert.equal(config.ReadonlyRootfs, true);
    assert.equal(config.Memory, 768 * 1024 * 1024);
    assert.equal(config.MemorySwap, config.Memory);
    assert.equal(config.NanoCpus, 1e9);
    assert.equal(config.PidsLimit, 128);
    assert.deepEqual(config.CapDrop, ['ALL']);
    assert.equal(container.Config.User, '1000:1000');
    assert.equal(container.Mounts.length, 0);
  },
  command: [
    '--input-type=module',
    '-e',
    `
    import assert from 'node:assert/strict';
    import { existsSync, readFileSync, writeFileSync } from 'node:fs';
    import { networkInterfaces } from 'node:os';
    import { connect } from 'node:net';
    assert.equal(process.getuid(), 1000);
    assert.deepEqual(Object.keys(networkInterfaces()), ['lo']);
    for (const key of ['DATABASE_URL', 'GITHUB_CLIENT_SECRET', 'GITHUB_CLIENT_ID'])
      assert.equal(process.env[key], undefined);
    for (const path of ['/app/.env', '/app/.env.local', '/var/run/docker.sock'])
      assert.equal(existsSync(path), false);
    assert.throws(() => writeFileSync('/app/forbidden', 'test'), {code: 'EROFS'});
    writeFileSync('/tmp/allowed', 'test');
    assert.match(readFileSync('/proc/self/status', 'utf8'), /CapEff:\\s+0+\\n/);
    await new Promise((resolve, reject) => {
      const socket = connect({host: '1.1.1.1', port: 443});
      socket.setTimeout(1000, () => { socket.destroy(); reject(Error('Network probe timed out')); });
      socket.on('connect', () => { socket.destroy(); reject(Error('External network accessible')); });
      socket.on('error', error => error.code === 'ENETUNREACH' ? resolve() : reject(error));
    });
  `,
  ],
});
console.log(
  'Container boundary: non-root, read-only, no network/mounts/secrets, bounded resources.',
);

async function capture(width, height, regression = false) {
  const origin = 'http://127.0.0.1:4174';
  const output = captureOutputSchema.parse(
    JSON.parse(
      await probeContainer({
        input: JSON.stringify({
          url: `${origin}/${regression ? '?regression=1' : ''}`,
          fixtureOrigin: origin,
          width,
          height,
        }),
      }),
    ),
  );
  assert.equal(output.ok, true);
  return output;
}
const comparable = (result) => ({
  png: Buffer.from(result.screenshot, 'base64'),
  profileHash: result.profileHash,
});
for (const [width, height] of [
  [1440, 900],
  [390, 844],
]) {
  const baseline = await capture(width, height);
  const repeat = await capture(width, height);
  const regression = await capture(width, height, true);
  assert.equal(compareCaptures(comparable(baseline), comparable(repeat)).status, 'matched');
  assert.equal(compareCaptures(comparable(baseline), comparable(regression)).status, 'changed');
  assert.equal(baseline.findings.length, 0);
  assert.ok(regression.findings.length > 0);
  assert.ok(regression.links.results.some((link) => link.status === 'broken'));
  console.log(
    `Container capture ${width}×${height}: repeat matched, regression changed, findings + broken link detected.`,
  );
}
await assert.rejects(
  probeContainer({ command: ['-e', 'setInterval(() => {}, 1000)'], timeout: 1500 }),
  { killed: true },
);
console.log('Timed-out attach cleaned up its container.');
