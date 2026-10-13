import { test, expect, type Page } from '@playwright/test';
import { serveDist, revealStory } from './serve';
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
  await revealStory(page);
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
  await revealStory(page);
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
  await revealStory(page);
    await page.getByRole('tab', { name: /Genome/ }).focus();
    await expect(page.locator(scene)).toHaveAttribute('data-scroll-mode', /following|manual|static/);
    for (const view of ['Genome', 'Proteome', 'Phenome']) {
      await page.getByRole('tab', { name: new RegExp(view) }).click();
      await expect(page.locator(scene)).toHaveAttribute('data-system-view', view.toLowerCase());
      await page.waitForTimeout(550);
      await page.locator('.landing-sticky-stage').screenshot({ path: info.outputPath(`${width}x${height}-${view}.png`) });
      const geometry = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('[data-system-view]')!, r = document.querySelector('.landing-sticky-stage')!.getBoundingClientRect();
        const boundary = document.querySelector('.scene-system')!.getBoundingClientRect();
        const cards = [...document.querySelectorAll<HTMLElement>('.scene-application, .scene-runtime')].map(card => {
          const c = card.getBoundingClientRect();
          return { inside: c.left >= boundary.left && c.right <= boundary.right && c.top >= boundary.top && c.bottom <= boundary.bottom, fits: card.scrollWidth <= card.clientWidth + 1 };
        });
        return { overflow: document.documentElement.scrollWidth > innerWidth, pinned: root.dataset.sticky === 'true', fits: innerWidth > 950 ? r.height <= innerHeight - 48 : r.height <= innerHeight - 32 - 176, cards };
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
  expect(await page.locator('.scene-system').evaluate(element => parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThan(0);
  expect(await page.locator('.scene-board').evaluate(element => getComputedStyle(element).display)).toBe('grid');
  for (const title of ['Give the application its shape.', 'Make that shape tangible.', 'See what happens when it functions.']) await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByText('Composition + provenance', { exact: true }).click();
  await expect(page.locator('.scene-selected-detail details')).toHaveAttribute('open', '');
  await page.locator('.landing-sticky-stage').screenshot({ path: info.outputPath('no-js.png') });
  await context.close();
});

test('forced colors retain visible selected views and subjects', async ({ page }, info) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('https://artyfact.test/');
  await revealStory(page);
  const tab = page.getByRole('tab', { name: /Phenome/ });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  expect(await tab.evaluate(element => getComputedStyle(element).outlineWidth)).toBe('2px');
  const app = page.getByRole('button', { name: 'Inspect Artyfact application' });
  await expect(app).toHaveAttribute('aria-pressed', 'true');
  const selectedOutline = await app.evaluate(element => { const style = getComputedStyle(element); return { width: parseFloat(style.outlineWidth), style: style.outlineStyle }; });
  expect(selectedOutline.width).toBeGreaterThanOrEqual(1);
  expect(selectedOutline.style).toBe('solid');
  await page.locator('.landing-sticky-stage').screenshot({ path: info.outputPath('forced-colors.png') });
});

test('Phenome hands over after six saves, celebrates once, and preserves local progress', async ({ page }, info) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await page.goto('https://artyfact.test/');
  await revealStory(page);
  await page.getByRole('tab', { name: /Phenome/ }).click();
  const chart = page.getByRole('img', { name: /^Ideas explored:/ });
  await expect(chart).toHaveAttribute('aria-label', /^Ideas explored: 6\./, { timeout: 10000 });
  const save = page.getByRole('button', { name: 'Randomize', exact: true });
  for (let i = 0; i < 6; i++) await save.click();
  await expect(page.getByRole('status')).toHaveText('Great energy!');
  await expect(chart).toHaveAttribute('aria-label', /^Ideas explored: 12\./);
  await expect(page.locator('[data-scene-confetti] i')).toHaveCount(18);
  await page.locator('.landing-sticky-stage').screenshot({ path: info.outputPath('phenome-celebration.png') });
  await expect(page.locator('[data-scene-confetti]')).toHaveCount(0);
  await save.click();
  await expect(chart).toHaveAttribute('aria-label', /^Ideas explored: 13\./);
  await expect(page.locator('[data-chart-level]')).toHaveAttribute('data-chart-level', '12');
  await page.getByRole('tab', { name: /Genome/ }).click();
  await page.getByRole('tab', { name: /Phenome/ }).click();
  await expect(chart).toHaveAttribute('aria-label', /^Ideas explored: 13\./);
  await expect(page.getByRole('status')).toHaveCount(0);
  await save.click();
  await expect(chart).toHaveAttribute('aria-label', /^Ideas explored: 14\./);
  await expect(page.locator('[data-scene-confetti]')).toHaveCount(0);
  expect(writes).toEqual([]);
});
test('keyboard Save remains visible when the scroll narrative changes', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Native pinned desktop story');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('https://artyfact.test/');
  await revealStory(page);
  await page.getByRole('tab', { name: /Phenome/ }).click();
  await page.keyboard.press('Tab');
  const save = page.getByRole('button', { name: 'Randomize', exact: true });
  await save.focus();
  const chart = page.getByRole('img', { name: /^Ideas explored:/ });
  const before = Number((await chart.getAttribute('aria-label'))!.match(/explored: (\d+)/)![1]);
  await narrative(page, 'proteome');
  await expect(page.locator(scene)).toHaveAttribute('data-system-view', 'phenome');
  await expect(save).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(chart).toHaveAttribute('aria-label', new RegExp('^Ideas explored: ' + (before + 1) + '\\.'));
  await page.getByRole('link', { name: 'Bring your agent', exact: true }).first().focus();
  await narrative(page, 'proteome');
  await expect(page.locator(scene)).toHaveAttribute('data-system-view', 'proteome');
});

