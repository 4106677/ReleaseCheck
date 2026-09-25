import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mkdir('.local/design-review', { recursive: true });
  for (const direction of ['studio', 'console']) {
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto(`http://127.0.0.1:5173/design?direction=${direction}`);
    await page.getByRole('region', { name: 'Visual comparison' }).waitFor();
    await page
      .locator('.dp-capture img')
      .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    const slider = page.getByRole('slider', { name: 'Comparison position' });
    await slider.fill('40');
    assert.equal(await slider.inputValue(), '40');
    const bounds = await page.locator('.dp-capture').boundingBox();
    assert.ok(bounds);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height / 2);
    await page.mouse.up();
    assert.equal(await slider.inputValue(), '75');
    await slider.fill('58');
    await page.locator('.dp-report-head h1').click();
    await page.screenshot({
      path: `.local/design-review/${direction}-desktop.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Difference', exact: true }).click();
    assert.ok((await page.locator('.dp-capture img').getAttribute('src')).endsWith('/diff.png'));
    await page.getByRole('button', { name: /Cart is unavailable/ }).click();
    assert.match(await page.locator('.dp-issue-detail').innerText(), /unhandled error/);
    await page.getByRole('button', { name: /Review summary/ }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: /The primary action changed/ }).click();
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `.local/design-review/${direction}-mobile.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'A Review Studio' }).click();
  assert.ok(page.url().endsWith('?direction=studio'));
  assert.deepEqual(errors, []);
  console.log(
    'Design smoke passed: both directions, slider, diff, issue selection, keyboard dialog, mobile layout.',
  );
} finally {
  await browser.close();
}
