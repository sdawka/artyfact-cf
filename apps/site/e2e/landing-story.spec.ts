import { test, expect, type Page } from '@playwright/test';
import { serveDist } from './serve';
test.beforeEach(({ page }) => serveDist(page));
const scene = '[data-system-view]';
async function narrative(page: Page, view: string) {
  await page.evaluate(view => {
    const step = document.querySelector<HTMLElement>('[data-story-step="' + view + '"]')!;
    window.scrollTo({ top: scrollY + step.getBoundingClientRect().top - innerHeight * .35, behavior: 'instant' });
  }, view);
}
test('native scroll resumes after mouse selection and leaves focus and history alone', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Native pinned desktop story');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('https://artyfact.test/');
  await expect(page.locator(scene)).toHaveAttribute('data-sticky', 'true');
  await narrative(page, 'genome');
  await page.getByRole('tab', { name: /Phenome/ }).click();
  const href = page.url();
  await page.evaluate(() => window.scrollBy({ top: 10, behavior: 'instant' }));
  await expect(page.locator(scene)).toHaveAttribute('data-system-view', 'phenome');
  await narrative(page, 'proteome');
  await expect(page.locator(scene)).toHaveAttribute('data-system-view', 'proteome');
  await page.screenshot({ path: info.outputPath('desktop-scroll-proteome.png') });
  expect(page.url()).toBe(href);
  await expect(page.getByRole('tab', { name: /Phenome/ })).toBeFocused();
});
test('keyboard exploration suspends scrolling without stealing focus', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Native pinned desktop story');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('https://artyfact.test/');
  await page.keyboard.press('Tab');
  await page.getByRole('tab', { name: /Genome/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Proteome/ })).toBeFocused();
  await narrative(page, 'phenome');
  await expect(page.locator(scene)).toHaveAttribute('data-system-view', 'proteome');
  await expect(page.getByRole('tab', { name: /Proteome/ })).toBeFocused();
  await page.getByRole('link', { name: 'Understand the model', exact: true }).first().focus();
  await expect(page.locator(scene)).toHaveAttribute('data-system-view', 'phenome');
  await page.screenshot({ path: info.outputPath('desktop-scroll-phenome.png') });
});
test('responsive scene keeps every card readable and applies measured pinning', async ({ page }, info) => {
  const sizes = info.project.name === 'desktop' ? [[1440, 900], [1280, 720]] : [[390, 844], [390, 667], [320, 568]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.goto('https://artyfact.test/');
    await page.getByRole('tab', { name: /Genome/ }).focus();
    await expect(page.locator(scene)).toHaveAttribute('data-scroll-mode', /following|static/);
    for (const view of ['Genome', 'Proteome', 'Phenome']) {
      await page.getByRole('tab', { name: new RegExp(view) }).click();
      await expect(page.locator(scene)).toHaveAttribute('data-system-view', view.toLowerCase());
      await page.waitForTimeout(550);
      await page.locator(scene).screenshot({ path: info.outputPath(`${width}x${height}-${view}.png`) });
      const geometry = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('[data-system-view]')!, r = root.getBoundingClientRect();
        const boundary = document.querySelector('.scene-system')!.getBoundingClientRect();
        const cards = [...document.querySelectorAll<HTMLElement>('.scene-application, .scene-runtime, .scene-observation-slot')].map(card => {
          const c = card.getBoundingClientRect();
          return { inside: c.left >= boundary.left && c.right <= boundary.right && c.top >= boundary.top && c.bottom <= boundary.bottom, fits: card.scrollWidth <= card.clientWidth + 1 };
        });
        return { overflow: document.documentElement.scrollWidth > innerWidth, pinned: root.dataset.sticky === 'true', fits: innerWidth > 950 ? r.height <= innerHeight - 48 : r.height <= innerHeight * .45 && innerHeight - r.height - 40 >= 240, cards };
      });
      expect(geometry.overflow).toBe(false);
      expect(geometry.pinned).toBe(geometry.fits);
      expect(geometry.cards.every(card => card.inside && card.fits)).toBe(true);
    }
  }
});
test('homepage static example and all narratives survive without JavaScript', async ({ browser }, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: info.project.name === 'desktop' ? { width: 1440, height: 900 } : { width: 320, height: 568 } });
  const page = await context.newPage();
  await serveDist(page);
  await page.goto('https://artyfact.test/');
  await expect(page.locator(scene)).toHaveAttribute('data-system-view', 'genome');
  await expect(page.locator(scene)).toHaveAttribute('data-sticky', 'false');
  expect(await page.locator('.scene-system').evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe('20px');
  expect(await page.locator('.scene-board').evaluate(element => getComputedStyle(element).display)).toBe('grid');
  for (const title of ['Give the application its shape.', 'Make that shape tangible.', 'See what happens when it functions.']) await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByText('Composition + provenance', { exact: true }).click();
  await expect(page.locator('.scene-selected-detail details')).toHaveAttribute('open', '');
  await page.locator(scene).screenshot({ path: info.outputPath('no-js.png') });
  await context.close();
});

