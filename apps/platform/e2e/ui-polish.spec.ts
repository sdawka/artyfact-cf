import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SYSTEM } from './helpers';
import { defaultMockData, mockApi } from './mockApi';

const routes = [ ['overview','Overview'], ['map','Map'], ['journeys','Journeys'], ['theory','Theory'], ['code','Code'], ['work','Work'], ['review','Review'], ['evaluations','Evaluations'], ['changelog','Changelog'], ['compare','Compare'], ['phenome','Deployments'], ['parts','System-private Parts'] ] as const;
const longName = 'Peopling — a deliberately long System name for keeping in touch across many communities and relationships';
const longRevision = 'Release — a deliberately long revision name documenting changes to the People screen and its supporting shared components';
async function populated(page: Page, long = false) {
  const data = defaultMockData();
  if (long) { data.systems[0]!.title = longName; (data.bundles['system.peopling']!.model as { system: { name: string } }).system.name = longName; data.revisions[1]!.label = longRevision; }
  await mockApi(page, data);
}
async function fits(locator: Locator, page: Page, vertical = true) {
  await expect(locator).toBeVisible();
  const viewport = page.viewportSize()!;
  // Entrance motion is intentional; test the settled geometry without a fixed sleep.
  await expect.poll(async () => { const r = await locator.boundingBox(); return !!r && r.x >= -1 && r.x + r.width <= viewport.width + 1 && (!vertical || (r.y >= -1 && r.y + r.height <= viewport.height + 1)); }, { message: 'settled bounds fit viewport' }).toBe(true);
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x, 'left edge fits viewport').toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, 'right edge fits viewport').toBeLessThanOrEqual(viewport.width + 1);
  if (vertical) { expect(box!.y).toBeGreaterThanOrEqual(-1); expect(box!.y + box!.height, 'bottom edge fits viewport').toBeLessThanOrEqual(viewport.height + 1); }
}
async function hitArea(control: Locator) {
  expect((await control.boundingBox())!.height, '44px hit target').toBeGreaterThanOrEqual(43.5);
}
async function axe(page: Page, selector: string, forcedColors = false) {
  // Axe measures authored colors; Chromium paints the forced system palette.
  // The forced-colors case checks Canvas/CanvasText directly below.
  const builder = new AxeBuilder({ page }).include(selector);
  if (forcedColors) builder.disableRules(['color-contrast']);
  const result = await builder.analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
}
const menu = (page: Page) => page.getByRole('dialog', { name: /Navigation|Menu/ });
async function openAdmin(page: Page) {
  await expect(page.getByRole('banner').first()).toBeVisible();
  const direct = page.getByRole('button', { name: 'Admin token', exact: true });
  const trigger = await direct.isVisible() ? direct : page.getByRole('button', { name: 'More', exact: true });
  await trigger.click();
  if (trigger !== direct) await page.getByRole('menuitem', { name: 'Admin token', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Admin token', exact: true })).toBeVisible();
  return trigger;
}

async function navigation(nav: Locator) {
  const boxes = await nav.getByRole('link').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { x:r.x, width:r.width, height:r.height }; }));
  expect(boxes.length).toBeGreaterThan(8);
  for (const box of boxes) { expect(box.height).toBeGreaterThanOrEqual(43.5); expect(Math.abs(box.x - boxes[0]!.x)).toBeLessThanOrEqual(1); expect(Math.abs(box.width - boxes[0]!.width)).toBeLessThanOrEqual(1); }
  for (const name of ['Overview','Journeys','Evaluations','Deployments','Private Parts']) {
    const label = nav.getByText(name, { exact:true }); await expect(label).toBeVisible();
    expect((await label.boundingBox())!.width, `${name} visibly labelled`).toBeGreaterThan(45);
  }
}

