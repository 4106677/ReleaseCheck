import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// Exercise an already running local stack. The API accepts only fixture variants.
const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('heading', { name: 'Run a demo check' }).waitFor();
  for (const variant of ['baseline', 'regression']) {
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
    await report.locator('.status.completed').waitFor({ timeout: 60_000 });
    const screenshot = report.getByRole('img');
    await screenshot.waitFor();
    await screenshot.evaluate((image) => image.decode());
    assert.equal(await screenshot.evaluate((image) => image.naturalWidth), 1440);
    if (variant === 'baseline') {
      assert.match(await report.innerText(), /No JavaScript or network errors/);
    } else {
      assert.match(await report.innerText(), /Demo regression: cart is unavailable/);
      assert.match(await report.innerText(), /HTTP 404/);
    }
    await mkdir('.local/smoke', { recursive: true });
    await page.screenshot({ path: `.local/smoke/${variant}-desktop.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.local/smoke/regression-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'Browser smoke passed: original + regression captures, findings, mobile width, no application JS errors.',
  );
} finally {
  await browser.close();
}
