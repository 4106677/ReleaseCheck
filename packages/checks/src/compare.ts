import { createHash } from 'node:crypto';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface CaptureProfile {
  browserVersion: string;
  platform: string;
  architecture: string;
  osRelease: string;
  width: number;
  height: number;
}

// Keep rendering settings explicit and versioned. New capture settings must change
// this profile before their output may be compared with older screenshots.
export function captureProfileHash(profile: CaptureProfile) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        browserVersion: profile.browserVersion,
        platform: profile.platform,
        architecture: profile.architecture,
        osRelease: profile.osRelease,
        width: profile.width,
        height: profile.height,
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezone: 'UTC',
        colorScheme: 'light',
        reducedMotion: 'reduce',
        animations: 'disabled',
        caret: 'hide',
        fullPage: false,
      }),
    )
    .digest('hex');
}

export interface ComparableCapture {
  png: Buffer;
  profileHash: string;
}
export type Comparison =
  | { status: 'incompatible'; reason: 'profile' | 'dimensions' }
  | {
      status: 'matched' | 'changed';
      changedPixels: number;
      totalPixels: number;
      diffRatio: number;
      maxDiffRatio: number;
      pixelThreshold: number;
      diffPng: Buffer;
    };

function readBoundedPng(bytes: Buffer) {
  if (
    bytes.length < 24 ||
    bytes.length > 4 * 1024 * 1024 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    throw new Error('Invalid or oversized screenshot');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0 || width * height > 16_000_000)
    throw new Error('Screenshot dimensions exceed comparison limits');
  return PNG.sync.read(bytes);
}

export function compareCaptures(
  baseline: ComparableCapture,
  current: ComparableCapture,
  options: { pixelThreshold?: number; maxDiffRatio?: number } = {},
): Comparison {
  const { pixelThreshold = 0.1, maxDiffRatio = 0.001 } = options;
  for (const value of [pixelThreshold, maxDiffRatio]) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error('Comparison thresholds must be between 0 and 1');
  }
  if (!baseline.profileHash || !current.profileHash)
    throw new Error('Both capture profiles are required');
  if (baseline.profileHash !== current.profileHash)
    return { status: 'incompatible', reason: 'profile' };
  const before = readBoundedPng(baseline.png);
  const after = readBoundedPng(current.png);
  if (before.width !== after.width || before.height !== after.height)
    return { status: 'incompatible', reason: 'dimensions' };
  const diff = new PNG({ width: before.width, height: before.height });
  const changedPixels = pixelmatch(
    before.data,
    after.data,
    diff.data,
    before.width,
    before.height,
    { threshold: pixelThreshold, includeAA: false, diffColor: [233, 92, 63], alpha: 0.22 },
  );
  const totalPixels = before.width * before.height;
  const diffRatio = changedPixels / totalPixels;
  return {
    status: diffRatio > maxDiffRatio ? 'changed' : 'matched',
    changedPixels,
    totalPixels,
    diffRatio,
    maxDiffRatio,
    pixelThreshold,
    diffPng: PNG.sync.write(diff),
  };
}
