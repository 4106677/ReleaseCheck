import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// UI failure/retry states are deterministic here. Real SIGKILL and queue recovery
// are covered separately by the PostgreSQL integration suite.
const failedId = 'a1111111-1111-4111-8111-111111111111';
const retriedId = 'a2222222-2222-4222-8222-222222222222';
const failed = {
  id: failedId,
  status: 'failed',
  verdict: 'inconclusive',
  variant: 'regression',
  attempt: 3,
  createdAt: '2026-09-26T07:00:00.000Z',
  finishedAt: '2026-09-26T07:02:00.000Z',
  error: 'RUN_DEADLINE_EXCEEDED',
  comparison: null,
  capture: null,
};
const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  const submissions = [];
  let created = false;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.endsWith('/runs')) {
      submissions.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
      if (submissions.length === 1) {
        await route.fulfill({
          status: 503,
          json: { message: 'Temporarily unavailable. Try again.' },
        });
      } else {
        created = true;
        await route.fulfill({ status: 202, json: { id: retriedId, reused: false } });
      }
    } else if (path.includes('/projects/') && path.endsWith('/runs')) {
      await route.fulfill({
        json: created ? [{ ...failed, id: retriedId, status: 'queued' }, failed] : [failed],
      });
    } else if (path === `/api/runs/${failedId}`) {
      await route.fulfill({ json: failed });
    } else if (path === `/api/runs/${retriedId}`) {
      await route.fulfill({
        json: {
          ...failed,
          id: retriedId,
          status: 'queued',
          attempt: 0,
          finishedAt: null,
          error: null,
        },
      });
    } else {
      await route.fulfill({ status: 404, json: {} });
    }
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: /a1111111/ }).click();
  const report = page.locator(`section[data-run-id="${failedId}"]`);
  await report.getByRole('button', { name: 'Retry check', exact: true }).waitFor();
  assert.match(await report.innerText(), /exceeded its time limit/);
  assert.equal(await report.getByRole('img').count(), 0);
  assert.equal(await report.getByRole('button', { name: 'Use as baseline' }).count(), 0);
  await mkdir('.local/recovery', { recursive: true });
  await page.screenshot({ path: '.local/recovery/failed-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '.local/recovery/failed-mobile.png', fullPage: true });
  await report.getByRole('button', { name: 'Retry check', exact: true }).click();
  await page.getByText('Temporarily unavailable. Try again.', { exact: true }).waitFor();
  await report.getByRole('button', { name: 'Retry check', exact: true }).click();
  await page.locator(`section[data-run-id="${retriedId}"]`).waitFor();
  assert.equal(submissions.length, 2);
  assert.deepEqual(submissions[0].body, { variant: 'regression' }); // Select defaults to original.
  assert.deepEqual(submissions[1], submissions[0]); // Ambiguous retry keeps its key.
  assert.ok(submissions[0].key);
  assert.deepEqual(errors, []);
  console.log(
    'Recovery UI passed: readable failure, no false evidence, mobile retry, same variant and stable idempotency key.',
  );
} finally {
  await browser.close();
}
