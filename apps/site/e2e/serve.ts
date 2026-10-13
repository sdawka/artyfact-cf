import type { Page } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const dist = resolve(import.meta.dirname, '../dist');
const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml' };
/** Serves the built site at https://artyfact.test with the production CSP; no local server needed. */
export async function serveDist(page: Page) {
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
}

/** Reach the first narrative before operating chrome deliberately hidden in the opening. */
export async function revealStory(page: Page) {
  await page.evaluate(() => { const step = document.querySelector('[data-story-step="genome"]'); if (step) window.scrollTo({ top: scrollY + step.getBoundingClientRect().top - innerHeight * .25, behavior: 'instant' }); });
  await page.getByRole('tab', { name: /Genome/ }).click();
}
