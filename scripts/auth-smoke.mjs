import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  let signedIn = false;
  let unavailable = false;
  let logoutFails = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session')
      return route.fulfill({
        status: unavailable ? 503 : signedIn ? 200 : 401,
        json: signedIn ? { userId: 'owner', mode: 'session' } : {},
      });
    if (path === '/api/auth/logout') {
      if (logoutFails) return route.fulfill({ status: 503, json: {} });
      signedIn = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith('/runs')) return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('http://127.0.0.1:5173/');
  const login = page.getByRole('link', { name: 'Continue with GitHub' });
  await login.waitFor();
  assert.equal(await login.getAttribute('href'), '/api/auth/github');
  await page.keyboard.press('Tab');
  assert.equal(await login.evaluate((element) => document.activeElement === element), true);
  await mkdir('.local/auth', { recursive: true });
  await page.screenshot({ path: '.local/auth/login-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '.local/auth/login-mobile.png' });
  await page.goto('http://127.0.0.1:5173/?auth_error=1');
  await page.getByRole('alert').filter({ hasText: 'Sign-in could not be completed' }).waitFor();
  unavailable = true;
  await page.reload();
  await page.getByRole('button', { name: 'Try again' }).waitFor();
  unavailable = false;
  signedIn = true;
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('button', { name: 'Sign out' }).waitFor();
  logoutFails = true;
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('alert').filter({ hasText: 'Could not sign out' }).waitFor();
  logoutFails = false;
  await page.getByRole('button', { name: 'Sign out' }).click();
  await login.waitFor();
  console.log(
    'Auth UI passed: keyboard login, mobile layout, denied callback, unavailable API, sign-out failure and recovery.',
  );
} finally {
  await browser.close();
}
