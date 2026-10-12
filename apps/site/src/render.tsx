import React from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Site, pages, notFoundPage, type PagePath } from './pages';
import { SystemExplorer } from './SystemExplorer';
import { resolveSiteConfig } from './config';
const origin = 'https://artyfact.ing';
const config = resolveSiteConfig(process.env);
const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'));
const entry = manifest['src/client.tsx'];
// The page shell is static markup. The explorer is rendered with renderToString instead, so its
// text-node separators match what hydrateRoot expects on the client.
const explorerHtml = renderToString(<SystemExplorer />);

function document(meta: { title: string; description: string }, path: PagePath | '/404') {
  const content = renderToStaticMarkup(<Site path={path} config={config} explorerHtml={explorerHtml} />);
  const title = escapeAttr(meta.title), description = escapeAttr(meta.description);
  const indexed = path !== '/404';
  const hasExplorer = content.includes('data-system-explorer');
  const hasCopy = content.includes('data-copy');
  const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#19151f">' +
    '<title>' + title + '</title><meta name="description" content="' + description + '">' +
    (indexed
      ? '<link rel="canonical" href="' + escapeAttr(origin + path) + '">'
      : '<meta name="robots" content="noindex">') +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">' +
    '<meta property="og:title" content="' + title + '"><meta property="og:description" content="' + description + '">' +
    '<meta property="og:type" content="website">' + (indexed ? '<meta property="og:url" content="' + escapeAttr(origin + path) + '">' : '') +
    '<meta property="og:image" content="' + origin + '/social.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Artyfact. Author systems together.">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    (entry.css || []).map((css: string) => '<link rel="stylesheet" href="/' + escapeAttr(css) + '">').join('');
  const needs = [hasExplorer && 'switch layers', hasCopy && 'use the copy buttons'].filter(Boolean).join(' or ');
  const noscript = needs
    ? '<noscript><p class="no-script">' + (hasExplorer ? 'The example shows its initial model. ' : '') + 'Enable JavaScript to ' + needs + '.</p></noscript>'
    : '';
  const script = needs ? '<script type="module" src="/' + escapeAttr(entry.file) + '"></script>' : '';
  return '<!doctype html><html lang="en"><head>' + head + '</head><body>' + content + noscript + script + '</body></html>';
}

for (const [path, meta] of Object.entries(pages)) {
  const directory = 'dist' + (path === '/' ? '' : path);
  mkdirSync(directory, { recursive: true }); writeFileSync(directory + '/index.html', document(meta, path as PagePath));
}
writeFileSync('dist/404.html', document(notFoundPage, '/404'));
writeFileSync('dist/sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + Object.keys(pages).map(path => '<url><loc>' + origin + path + '</loc></url>').join('') + '</urlset>');
writeFileSync('dist/robots.txt', 'User-agent: *\nAllow: /\nDisallow: /app/\nSitemap: ' + origin + '/sitemap.xml\n');
