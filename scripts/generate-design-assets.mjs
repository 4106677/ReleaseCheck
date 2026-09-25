import { mkdir, writeFile } from 'node:fs/promises';
import { release } from 'node:os';
import { captureFixture, captureProfileHash, compareCaptures } from '@releasecheck/checks';

const fixtureOrigin = 'http://127.0.0.1:4174';
const input = { fixtureOrigin, width: 1440, height: 900 };
const before = await captureFixture({ ...input, url: `${fixtureOrigin}/` });
const after = await captureFixture({ ...input, url: `${fixtureOrigin}/?regression=1` });
if (!before.ok || !after.ok) throw new Error('Both fixture captures must succeed');
const profile = (capture) =>
  captureProfileHash({
    browserVersion: capture.browserVersion,
    platform: process.platform,
    architecture: process.arch,
    osRelease: release(),
    width: capture.width,
    height: capture.height,
  });
const baseline = { png: Buffer.from(before.screenshot, 'base64'), profileHash: profile(before) };
const current = { png: Buffer.from(after.screenshot, 'base64'), profileHash: profile(after) };
const comparison = compareCaptures(baseline, current);
if (comparison.status !== 'changed')
  throw new Error('Fixture regression should create a visual difference');
await mkdir('apps/web/public/design', { recursive: true });
await mkdir('apps/web/src/design', { recursive: true });
await writeFile('apps/web/public/design/before.png', baseline.png);
await writeFile('apps/web/public/design/after.png', current.png);
await writeFile('apps/web/public/design/diff.png', comparison.diffPng);
await writeFile(
  'apps/web/src/design/metrics.json',
  JSON.stringify(
    {
      changedPixels: comparison.changedPixels,
      totalPixels: comparison.totalPixels,
      diffRatio: comparison.diffRatio,
      maxDiffRatio: comparison.maxDiffRatio,
      findings: after.findings,
      profileHash: profile(after),
    },
    null,
    2,
  ) + '\n',
);
console.log('Generated real before/after/diff assets for both design previews.');