test('initial enhanced scene contains only the accepted name and purpose', async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'desktop' ? { width:1440, height:900 } : { width:320, height:568 });
  await page.goto('https://artyfact.test/');
  await expect(page.locator(scene)).toHaveAttribute('data-enhanced', 'true');
  expect(await page.locator(scene).evaluate(root => root.style.getPropertyValue('--opening-progress'))).toBe('0');
  await expect(page.getByText('Turn ideas into meaningful systems.', { exact:true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.screenshot({ path:info.outputPath('opening.png') });
});
test('scrub reverses mid-realization and sticky visual stays with each narrative', async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'desktop' ? { width:1440, height:900 } : { width:320, height:568 });
  await page.goto('https://artyfact.test/');
  await expect(page.locator(scene)).toHaveAttribute('data-enhanced','true');
  const stops = await page.evaluate(() => {
    const a = document.querySelector('[data-story-step="genome"]')!.getBoundingClientRect().top + scrollY;
    const b = document.querySelector('[data-story-step="proteome"]')!.getBoundingClientRect().top + scrollY;
    const stage = document.querySelector('.landing-sticky-stage')!.getBoundingClientRect();
    const line = innerWidth > 950 ? innerHeight * .5 : 16 + stage.height + (innerHeight - 16 - stage.height) * .5;
    return { half:(a+b)/2-line, quarter:a+(b-a)*.25-line };
  });
  await page.evaluate(y => scrollTo(0,y),stops.half);
  await expect.poll(async () => Number(await page.locator(scene).evaluate(root => root.style.getPropertyValue('--realization-progress')))).toBeCloseTo(.5,1);
  const forward = await page.locator('.landing-sticky-stage').boundingBox();
  await page.evaluate(y => scrollTo(0,y),stops.quarter);
  await expect.poll(async () => Number(await page.locator(scene).evaluate(root => root.style.getPropertyValue('--realization-progress')))).toBeCloseTo(.25,1);
  const reverse = await page.locator('.landing-sticky-stage').boundingBox();
  expect(forward!.y).toBeGreaterThanOrEqual(0); expect(reverse!.y).toBeGreaterThanOrEqual(forward!.y - 1);
  for (const view of ['genome','proteome','phenome']) {
    await narrative(page,view);
    const box = await page.locator('.landing-sticky-stage').boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y+box!.height).toBeLessThanOrEqual(info.project.name==='desktop'?900:568);
  }
  await page.screenshot({ path:info.outputPath('scrubbed-phenome.png') });
});
test('keyboard Resume runs the finite demo without moving focus', async ({ page }) => {
  await page.goto('https://artyfact.test/'); await revealStory(page);
  await page.getByRole('tab',{name:/Phenome/}).click();
  await page.getByRole('button',{name:'Pause demo',exact:true}).click();
  const resume=page.getByRole('button',{name:'Resume demo',exact:true});
  await page.keyboard.press('Tab'); await resume.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('img',{name:/^Ideas explored:/})).toHaveAttribute('aria-label',/^Ideas explored: 6\./,{timeout:10000});
  await expect(page.locator('[data-demo-resume]')).toBeFocused();
});
test('the first fully visible mobile scene still presents the complete opening', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile','Mobile viewport entrance');
  await page.setViewportSize({width:320,height:568}); await page.goto('https://artyfact.test/');
  await expect(page.locator(scene)).toHaveAttribute('data-enhanced','true');
  await page.evaluate(() => { const r=document.querySelector('.landing-sticky-stage')!.getBoundingClientRect(); scrollTo({top:scrollY+r.top-(innerHeight-r.height-16),behavior:'instant'}); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
  await expect.poll(async () => Number(await page.locator(scene).evaluate(root=>root.style.getPropertyValue('--opening-progress')))).toBe(0);
  await expect(page.getByText('Turn ideas into meaningful systems.',{exact:true})).toBeVisible();
  const bounds = await page.locator('.landing-sticky-stage').boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(568);
  await page.screenshot({path:info.outputPath('mobile-first-visible-opening.png')});
});
test('native Phenome arrival completes six ideas while its button remains visible', async ({ page },info) => {
  await page.setViewportSize(info.project.name==='desktop'?{width:1440,height:900}:{width:320,height:568});
  await page.goto('https://artyfact.test/'); await expect(page.locator(scene)).toHaveAttribute('data-enhanced','true');
  await narrative(page,'phenome'); await expect(page.locator(scene)).toHaveAttribute('data-phenome-settled','true');
  await expect(page.getByRole('button',{name:'Randomize',exact:true})).toBeVisible();
  const arrivalY = await page.evaluate(() => scrollY);
  await expect(page.getByRole('img',{name:/^Ideas explored:/})).toHaveAttribute('aria-label',/^Ideas explored: 6\./,{timeout:12000});
  await expect(page.getByRole('button',{name:'Auto demo complete',exact:true})).toHaveAttribute('aria-disabled','true');
  expect(Math.abs(await page.evaluate(() => scrollY) - arrivalY)).toBeLessThanOrEqual(1);
  await expect(page.locator(scene)).toHaveAttribute('data-system-view','phenome');
  const footprint = await page.locator('.scene-recent-ideas').evaluate(element=>element.getBoundingClientRect().height);
  await page.getByRole('tab',{name:/Genome/}).click();
  expect(await page.locator('.scene-recent-ideas').evaluate(element=>element.getBoundingClientRect().height)).toBe(footprint);
  await page.getByRole('tab',{name:/Phenome/}).click();
  await expect(page.getByRole('img',{name:/^Ideas explored:/})).toHaveAttribute('aria-label',/^Ideas explored: 6\./);
});