test('forced colors retain visible selected views and subjects', async ({ page }, info) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('https://artyfact.test/');
  const tab = page.getByRole('tab', { name: /Phenome/ });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  expect(await tab.evaluate(element => getComputedStyle(element).outlineWidth)).toBe('2px');
  const app = page.getByRole('button', { name: 'Inspect Fieldnotes application' });
  await expect(app).toHaveAttribute('aria-pressed', 'true');
  const selectedOutline = await app.evaluate(element => { const style = getComputedStyle(element); return { width: parseFloat(style.outlineWidth), style: style.outlineStyle }; });
  expect(selectedOutline.width).toBeGreaterThanOrEqual(1);
  expect(selectedOutline.style).toBe('solid');
  await page.locator(scene).screenshot({ path: info.outputPath('forced-colors.png') });
});

test('Phenome hands over after six saves, celebrates once, and preserves local progress', async ({ page }, info) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await page.goto('https://artyfact.test/');
  await page.getByRole('tab', { name: /Phenome/ }).click();
  const chart = page.getByRole('img', { name: /^Sample saves:/ });
  await expect(chart).toHaveAttribute('aria-label', /^Sample saves: 6\./, { timeout: 7000 });
  const save = page.getByRole('button', { name: 'Save record', exact: true });
  for (let i = 0; i < 6; i++) await save.click();
  await expect(page.getByRole('status')).toHaveText('Great energy!');
  await expect(chart).toHaveAttribute('aria-label', /^Sample saves: 12\./);
  await expect(page.locator('[data-scene-confetti] i')).toHaveCount(18);
  await page.locator(scene).screenshot({ path: info.outputPath('phenome-celebration.png') });
  await expect(page.locator('[data-scene-confetti]')).toHaveCount(0);
  await save.click();
  await expect(chart).toHaveAttribute('aria-label', /^Sample saves: 13\./);
  await expect(page.locator('[data-chart-level]')).toHaveAttribute('data-chart-level', '12');
  await page.getByRole('tab', { name: /Genome/ }).click();
  await page.getByRole('tab', { name: /Phenome/ }).click();
  await expect(chart).toHaveAttribute('aria-label', /^Sample saves: 13\./);
  await expect(page.getByRole('status')).toHaveCount(0);
  await save.click();
  await expect(chart).toHaveAttribute('aria-label', /^Sample saves: 14\./);
  await expect(page.locator('[data-scene-confetti]')).toHaveCount(0);
  expect(writes).toEqual([]);
});
test('keyboard Save remains visible when the scroll narrative changes', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Native pinned desktop story');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('https://artyfact.test/');
  await page.getByRole('tab', { name: /Phenome/ }).click();
  await page.keyboard.press('Tab');
  const save = page.getByRole('button', { name: 'Save record', exact: true });
  await save.focus();
  const chart = page.getByRole('img', { name: /^Sample saves:/ });
  const before = Number((await chart.getAttribute('aria-label'))!.match(/saves: (\d+)/)![1]);
  await narrative(page, 'proteome');
  await expect(page.locator(scene)).toHaveAttribute('data-system-view', 'phenome');
  await expect(save).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(chart).toHaveAttribute('aria-label', new RegExp('^Sample saves: ' + (before + 1) + '\\.'));
  await page.getByRole('link', { name: 'Bring your agent', exact: true }).first().focus();
  await narrative(page, 'proteome');
  await expect(page.locator(scene)).toHaveAttribute('data-system-view', 'proteome');
});
