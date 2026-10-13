import { expect, test } from '@playwright/test';
import { checkA11yAndShoot, open } from './helpers';

test('empty Systems keep their next action inside a luminous container @fixture', async ({ page }, info) => {
  await page.route('**/api/systems', route => route.fulfill({ contentType: 'application/json', body: '{"systems":[]}' }));
  await page.route('**/api/parts', route => route.fulfill({ contentType: 'application/json', body: '{"parts":[]}' }));
  await page.goto('/');
  const frame = page.locator('[data-surface]').filter({ hasText: 'No Systems yet.' });
  await expect(frame).toBeVisible();
  await expect(frame.locator('[data-effect="surface"]')).toHaveCount(1);
  await expect(frame.getByRole('link', { name: 'Import one with artyfact init' })).toBeVisible();
  await expect(page.locator('[data-effect="orb"]')).toHaveCount(0);
  await checkA11yAndShoot(page, info, 'empty-systems-desktop');
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await checkA11yAndShoot(page, info, 'empty-systems-mobile');
});

test('surface content and geometry remain readable at narrow widths', async ({ page }, info) => {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await open(page, '/overview', 'Overview');
    const hero = page.getByRole('region', { name: 'Keep in Touch' });
    await expect(hero.getByRole('heading', { name: 'Keep in Touch' })).toBeVisible();
    const fits = await hero.evaluate(element => {
      const text = element.querySelector('h2')!;
      const frame = element.querySelector('[data-effect="surface"]')!.getBoundingClientRect();
      const title = text.getBoundingClientRect();
      return title.left >= frame.left && title.right <= frame.right && title.top >= frame.top && title.bottom <= frame.bottom && text.scrollWidth <= text.clientWidth;
    });
    expect(fits).toBe(true);
    // The shell scrolls internally: document width alone misses clipped System content.
    const main = page.getByRole('main');
    expect(await main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const purpose = hero.getByText(/Help an individual keep in touch/);
    await expect(purpose).toContainText("people's autonomy.");
    const readable = await purpose.evaluate(element => {
      const viewport = element.closest('main')!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()].every(line => line.left >= viewport.left && line.right <= viewport.right);
    });
    expect(readable).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await checkA11yAndShoot(page, info, `surface-${width}x${height}`);
  }
});

test('reduced motion and forced colors preserve meaningful content', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '/overview', 'Overview');
  const hero = page.getByRole('region', { name: 'Keep in Touch' });
  const surface = hero.locator('[data-effect="surface"]');
  await expect(surface).toHaveAttribute('data-effect-mode', 'static');
  expect(await surface.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  await checkA11yAndShoot(page, info, 'surface-reduced');
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'no-preference' });
  await expect(surface).toHaveCSS('display', 'none');
  await expect(hero.getByRole('heading', { name: 'Keep in Touch' })).toBeVisible();
  await expect(hero.getByText(/Help an individual keep in touch/)).toBeVisible();
  const colors = await hero.evaluate(element => {
    const probe = document.createElement('span'); probe.style.color = 'CanvasText'; document.body.append(probe);
    const canvasText = getComputedStyle(probe).color; probe.remove();
    return { title: getComputedStyle(element.querySelector('h2')!).color, canvasText };
  });
  expect(colors.title).toBe(colors.canvasText);
  await page.screenshot({ path: info.outputPath('surface-forced-colors.png'), fullPage: true });
});
