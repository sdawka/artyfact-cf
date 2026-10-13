import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { serveDist, revealStory } from './serve';
test.beforeEach(({ page }) => serveDist(page));
test('homepage leads to the guide and links the hosted platform', async ({ page }) => {
  await page.goto('https://artyfact.test/');
  await revealStory(page);
  await expect(page.getByRole('heading', { name: /^Make Meaningful Systems$/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the platform' })).toHaveAttribute('href', 'https://artyfact-platform.dawka.workers.dev');
  await expect(page.locator('a[href="/app"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Bring your agent', exact: true }).first().click();
  await expect(page).toHaveURL('https://artyfact.test/connect-agent');
  await expect(page.locator('code').filter({ hasText: 'ARTYFACT_SECRET' }).first()).toBeVisible();
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
  await expect(page.getByRole('heading', { name: /Ontology Driven Development/ })).toBeVisible();
  await expect(page.getByText(/A Thing can begin with its Genome alone/)).toBeVisible();
  await expect(page.locator('.model-view-panels > section')).toHaveCount(3);
  for(const panel of await page.locator('.model-view-panels > section').all()) await expect(panel).toBeVisible();
  await expect(page.getByText('Acceptance check',{exact:true})).toBeVisible();
  await expect(page.getByRole('list',{name:'Illustrative reader observations'})).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://artyfact.ing/model');
});
const scene = '[data-system-view]';
const mounted = (page: Page) => expect(page.locator('[data-ambient] [data-effect="ambient"]')).toHaveAttribute('data-effect-mode', /^(gl|fallback)$/, { timeout: 15000 });
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
test('System illustration stays usable through all views and explicit composition', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('https://artyfact.test/');
  await revealStory(page);
  await mounted(page);
  await expect(page.locator('[data-hero-orb]')).toHaveCount(0);
  await expect(page.locator(scene)).toHaveAttribute('data-system-view', 'genome');
  await page.getByRole('tab', { name: /Phenome/ }).click();
  await expect(page.locator(scene)).toHaveAttribute('data-system-view', 'phenome');
  await expect(page.getByRole('img', { name: /^Ideas explored:/ })).toBeVisible();
  await page.getByRole('button', { name: 'Part: Component system' }).click();
  await page.getByText('Composition + provenance', { exact: true }).click();
  await expect(page.locator('.scene-selected-detail')).toContainText('caller adapter');
  await expect(page.getByText('Outcome evidence: unmeasured.')).toBeVisible();
  await page.getByRole('tab', { name: /Genome/ }).click();
  await expect(page.locator(scene)).toHaveAttribute('data-system-view', 'genome');
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('effects and the scene respect reduced motion and ordinary flow', async ({ page }) => {
  const errors = watchErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('https://artyfact.test/');
  await revealStory(page);
  await mounted(page);
  await page.getByRole('tab', { name: /Proteome/ }).click();
  await expect(page.locator(scene)).toHaveAttribute('data-system-view', 'proteome');
  await expect(page.locator(scene)).toHaveAttribute('data-sticky', 'false');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.scene-application')!).transitionDuration)).toMatch(/^(0s|1e-05s|0.00001s)$/);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.workflow-list li')!, '::before').animationName)).toBe('none');
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
  for (const view of path === '/' ? ['Genome', 'Proteome', 'Phenome'] : [null]) {
    if (view) await page.getByRole('tab', { name: new RegExp(view) }).click();
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

test('model jump links remain usable on a narrow screen with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('https://artyfact.test/model');
  const navigation = page.getByRole('navigation', { name: 'On this page' });
  await navigation.getByRole('link', { name: 'Artyfact’s meta ontology' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#meta-ontology$/);
  await expect(page.locator('#meta-ontology')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Artyfact’s meta ontology', exact: true })).toBeInViewport();
  await navigation.getByRole('link', { name: 'Why a semantic layer' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#benefits$/);
  await expect(page.locator('#benefits')).toBeFocused();
  await page.locator('.model-benefits-grid summary').filter({ hasText: 'Reuse context' }).click();
  await expect(page.getByText(/Carry relevant context into each task or agent session/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