test.describe('application UI polish @fixture', () => {
  for (const width of [320,390,768]) test(`Menu is a labelled modal with complete navigation at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height:844 }); await populated(page); await page.goto(`${SYSTEM}/overview?layer=phenome`);
    const trigger = page.getByRole('button', { name:'Menu', exact:true }); await expect(trigger).toBeVisible(); await hitArea(trigger);
    await expect(page.getByRole('navigation', { name:'Views' })).toBeHidden(); await trigger.click();
    const dialog = menu(page); await expect(dialog).toBeVisible(); await expect(page.getByRole('main')).toHaveCount(0); await fits(dialog,page);
    const backdrop = await dialog.evaluate(el => getComputedStyle(el.previousElementSibling!).backgroundColor);
    expect(backdrop, 'modal has a visible backdrop').not.toBe('rgba(0, 0, 0, 0)');
    const nav = dialog.getByRole('navigation', { name:'Views' }); await navigation(nav); await axe(page,'[role="dialog"]');
    await page.screenshot({ path:info.outputPath(`menu-${width}.png`) });
    for (let i = 0; i < 20; i++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(el => el.contains(document.activeElement)), 'modal traps keyboard focus').toBe(true); }
    await nav.getByRole('link', { name:'Deployments', exact:true }).click(); await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/phenome\?.*layer=phenome/); await expect(page.getByRole('heading', { name:'Deployments', level:1 })).toBeVisible();
    await trigger.click(); await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
    await trigger.click(); await fits(dialog,page); const box = (await dialog.boundingBox())!;
    await page.mouse.click(box.x + box.width + 10 < width ? width - 2 : 2, 400);
    await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
  });

  test('desktop navigation has aligned full-width 44px rows', async ({ page }) => {
    await populated(page); await page.goto(`${SYSTEM}/overview`); await expect(page.getByRole('button', { name:'Menu', exact:true })).toBeHidden();
    await navigation(page.getByRole('navigation', { name:'Views' })); const header = page.locator('header').first();
    for (const control of await header.getByRole('button').all()) await hitArea(control);
    for (const control of await header.getByRole('combobox').all()) await hitArea(control);
  });

  for (const width of [320,390,768,1024,1440]) test(`Home and every workspace shell fit ${width}px with long labels`, async ({ page }, info) => {
    test.setTimeout(120_000); await page.setViewportSize({ width, height:844 }); await populated(page,true); await page.goto('/');
    await expect(page.getByRole('heading', { name:'Systems', level:1 })).toBeVisible(); await fits(page.locator('header').first(),page);
    const systems = page.getByRole('list', { name:'Systems' }); await expect(systems.getByText(longName,{ exact:true })).toBeVisible(); await expect(systems.getByText('not deployed, unknown')).toBeVisible();
    if ([390,1440].includes(width)) await page.screenshot({ path:info.outputPath(`home-${width}.png`),fullPage:true });
    for (const [route, heading] of routes) {
      await page.goto(`${SYSTEM}/${route}`); await expect(page.getByRole('heading', { name:heading, level:1 })).toBeVisible();
      const header = page.locator('header').first(); await fits(header,page);
      const controls = header.getByRole('button').or(header.getByRole('combobox'));
      const rects = [];
      for (const control of await controls.all()) { await fits(control,page); await hitArea(control); rects.push((await control.boundingBox())!); }
      for (let i=0;i<rects.length;i++) for (let j=i+1;j<rects.length;j++) { const a=rects[i]!, b=rects[j]!; expect(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>1 && Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>1, `${heading}: header controls do not overlap`).toBe(false); }
      for (const control of await header.getByRole('combobox').all()) expect(await control.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'selector label fits inside its trigger').toBe(true);
      await fits(header.getByText('canonical',{exact:true}),page);
      await fits(page.getByRole('main'),page,false); await fits(page.getByRole('heading', { name:heading, level:1 }),page,false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${heading} shell width`).toBe(true);
      if ([390,1440].includes(width) && ['overview','map'].includes(route)) await page.screenshot({ path:info.outputPath(`${route}-${width}.png`),fullPage:true });
      if (width < 1024) { await expect(page.getByRole('navigation', { name:'Views' })).toBeHidden(); await page.getByRole('button', { name:'Menu', exact:true }).click(); await fits(menu(page),page); await page.keyboard.press('Escape'); }
    }
  });

  test('Admin, revision dropdown and palette fit a short mobile viewport', async ({ page }, info) => {
    test.setTimeout(90_000);
    await populated(page,true);
    for (const [width,height] of [[1440,900],[390,360],[320,568]]) {
    await page.setViewportSize({ width:width!,height:height! }); await page.goto(`${SYSTEM}/overview`);
    const admin = await openAdmin(page); const token = page.getByRole('dialog', { name:'Admin token',exact:true });
    await fits(token,page); await expect(page.getByLabel('Token for admin actions')).toBeFocused(); await axe(page,'[role="dialog"]');
    await page.screenshot({ path:info.outputPath(`admin-${width}.png`) }); await page.keyboard.press('Escape'); await expect(admin).toBeFocused();
    await page.getByRole('combobox', { name:'Revision',exact:true }).click(); await fits(page.getByRole('listbox'),page);
    await page.screenshot({ path:info.outputPath(`select-${width}.png`) }); await page.keyboard.press('Escape');
    await page.getByRole('button', { name:/Go to…/ }).click(); await fits(page.getByRole('dialog', { name:'Go to node' }),page); await axe(page,'[role="dialog"]');
    await page.screenshot({ path:info.outputPath(`palette-${width}.png`) });
    await page.keyboard.press('Escape');
    }
  });

  test('Revision keyboard and typeahead preserve query state', async ({ page }) => {
    await populated(page,true); await page.goto(`${SYSTEM}/overview?layer=phenome&scope=environment&focus=screen.people`);
    const revision = page.getByRole('combobox', { name:'Revision',exact:true }); await revision.focus(); await page.keyboard.press('ArrowDown'); await expect(page.getByRole('listbox')).toBeVisible();
    await expect(page.getByRole('option',{name:'head',exact:true})).toBeFocused();
    await page.keyboard.type('Release'); await expect(page.getByRole('option',{name:longRevision,exact:true})).toBeFocused(); await page.keyboard.press('Enter'); await expect(page).toHaveURL(/\/r\/sc-2\/overview\?/);
    const url = new URL(page.url()); expect(url.searchParams.get('layer')).toBe('phenome'); expect(url.searchParams.get('scope')).toBe('environment'); expect(url.searchParams.get('focus')).toBe('screen.people');
    await expect(revision).toBeFocused(); await revision.click(); await page.keyboard.press('Home'); await expect(page.getByRole('option',{name:'head',exact:true})).toBeFocused(); await page.keyboard.press('Enter'); await expect(page).toHaveURL(/\/r\/head\/overview\?/);
  });

  test('Escape dismisses only the top overlay and preserves atlas Inspector underneath', async ({ page }) => {
    await populated(page); await page.goto(`${SYSTEM}/map?scope=environment&focus=screen.people&inspect=1`);
    const inspector = page.getByRole('complementary', { name:'Inspector',exact:true }); await expect(inspector).toBeVisible(); const before = page.url();
    const admin = page.getByRole('button', { name:/Admin token/ }); await admin.click(); await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name:'Admin token',exact:true })).toBeHidden(); await expect(admin).toBeFocused(); expect(page.url()).toBe(before); await expect(inspector).toBeVisible();
    await page.getByRole('combobox', { name:'Revision',exact:true }).click(); await page.keyboard.press('Escape'); await expect(page.getByRole('listbox')).toBeHidden(); expect(page.url()).toBe(before);
    await page.getByRole('button', { name:/Go to…/ }).click(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name:'Go to node' })).toBeHidden(); expect(page.url()).toBe(before); await expect(inspector).toBeVisible();
  });

  test('mobile Inspector closes to its Details trigger and preserves atlas selection', async ({ page }) => {
    await page.setViewportSize({width:390,height:844}); await populated(page);
    await page.goto(`${SYSTEM}/map?scope=environment&focus=screen.people`);
    const details = page.getByRole('complementary',{name:'Map selection'}).getByRole('button',{name:'Details',exact:true});
    await details.focus(); await details.click();
    const dialog = page.getByRole('dialog',{name:'Inspector',exact:true}); await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(details).toBeFocused();
    expect(new URL(page.url()).searchParams.get('focus')).toBe('screen.people');
    expect(new URL(page.url()).searchParams.has('inspect')).toBe(false);
    await details.click(); await page.getByRole('button',{name:'Close Inspector',exact:true}).click();
    await expect(dialog).toBeHidden(); await expect(details).toBeFocused();
  });

  test('Home and shared Part have consistent reachable header actions and bounded palettes', async ({ page }, info) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => localStorage.setItem('artyfact.effects','off'));
    await populated(page);
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:844});
      const dimensions:number[][] = [];
      for (const [path,heading] of [['/','Systems'],['/parts/part.ui.buttons/2.1.0','Button system']]) {
        await page.goto(path!); await expect(page.getByRole('heading', { name:heading!,level:1 })).toBeVisible();
        const header = page.locator('header').first(); await fits(header,page);
        const search = header.getByRole('button', { name:/Go to…/ }); await hitArea(search);
        const admin = await openAdmin(page); await hitArea(admin); await page.keyboard.press('Escape'); await expect(admin).toBeFocused();
        dimensions.push([(await header.boundingBox())!.height,(await admin.boundingBox())!.height,(await search.boundingBox())!.height]);
        await search.click(); const palette = page.getByRole('dialog', { name:'Go to a System or Part' });
        await fits(palette,page);
        await page.screenshot({path:info.outputPath(`${heading === 'Systems' ? 'home' : 'part'}-palette-${width}.png`)});
        await page.keyboard.press('Escape'); await expect(search).toBeFocused();
      }
      expect(dimensions[0]).toEqual(dimensions[1]);
    }
  });

  for (const preference of ['reduced motion','Effects off'] as const) test(`${preference} suppresses motion in portaled controls`, async ({ page }) => {
    await page.setViewportSize({ width:390,height:844 }); if (preference === 'reduced motion') await page.emulateMedia({ reducedMotion:'reduce' });
    await populated(page); await page.goto(`${SYSTEM}/overview`);
    if (preference === 'Effects off') { await page.getByRole('button', { name:'More',exact:true }).click(); const effects = page.getByRole('menuitemcheckbox', { name:'Effects',exact:true }); await expect(effects).toHaveAttribute('aria-checked','true'); await effects.click(); await page.getByRole('button',{name:'More',exact:true}).click(); await expect(effects).toHaveAttribute('aria-checked','false'); await page.keyboard.press('Escape'); }
    for (const action of [() => page.getByRole('button',{name:'Menu',exact:true}).click(), () => openAdmin(page), () => page.getByRole('combobox',{name:'Revision',exact:true}).click(), () => page.getByRole('button',{name:/Go to…/}).click()]) {
      await action();
      await expect(page.getByRole('dialog').or(page.getByRole('listbox')).first()).toBeVisible();
      const moving = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper], [data-state="open"][data-effects]')].flatMap(root => [root,...root.querySelectorAll('*')]).filter(el => {
        const css = getComputedStyle(el);
        return (css.animationName !== 'none' && css.animationDuration.split(',').some(n => parseFloat(n)>0.01)) || (css.transitionProperty.split(',').some(p => /^(all|transform|translate|scale|opacity|height|width)$/.test(p.trim())) && css.transitionDuration.split(',').some(n => parseFloat(n)>0.01));
      }).map(el => `${el.tagName}: ${el.getAttribute('role')??''}`));
      expect(moving,'portal motion respects preference').toEqual([]); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog').or(page.getByRole('listbox'))).toHaveCount(0);
    }
  });

  test('forced colors preserve labelled navigation and usable dialogs', async ({ page },info) => {
    await page.setViewportSize({width:390,height:844}); await page.emulateMedia({forcedColors:'active'}); await populated(page); await page.goto(`${SYSTEM}/overview`);
    await page.getByRole('button',{name:'Menu',exact:true}).click(); const dialog = menu(page); await expect(dialog.getByRole('link',{name:'Overview',exact:true})).toHaveAttribute('aria-current','page');
    await navigation(dialog.getByRole('navigation',{name:'Views'}));
    const colors = await dialog.evaluate(el => { const probe = document.createElement('span'); probe.style.color='CanvasText'; probe.style.backgroundColor='Canvas'; document.body.append(probe); const expected=getComputedStyle(probe); const result={ text:getComputedStyle(el.querySelector('p')!).color, canvasText:expected.color, background:getComputedStyle(el).backgroundColor, canvas:expected.backgroundColor }; probe.remove(); return result; });
    await info.attach('forced-colors-computed',{body:JSON.stringify(colors),contentType:'application/json'});
    await page.screenshot({path:info.outputPath('forced-colors-menu.png')});
    expect(colors.text).toBe(colors.canvasText); expect(colors.background).toBe(colors.canvas);
    const current = dialog.getByRole('link',{name:'Overview',exact:true});
    expect(await current.evaluate(el => { const css=getComputedStyle(el); return (css.outlineStyle!=='none' && parseFloat(css.outlineWidth)>0) || (css.borderTopStyle!=='none' && parseFloat(css.borderTopWidth)>0) || Number(css.fontWeight)>=600; }), 'forced colors retain a visible selected-view cue').toBe(true);
    await axe(page,'[role="dialog"]',true); await page.keyboard.press('Escape');
    await openAdmin(page); await expect(page.getByLabel('Token for admin actions')).toBeFocused(); await fits(page.getByRole('dialog',{name:'Admin token',exact:true}),page); await axe(page,'[role="dialog"]',true);
    await page.screenshot({path:info.outputPath('forced-colors-portals.png')});
  });
});
