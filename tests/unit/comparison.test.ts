import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { captureProfileHash, compareCaptures } from '@releasecheck/checks';

function png(width = 10, height = 10, changed = false) {
  const image = new PNG({ width, height });
  image.data.fill(255);
  if (changed)
    for (let y = 2; y < 8; y++)
      for (let x = 2; x < 8; x++) {
        const offset = (y * width + x) * 4;
        image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 0;
      }
  return PNG.sync.write(image);
}
const profile = 'same-rendering-profile';
describe('visual comparison', () => {
  it('reports no changes for identical captures', () => {
    const image = { png: png(), profileHash: profile };
    expect(compareCaptures(image, image)).toMatchObject({
      status: 'matched',
      changedPixels: 0,
      diffRatio: 0,
    });
  });
  it('finds the exact changed region and renders a readable diff', () => {
    const result = compareCaptures(
      { png: png(), profileHash: profile },
      { png: png(10, 10, true), profileHash: profile },
    );
    expect(result).toMatchObject({
      status: 'changed',
      changedPixels: 36,
      totalPixels: 100,
      diffRatio: 0.36,
    });
    if (result.status === 'incompatible') throw new Error('Expected a comparable result');
    expect(PNG.sync.read(result.diffPng).width).toBe(10);
  });
  it('applies the allowed changed-pixel ratio without hiding the measured difference', () => {
    expect(
      compareCaptures(
        { png: png(), profileHash: profile },
        { png: png(10, 10, true), profileHash: profile },
        { maxDiffRatio: 0.36 },
      ),
    ).toMatchObject({ status: 'matched', diffRatio: 0.36 });
  });
  it('refuses incompatible renderers or dimensions', () => {
    expect(
      compareCaptures({ png: png(), profileHash: 'mac' }, { png: png(), profileHash: 'linux' }),
    ).toEqual({ status: 'incompatible', reason: 'profile' });
    expect(
      compareCaptures({ png: png(), profileHash: profile }, { png: png(11), profileHash: profile }),
    ).toEqual({ status: 'incompatible', reason: 'dimensions' });
  });
  it.each([-1, 2, Number.NaN, Infinity])('rejects invalid thresholds: %s', (value) => {
    const image = { png: png(), profileHash: profile };
    expect(() => compareCaptures(image, image, { maxDiffRatio: value })).toThrow();
  });
  it('rejects malformed images and missing profile metadata', () => {
    expect(() =>
      compareCaptures(
        { png: Buffer.from('not PNG'), profileHash: profile },
        { png: png(), profileHash: profile },
      ),
    ).toThrow();
    expect(() =>
      compareCaptures({ png: png(), profileHash: '' }, { png: png(), profileHash: profile }),
    ).toThrow();
  });
  it('does not treat a browser upgrade as the same capture profile', () => {
    const input = {
      browserVersion: '153.0',
      platform: 'linux',
      architecture: 'x64',
      osRelease: '6.8.0',
      width: 1440,
      height: 900,
    };
    expect(captureProfileHash(input)).toBe(captureProfileHash({ ...input }));
    expect(captureProfileHash(input)).not.toBe(
      captureProfileHash({ ...input, browserVersion: '154.0' }),
    );
    expect(captureProfileHash(input)).not.toBe(
      captureProfileHash({ ...input, platform: 'darwin' }),
    );
  });
});
