import { test, expect, type Page } from '@playwright/test';
import { serveDist, revealStory } from './serve';
test.beforeEach(({ page }) => serveDist(page));
const story = '.checkout-story';
async function readStep(page: Page, index: number) {
  await page.evaluate(index => {
    const step = document.querySelector<HTMLElement>('[data-checkout-step="' + index + '"]')!;
    window.scrollTo({ top: scrollY + step.getBoundingClientRect().top - innerHeight * .5 + 40, behavior: 'instant' });
  }, index);
}
test('all content and seven stacked steps survive without JavaScript', async ({ browser }, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: info.project.name === 'desktop' ? { width: 1440, height: 900 } : { width: 320, height: 568 } });
  const page = await context.newPage();
  await serveDist(page);
  await page.goto('https://artyfact.test/');
  await expect(page.locator(story)).not.toHaveAttribute('data-enhanced', 'true');
  await expect(page.locator('.checkout-step-buttons')).toBeHidden();
  for (let index = 0; index < 7; index++) await expect(page.locator(`[data-checkout-step="${index}"]`)).toBeVisible();
  await expect(page.locator('.checkout-deploy')).toContainText('Outcome: not measured yet');
  await expect(page.locator('.practice-card s').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#home-system-story').screenshot({ path: info.outputPath('no-js.png') });
  await context.close();
});
test('step buttons are keyboard operable and keep aria-current in sync', async ({ page }) => {
  await page.goto('https://artyfact.test/');
  await revealStory(page);
  const group = page.getByRole('group', { name: 'Example steps' });
  await group.getByRole('button').first().focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(group.getByRole('button').nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(group.getByRole('button').nth(1)).toBeFocused();
  await expect(group.locator('[aria-current]')).toHaveCount(1);
  await expect(page.locator('.checkout-lane').first()).toHaveAttribute('data-phase', 'current');
  await expect(page.locator('.checkout-promote .checkout-kind')).toBeHidden();
});
test('scrolling the steps drives the same step state on wide screens', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Scroll follows only on wide screens');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('https://artyfact.test/');
  await revealStory(page);
  await expect(page.locator(story)).toHaveAttribute('data-following', 'true');
  for (const index of [2, 5, 1]) {
    await readStep(page, index);
    await expect(page.locator(story)).toHaveAttribute('data-step', String(index));
    await expect(page.getByRole('group', { name: 'Example steps' }).getByRole('button').nth(index)).toHaveAttribute('aria-current', 'step');
  }
  const stage = await page.locator('.checkout-stage').boundingBox();
  expect(stage!.y).toBeGreaterThanOrEqual(0);
  expect(stage!.y + stage!.height).toBeLessThanOrEqual(900);
  await page.getByRole('button', { name: 'Step 7: Decide what is next' }).click();
  await page.evaluate(() => window.scrollBy({ top: 10, behavior: 'instant' }));
  await expect(page.locator(story)).toHaveAttribute('data-step', '6');
  await readStep(page, 3);
  await expect(page.locator(story)).toHaveAttribute('data-step', '3');
  await page.screenshot({ path: info.outputPath('desktop-scroll.png') });
});
test('narrow screens keep every section in flow without horizontal scroll', async ({ page }, info) => {
  for (const [width, height] of info.project.name === 'desktop' ? [[1280, 720]] : [[390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await page.goto('https://artyfact.test/');
    await revealStory(page);
    if (width < 951) await expect(page.locator(story)).not.toHaveAttribute('data-following', 'true');
    await page.getByRole('button', { name: 'Step 5: Integrate and promote' }).click();
    await expect(page.locator('.checkout-promote')).toHaveAttribute('data-phase', 'current');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.practice-card, .checkout-row, .cloudflare-cells > div')].filter(element => element.scrollWidth > element.clientWidth + 1).length);
    expect(clipped).toBe(0);
    await page.locator('.checkout-stage').screenshot({ path: info.outputPath(`${width}x${height}-stage.png`) });
  }
});
test('forced colors keep the current step and row visible', async ({ page }, info) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('https://artyfact.test/');
  await revealStory(page);
  const button = page.getByRole('button', { name: 'Step 3: Flag the overlap' });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'step');
  expect(await button.evaluate(element => getComputedStyle(element).outlineWidth)).toBe('2px');
  expect(await page.locator('.checkout-overlap').evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
  await expect(page.locator('.practice-card s').first()).toHaveCSS('text-decoration-line', 'line-through');
  await page.locator('.checkout-stage').screenshot({ path: info.outputPath('forced-colors.png') });
});
