import { test, expect } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const dist = resolve(import.meta.dirname, '../dist');
const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml' };
test.beforeEach(async ({ page }) => {
  await page.route('https://artyfact.test/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    let file = resolve(dist, '.' + path);
    if (!file.startsWith(dist + '/') && file !== dist) return route.fulfill({ status: 404 });
    try {
      if ((await stat(file)).isDirectory()) file += '/index.html';
      await route.fulfill({ body: await readFile(file), contentType: types[extname(file)] || 'text/plain',
        headers: { 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" } });
    } catch { await route.fulfill({ status: 404, body: await readFile(resolve(dist, '404.html')), contentType: 'text/html' }); }
  });
});
test('homepage leads to the guide and keeps the platform unavailable', async ({ page }) => {
  await page.goto('https://artyfact.test/');
  await expect(page.getByRole('heading', { name: /Author systems together/ })).toBeVisible();
  await expect(page.locator('a[href="/app"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Bring your agent', exact: true }).first().click();
  await expect(page).toHaveURL('https://artyfact.test/connect-agent');
  await expect(page.locator('code').filter({ hasText: 'ARTYFACT_SECRET' }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('model layers work with keyboard and preserve unknown evidence', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://artyfact.test/model');
  await page.getByRole('tab', { name: /Genome/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Proteome/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tabpanel')).toContainText('Unknown');
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('code copying reports success or a useful fallback', async ({ page }) => {
  await page.goto('https://artyfact.test/connect-agent');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Unavailable'); } } }));
  await page.getByRole('button', { name: 'Copy code' }).first().click();
  await expect(page.getByRole('status').first()).toHaveText('Select the code and copy it manually.');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } }));
  await page.getByRole('button', { name: 'Copy code' }).first().click();
  await expect(page.getByRole('status').first()).toHaveText('Copied.');
});
test('public content is useful without JavaScript', async ({ page }) => {
  await page.route('**/*.js', route => route.abort());
  await page.goto('https://artyfact.test/model');
  await expect(page.getByRole('heading', { name: /One System/ })).toBeVisible();
  await expect(page.getByText('Only the owner can read a private contact.')).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://artyfact.ing/model');
});
