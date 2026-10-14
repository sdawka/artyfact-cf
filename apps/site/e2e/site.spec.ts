import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { serveDist, revealStory } from './serve';
test.beforeEach(({ page }) => serveDist(page));
test('homepage leads to the guide and links the hosted platform', async ({ page }) => {
  await page.goto('https://artyfact.test/');
  await revealStory(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The next Git platform keeps track of the product, not just the files.');
  await expect(page.getByRole('link', { name: 'Open the platform' })).toHaveAttribute('href', 'https://artyfact-platform.dawka.workers.dev');
  await expect(page.locator('a[href="/app"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Bring your agent', exact: true }).first().click();
  await expect(page).toHaveURL('https://artyfact.test/connect-agent');
  await expect(page.locator('code').filter({ hasText: 'artyfact task claim' }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('model layers work with keyboard and keep illustrative evidence labelled', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://artyfact.test/model');
  await page.getByRole('tab', { name: /Genome/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Proteome/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tabpanel')).toContainText('Page read');
  await expect(page.getByRole('tabpanel')).toContainText('not live Artyfact telemetry');
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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Theory Driven Development');
  await expect(page.locator('[data-theory-card] [data-theory-part]')).toHaveCount(4);
  await expect(page.locator('[data-theory-card]')).toContainText('Measurement in progress');
  await expect(page.locator('#lifecycle ol > li summary')).toHaveCount(6);
  for (const summary of await page.locator('#lifecycle ol > li summary').all()) await expect(summary).toBeVisible();
  await expect(page.locator('#claim-anatomy [data-claim-field]')).toHaveCount(7);
  await expect(page.getByText(/A Thing can start with its model alone/)).toBeVisible();
  await expect(page.locator('.model-view-panels > section')).toHaveCount(3);
  for(const panel of await page.locator('.model-view-panels > section').all()) await expect(panel).toBeVisible();
  await expect(page.getByText('Acceptance check',{exact:true})).toBeVisible();
  await expect(page.getByRole('list',{name:'Illustrative reader observations'})).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://artyfact.ing/model');
});
const mounted = (page: Page) => expect(page.locator('[data-ambient] [data-effect="ambient"]')).toHaveAttribute('data-effect-mode', /^(gl|fallback)$/, { timeout: 15000 });
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
test('checkout example steps through all seven states without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('https://artyfact.test/');
  await revealStory(page);
  await mounted(page);
  await expect(page.locator('[data-hero-orb]')).toHaveCount(0);
  for (let index = 0; index < 7; index++) {
    const button = page.getByRole('group', { name: 'Example steps' }).getByRole('button').nth(index);
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('.checkout-story')).toHaveAttribute('data-step', String(index));
  }
  await expect(page.locator('.checkout-deploy')).toContainText('Not measured yet');
  await expect(page.getByText('Step 7 of 7: Decide what is next')).toBeVisible();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('effects and the example respect reduced motion', async ({ page }) => {
  const errors = watchErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('https://artyfact.test/');
  await revealStory(page);
  await mounted(page);
  await page.getByRole('button', { name: 'Step 3: Flag the overlap' }).click();
  const durations = await page.locator('.checkout-row, .checkout-verdict, .checkout-order').evaluateAll(elements => elements.map(element => getComputedStyle(element).transitionDuration));
  expect(durations.length).toBeGreaterThan(8);
  for (const duration of durations) expect(duration).toMatch(/^(0s|1e-05s|0.00001s)(, (0s|1e-05s|0.00001s))*$/);
  expect(errors).toEqual([]);
});
for (const path of ['/', '/model', '/connect-agent']) test('no axe violations with effects mounted: ' + path, async ({ page }) => {
  await page.goto('https://artyfact.test' + path);
  await expect(page.locator('[data-ambient] [data-effect="ambient"]')).toHaveAttribute('data-effect-mode', /^(gl|fallback)$/, { timeout: 15000 });
  if (path === '/') {
    const initial = await new AxeBuilder({ page }).analyze();
    expect(initial.violations.map(v => v.id)).toEqual([]);
    await revealStory(page);
  }
  for (const step of path === '/' ? [1, 4, 7] : [null]) {
    if (step) await page.getByRole('group', { name: 'Example steps' }).getByRole('button').nth(step - 1).click();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', '))).toEqual([]);
  }
});

test('self-model nesting is readable at 320px without JavaScript', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.route('**/*.js', route => route.abort());
  await page.goto('https://artyfact.test/model');
  await expect(page.locator('[data-model-subject="component.model-explanation"]')).toContainText('Communicate clearly');
  await expect(page.locator('[data-model-subject="affordance.model.inspect-views"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const panel of await page.locator('.model-view-panels > section').all()) await expect(panel).toBeVisible();
});
test('self-model anchor and view controls work with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('https://artyfact.test/model');
  await page.locator('[data-model-subject="affordance.model.inspect-views"]').click();
  await expect(page).toHaveURL(/#model-parallel-views$/);
  await page.getByRole('tab', { name: /Genome/ }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tabpanel')).toContainText('Reader feedback remains unmeasured');
});

test('model jump links and loop steps remain usable on a narrow screen with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('https://artyfact.test/model');
  expect(await page.locator('.loop-flow').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  const navigation = page.getByRole('navigation', { name: 'On this page' });
  await navigation.getByRole('link', { name: 'The vocabulary' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#meta-ontology$/);
  await expect(page.locator('#meta-ontology')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'The vocabulary: a multi-level model.', exact: true })).toBeInViewport();
  await navigation.getByRole('link', { name: 'Why it helps' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#benefits$/);
  await expect(page.locator('#benefits')).toBeFocused();
  await page.locator('.model-benefits-grid summary').filter({ hasText: 'Context agents can use' }).click();
  await expect(page.getByText(/A Task Packet carries the purpose, the criteria/)).toBeVisible();
  await navigation.getByRole('link', { name: 'How a change moves' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#lifecycle')).toBeFocused();
  const theory = page.locator('#lifecycle summary').filter({ hasText: 'Write the theory down' });
  await theory.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/An Evolution changes the Genome/)).toBeVisible();
  await page.locator('#lifecycle summary').filter({ hasText: 'Ship the combined result' }).click();
  await expect(page.getByText(/Promoting is a separate approval/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('the handoff map is readable without JavaScript and links each step', async ({ browser }, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: info.project.name === 'desktop' ? { width: 1280, height: 900 } : { width: 320, height: 568 } });
  const page = await context.newPage();
  await serveDist(page);
  await page.goto('https://artyfact.test/connect-agent');
  await expect(page.locator('.handoff-station')).toHaveCount(7);
  for (const station of await page.locator('.handoff-station').all()) await expect(station).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.handoff a').filter({ hasText: 'task submit' }).click();
  await expect(page).toHaveURL(/#submit$/);
  await expect(page.getByRole('heading', { name: 'Checkpoint and submit' })).toBeInViewport();
  await context.close();
});
test('opening a loop step lights its node on the ring', async ({ page }) => {
  await page.goto('https://artyfact.test/model');
  const fill = () => page.locator('.loop-node-3 circle').evaluate(element => getComputedStyle(element).fill);
  const before = await fill();
  await page.locator('#lifecycle summary').filter({ hasText: 'Check the work' }).click();
  await page.mouse.move(0, 0);
  await expect.poll(fill).not.toBe(before);
  await expect(page.locator('#claim-anatomy .claim-statuses [aria-current]')).toHaveAttribute('data-status', 'unknown');
});
