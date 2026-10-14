import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
const dist = resolve(import.meta.dirname, '../dist');
const routes = ['/', '/model', '/connect-agent'];
for (const route of routes) test('built page and destinations: ' + route, async () => {
  const html = await readFile(resolve(dist, '.' + route, 'index.html'), 'utf8');
  const document = new JSDOM(html).window.document;
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.querySelectorAll('h1').length, 1);
  assert.equal(document.querySelector('link[rel="canonical"]').href, 'https://artyfact.ing' + route);
  assert(document.querySelector('meta[name="description"]').content.length > 30);
  assert(!html.includes('AGPL'));
  assert(!document.querySelector('a[href="/app"]'));
  const headings = [...document.querySelectorAll('h1,h2,h3,h4')].map(h => Number(h.tagName[1]));
  headings.forEach((level, index) => assert(index === 0 ? level === 1 : level <= headings[index - 1] + 1, 'heading order: ' + headings.join(',')));
  for (const attribute of ['href', 'src', 'content']) {
    const elements = attribute === 'content' ? document.querySelectorAll('meta[property="og:image"]') : document.querySelectorAll('[' + attribute + ']');
    for (const element of elements) {
      const value = element.getAttribute(attribute);
      if (value.startsWith('#')) { assert(document.getElementById(value.slice(1)), value); continue; }
      const destination = value.startsWith('https://artyfact.ing/') ? value.slice('https://artyfact.ing'.length) : value;
      const [path, fragment] = destination.split('#');
      if (!path.startsWith('/')) continue;
      let file = resolve(dist, '.' + path);
      if (routes.includes(path)) file = resolve(file, 'index.html');
      assert((await stat(file)).isFile(), file);
      if (fragment) assert(new JSDOM(await readFile(file, 'utf8')).window.document.getElementById(fragment), value);
    }
  }
});
test('sitemap contains public pages only', async () => {
  const xml = await readFile(resolve(dist, 'sitemap.xml'), 'utf8');
  assert.equal((xml.match(/<loc>/g) || []).length, 3);
  assert(!xml.includes('/app'));
});
test('documented CLI setup remains usable from the realization directory', async () => {
  const html = await readFile(resolve(dist, 'connect-agent/index.html'), 'utf8');
  const document = new JSDOM(html).window.document;
  const setup = document.getElementById('install-code').textContent.split('\n').find(line => line.startsWith('export PATH='));
  assert(setup, 'The guide must make the local CLI available before entering a fork');
  const fork = await mkdtemp(resolve(tmpdir(), 'artyfact-site-guide-'));
  try {
    const help = execFileSync('bash', ['-c', setup + '\ncd "$1"\nartyfact --help', 'guide-check', fork], {
      cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8', timeout: 10000,
    });
    assert(help.includes('checkpoint'));
    assert(help.includes('submit'));
  } finally { await rm(fork, { recursive: true, force: true }); }
});
test('404 page uses the site layout, is not indexed, and stays out of the sitemap', async () => {
  const html = await readFile(resolve(dist, '404.html'), 'utf8');
  const document = new JSDOM(html).window.document;
  assert(document.querySelector('link[rel="stylesheet"]'));
  assert(document.querySelector('meta[name="theme-color"]'));
  assert(document.querySelector('meta[name="robots"][content="noindex"]'));
  assert(document.querySelector('header nav') && document.querySelector('footer'));
  assert(!(await readFile(resolve(dist, 'sitemap.xml'), 'utf8')).includes('404'));
});
test('noscript copy only mentions features the page has', async () => {
  const note = async route => new JSDOM(await readFile(resolve(dist, '.' + route, 'index.html'), 'utf8')).window.document.querySelector('noscript')?.textContent ?? '';
  assert(/All three example views are readable/.test(await note('/model')));
  assert(!/copy buttons/.test(await note('/model')));
  assert(/copy buttons/.test(await note('/connect-agent')));
  assert(!/example shows/.test(await note('/connect-agent')));
});
test('the guide names the hosted origin and the verified local CLI discovery order', async () => {
  const html = await readFile(resolve(dist, 'connect-agent/index.html'), 'utf8');
  assert(html.includes('https://artyfact-platform.dawka.workers.dev'));
  const discovery = html.slice(html.indexOf('The CLI uses'));
  assert(discovery.indexOf('--platform') < discovery.indexOf('ARTYFACT_PLATFORM') && discovery.indexOf('ARTYFACT_PLATFORM') < discovery.indexOf('ARTYFACT_URL'));
  assert(html.includes('localhost:1337') && html.includes('localhost:1346') && !html.includes('5173'));
  assert(!html.includes('CLI defaults to'));
  assert(html.includes('https://github.com/sdawka/artyfact-cf'));
});
test('effects stay off the critical path and out of the static markup', async () => {
  const html = await readFile(resolve(dist, 'index.html'), 'utf8');
  const document = new JSDOM(html).window.document;
  assert(!document.querySelector('[data-hero-orb]'));
  assert(document.querySelector('[data-landing-story] .checkout-story[data-step="0"]'));
  assert.equal(document.querySelectorAll('[data-checkout-step]').length, 7);
  assert(document.querySelector('[data-ambient]')?.children.length === 0);
  assert(!document.querySelector('canvas'));
  assert.equal(document.querySelectorAll('script').length, 1);
  assert(!/effects-|engine-|modulepreload/.test(html), 'effects must load after hydration, not from the page head');
});

test('the initial stylesheet includes the checkout scene before hydration', async () => {
  const document = new JSDOM(await readFile(resolve(dist, 'index.html'), 'utf8')).window.document;
  const css = await Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].map(link => readFile(resolve(dist, '.' + link.getAttribute('href')), 'utf8')));
  assert(css.some(text => text.includes('.checkout-scene') && text.includes('.practice-card')), 'Home styles must be in initial CSS, not a lazy hydration chunk');
});

test('homepage leads with the approved headline and readable struck-through practices', async () => {
  const document = new JSDOM(await readFile(resolve(dist, 'index.html'), 'utf8')).window.document;
  assert.equal(document.querySelector('h1').textContent, 'The next Git platform keeps track of the product, not just the files.');
  assert(document.body.textContent.includes('A Git platform for teams of AI agents, on Cloudflare.'));
  const struck = [...document.querySelectorAll('.practice-card s')].map(s => s.textContent);
  assert(struck.length >= 20 && struck.includes('merge conflicts') && struck.includes('spec.md and spec-driven development'));
  assert(!/A\/B|cohort|\bSLOs?\b|incident/i.test(document.querySelector('.practice-stack').textContent));
  assert(document.querySelector('.checkout-step-buttons')?.hasAttribute('hidden'), 'Step buttons stay hidden until hydration');
  assert(document.body.textContent.includes('Outcome: not measured yet'));
  assert(/All seven example steps are readable/.test(document.querySelector('noscript')?.textContent ?? ''));
  assert(!document.querySelector('button button'));
});
