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
  for (const attribute of ['href', 'src', 'content']) {
    const elements = attribute === 'content' ? document.querySelectorAll('meta[property="og:image"]') : document.querySelectorAll('[' + attribute + ']');
    for (const element of elements) {
      const value = element.getAttribute(attribute);
      if (value.startsWith('#')) { assert(document.getElementById(value.slice(1)), value); continue; }
      const path = value.startsWith('https://artyfact.ing/') ? value.slice('https://artyfact.ing'.length) : value;
      if (!path.startsWith('/')) continue;
      let file = resolve(dist, '.' + path);
      if (routes.includes(path)) file = resolve(file, 'index.html');
      assert((await stat(file)).isFile(), file);
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
