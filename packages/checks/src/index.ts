import { release } from 'node:os';
import { captureProfileHash } from './compare.js';
import { chromium } from 'playwright';
import { z } from 'zod';
import { findingSchema, type Finding } from '@releasecheck/contracts';
export {
  captureProfileHash,
  compareCaptures,
  type CaptureProfile,
  type ComparableCapture,
  type Comparison,
} from './compare.js';

export function localFixtureOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'This local prototype only supports a fixture origin at http://127.0.0.1:<port>',
    );
  }
  return url.origin;
}

export const captureInputSchema = z.strictObject({
  url: z.url(),
  fixtureOrigin: z.string().transform(localFixtureOrigin),
  width: z.literal(1440),
  height: z.literal(900),
});
export type CaptureInput = z.infer<typeof captureInputSchema>;
export const captureOutputSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    screenshot: z.string().max(6_000_000),
    width: z.literal(1440),
    height: z.literal(900),
    browserVersion: z.string(),
    profileHash: z.string().regex(/^[a-f0-9]{64}$/),
    findings: z.array(findingSchema).max(101),
  }),
  z.object({ ok: z.literal(false), error: z.enum(['NAVIGATION_FAILED', 'CAPTURE_FAILED']) }),
]);
export type CaptureOutput = z.infer<typeof captureOutputSchema>;

export async function captureFixture(input: CaptureInput): Promise<CaptureOutput> {
  const url = new URL(input.url);
  if (
    url.origin !== input.fixtureOrigin ||
    url.pathname !== '/' ||
    !['', '?regression=1'].includes(url.search) ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error('Capture target must be one of the two controlled fixture variants');
  }
  // The local fixture exception is not a sandbox for arbitrary websites.
  // Browser launch failures are infrastructure errors and should be retried by the job.
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  try {
    const context = await browser.newContext({
      viewport: { width: input.width, height: input.height },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'light',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    await context.route('**/*', (route) => {
      const target = new URL(route.request().url());
      return target.origin === input.fixtureOrigin
        ? route.continue()
        : route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(30_000);
    const findings: Finding[] = [];
    const add = (finding: Finding) => {
      if (findings.length < 100) findings.push(finding);
      else if (findings.length === 100)
        findings.push({
          kind: 'console',
          message: 'Observation limit reached; additional findings were omitted.',
        });
    };
    page.on('pageerror', (error) =>
      add({
        kind: 'javascript',
        message: error.message.slice(0, 2000),
        ...(error.stack ? { stack: error.stack.slice(0, 4000) } : {}),
      }),
    );
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const location = message.location();
        add({
          kind: 'console',
          message: message.text().slice(0, 2000),
          ...(location.url
            ? {
                source: {
                  url: location.url.slice(0, 2048),
                  ...(location.lineNumber >= 0 ? { line: location.lineNumber + 1 } : {}),
                  ...(location.columnNumber >= 0 ? { column: location.columnNumber + 1 } : {}),
                },
              }
            : {}),
        });
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 400)
        add({
          kind: 'http',
          message: `HTTP ${response.status()}`,
          url: response.url().slice(0, 2048),
          request: {
            method: response.request().method().slice(0, 32),
            resourceType: response.request().resourceType().slice(0, 64),
            status: response.status(),
          },
        });
    });
    page.on('requestfailed', (request) =>
      add({
        kind: 'transport',
        message: (request.failure()?.errorText ?? 'Request failed').slice(0, 2000),
        url: request.url().slice(0, 2048),
        request: {
          method: request.method().slice(0, 32),
          resourceType: request.resourceType().slice(0, 64),
        },
      }),
    );
    try {
      await page.goto(input.url, { waitUntil: 'domcontentloaded' });
    } catch {
      return { ok: false, error: 'NAVIGATION_FAILED' };
    }
    try {
      // The controlled fixture explicitly signals that its regression requests have settled.
      await page.locator('html[data-ready="true"]').waitFor();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const screenshot = await page.screenshot({
        animations: 'disabled',
        caret: 'hide',
        type: 'png',
        timeout: 10_000,
      });
      if (screenshot.length > 4 * 1024 * 1024) return { ok: false, error: 'CAPTURE_FAILED' };
      return {
        ok: true,
        screenshot: screenshot.toString('base64'),
        width: input.width,
        height: input.height,
        browserVersion: browser.version(),
        profileHash: captureProfileHash({
          browserVersion: browser.version(),
          platform: process.platform,
          architecture: process.arch,
          osRelease: release(),
          width: input.width,
          height: input.height,
        }),
        findings,
      };
    } catch {
      return { ok: false, error: 'CAPTURE_FAILED' };
    }
  } finally {
    await browser.close();
  }
}
