import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// Exercise an already running local stack. This explicitly approves demo baselines.
const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('heading', { name: 'Run a demo check' }).waitFor();
  async function check(variant) {
    await page.getByLabel('Demo version').selectOption(variant);
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) => response.request().method() === 'POST' && response.url().endsWith('/runs'),
      ),
      page.getByRole('button', { name: 'Run check', exact: true }).click(),
    ]);
    assert.ok([200, 202].includes(response.status()));
    const { id } = await response.json();
    const report = page.locator(`section[data-run-id="${id}"]`);
    await report.locator('.rc-status.completed').waitFor({ timeout: 60_000 });
    await report
      .locator('.dp-capture img')
      .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    assert.equal(
      await report
        .locator('.dp-capture img')
        .first()
        .evaluate((image) => image.naturalWidth),
      1440,
    );
    return report;
  }
  async function approve(report) {
    await report.getByRole('button', { name: 'Use as baseline', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await report.getByRole('button', { name: 'Use as baseline', exact: true }).click();
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/baselines'),
      ),
      page.getByRole('button', { name: 'Confirm baseline', exact: true }).click(),
    ]);
    assert.equal(response.status(), 200);
    await report.getByRole('button', { name: 'Current baseline', exact: true }).waitFor();
  }
  const original = await check('baseline');
  await approve(original);
  const matched = await check('baseline');
  assert.match(await matched.innerText(), /Checks passed/);
  assert.match(await matched.innerText(), /0 changed pixels/);
  const regression = await check('regression');
  assert.match(await regression.innerText(), /Needs attention/);
  assert.match(await regression.innerText(), /Demo regression: cart is unavailable/);
  assert.match(await regression.innerText(), /HTTP 404/);
  const browserStat = regression.locator('.dp-stat').filter({ hasText: 'BROWSER ISSUES' });
  assert.match(await browserStat.innerText(), /2\s*3 observations/);
  await regression.getByRole('button', { name: /HTTP 404/ }).click();
  const evidence = regression.locator('.rc-evidence');
  await evidence.getByText('Original evidence (2)', { exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await evidence.getAttribute('open'), '');
  assert.match(await evidence.innerText(), /Failed to load resource/);
  assert.match(await evidence.innerText(), /GET · fetch · HTTP 404/);
  assert.equal(await evidence.locator('li').count(), 2);
  await regression.getByRole('button', { name: /Demo regression: cart is unavailable/ }).click();
  await regression.getByText('Original evidence (1)', { exact: true }).click();
  assert.match(await regression.locator('.rc-evidence pre').innerText(), /cart is unavailable/);
  await regression.getByRole('button', { name: /HTTP 404/ }).click();
  await regression.getByText('Original evidence (2)', { exact: true }).click();
  const slider = regression.getByRole('slider', { name: 'Comparison position' });
  await slider.fill('58');
  await regression.getByRole('button', { name: 'Difference', exact: true }).click();
  const imageUrl = await regression.locator('.dp-capture img').getAttribute('src');
  assert.match(imageUrl, /^\/api\/artifacts\//);
  const response = await page.request.get(new URL(imageUrl, page.url()).href);
  assert.equal(response.status(), 200);
  assert.equal(response.headers()['content-type'], 'image/png');
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await mkdir('.local/smoke', { recursive: true });
  await page.screenshot({ path: '.local/smoke/regression-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await page.getByRole('button', { name: 'Run check', exact: true }).isVisible());
  await page.screenshot({ path: '.local/smoke/regression-mobile.png', fullPage: true });
  await approve(regression);
  const accepted = await check('regression');
  assert.match(await accepted.innerText(), /0 changed pixels/);
  assert.match(await accepted.innerText(), /Needs attention/);
  assert.match(await accepted.innerText(), /Demo regression: cart is unavailable/);
  const latestUrl = page.url();
  assert.match(new URL(latestUrl).pathname, /^\/runs\/[a-f0-9-]+$/);
  await page.reload();
  await page
    .locator(
      `section[data-run-id="${new URL(latestUrl).pathname.split('/').pop()}"] .rc-status.completed`,
    )
    .waitFor();
  await page.getByRole('link', { name: 'Checks', exact: true }).click();
  await page.getByRole('heading', { name: 'Know what changed.' }).waitFor();
  await page.goBack();
  await page.getByRole('region', { name: 'Check result' }).waitFor();
  assert.equal(page.url(), latestUrl);
  await page.goForward();
  assert.equal(new URL(page.url()).pathname, '/');
  const reportLink = page.locator('.rc-history a').first();
  assert.equal(await reportLink.getAttribute('href'), new URL(latestUrl).pathname);
  const [separateTab] = await Promise.all([
    page.context().waitForEvent('page'),
    reportLink.click({ button: 'middle' }),
  ]);
  await separateTab.getByRole('region', { name: 'Check result' }).waitFor();
  assert.equal(separateTab.url(), latestUrl);
  await separateTab.close();
  await reportLink.click();
  await page.getByRole('region', { name: 'Check result' }).waitFor();
  await page.goto('http://127.0.0.1:5173/runs/not-a-uuid');
  await page.getByRole('heading', { name: 'Page not found' }).waitFor();
  await page.getByRole('link', { name: 'Back to checks', exact: true }).click();
  await page.goto('http://127.0.0.1:5173/runs/00000000-0000-4000-8000-000000000099');
  await page.getByRole('alert').filter({ hasText: 'Run not found.' }).waitFor();
  // A permalink must not depend on inclusion in the latest-20 history page.
  await page.route('**/api/projects/*/runs', (route) => route.fulfill({ json: [] }));
  await page.goto(latestUrl);
  await page.getByRole('region', { name: 'Check result' }).waitFor();
  assert.match(await page.title(), /Check .* · ReleaseCheck/);
  assert.equal(await page.locator('.rc-history a').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'Browser smoke passed: approve baseline, unchanged pass, real diff, mobile layout, Escape, approved visual change retains browser errors, report URLs/reload/back/forward/new tab.',
  );
} finally {
  await browser.close();
}
