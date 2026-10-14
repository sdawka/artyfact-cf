import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { serveDist } from './serve';
test.beforeEach(({ page }) => serveDist(page));
const phase = (id: string) => `#phase-${id}`;

test('phases open and close from the keyboard and show their model nodes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://artyfact.test/how-it-works');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How it works');
  await expect(page.locator('.flow-phase')).toHaveCount(10);
  const summary = page.locator(phase('work-in-parallel') + ' summary');
  const body = page.locator(phase('work-in-parallel') + ' .flow-body');
  await expect(body).toBeHidden();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(phase('work-in-parallel') + ' details')).toHaveAttribute('open', '');
  await expect(body.getByText('artyfact task claim <plan-id> <task-id> --system <system-id> --dir <dir>')).toBeVisible();
  await expect(body.locator('[data-model-node="J.lifecycle/claim"]')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(body).toBeHidden();
  await page.locator(phase('check-each-candidate') + ' summary').click();
  await expect(page.locator(phase('check-each-candidate'))).toContainText('Cloudflare Clef');
  await page.locator('.flow-loop a').click();
  await expect(page).toHaveURL(/#phase-agree-the-change$/);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('no axe violations with phases closed and open', async ({ page }) => {
  await page.goto('https://artyfact.test/how-it-works');
  await expect(page.locator('[data-ambient] [data-effect="ambient"]')).toHaveAttribute('data-effect-mode', /^(gl|fallback)$/, { timeout: 15000 });
  const closed = await new AxeBuilder({ page }).analyze();
  expect(closed.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', '))).toEqual([]);
  for (const summary of await page.locator('.flow-phase summary').all()) await summary.click();
  await page.mouse.move(0, 0);
  // Let the node fills finish their transition so axe measures the settled colours.
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || !(animation.effect as KeyframeEffect | null)?.target?.closest?.('.flow')));
  const open = await new AxeBuilder({ page }).analyze();
  expect(open.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', '))).toEqual([]);
});

test('the diagram reads and opens at 390px without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await serveDist(page);
  await page.goto('https://artyfact.test/how-it-works');
  for (const summary of await page.locator('.flow-phase summary').all()) await expect(summary).toBeVisible();
  await expect(page.locator('.flow-fan')).toContainText('for each Task, in parallel');
  await page.locator(phase('promote') + ' summary').click();
  await expect(page.locator(phase('promote'))).toContainText('commitment.cas-promotion');
  for (const summary of await page.locator('.flow-phase summary').all()) await summary.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.flow-phase details, .flow-ids li, .flow-commands code').evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).length)).toBe(0);
  await context.close();
});

test('the diagram survives forced colors and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.goto('https://artyfact.test/how-it-works');
  await page.locator(phase('deploy') + ' summary').click();
  const node = page.locator(phase('deploy') + ' .flow-node');
  await expect(node).toBeVisible();
  expect(await node.evaluate(element => getComputedStyle(element).transitionDuration)).toMatch(/^(0s|1e-05s|0.00001s)(, (0s|1e-05s|0.00001s))*$/);
  const [border, text] = await page.locator(phase('deploy') + ' details').evaluate(element => [getComputedStyle(element).borderTopColor, getComputedStyle(document.body).color]);
  expect(border).toBe(text);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
