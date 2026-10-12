import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Site, pages, type PagePath } from './pages';
import { platformLink, sourceLink } from './config';
const origin = 'https://artyfact.ing';
const config = {
  platform: platformLink({ ready: process.env.SITE_PLATFORM_READY === 'true', url: process.env.SITE_PLATFORM_URL || '/app' }),
  source: sourceLink(process.env.SITE_SOURCE_URL || ''),
};
if (process.env.SITE_PLATFORM_READY === 'true' && !config.platform) throw new Error('Invalid public platform URL');
if (process.env.SITE_SOURCE_URL && !config.source) throw new Error('Invalid public source URL');
const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'));
const entry = manifest['src/client.tsx'];
for (const [path, meta] of Object.entries(pages)) {
  const content = renderToStaticMarkup(<Site path={path as PagePath} config={config} />);
  const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#19151f">' +
    '<title>' + meta.title + '</title><meta name="description" content="' + meta.description + '">' +
    '<link rel="canonical" href="' + origin + path + '"><link rel="icon" href="/favicon.svg" type="image/svg+xml">' +
    '<meta property="og:title" content="' + meta.title + '"><meta property="og:description" content="' + meta.description + '">' +
    '<meta property="og:type" content="website"><meta property="og:url" content="' + origin + path + '"><meta property="og:image" content="' + origin + '/social.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Artyfact. Author systems together.">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    (entry.css || []).map((css: string) => '<link rel="stylesheet" href="/' + css + '">').join('');
  const html = '<!doctype html><html lang="en"><head>' + head + '</head><body>' + content +
    '<noscript><p class="no-script">The example shows its initial model. Enable JavaScript to switch layers or use the copy buttons.</p></noscript>' +
    '<script type="module" src="/' + entry.file + '"></script></body></html>';
  const directory = 'dist' + (path === '/' ? '' : path);
  mkdirSync(directory, { recursive: true }); writeFileSync(directory + '/index.html', html);
}
writeFileSync('dist/404.html', '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found — Artyfact</title><body><main><h1>Page not found</h1><p><a href="/">Return to Artyfact</a> or <a href="/connect-agent">read the agent guide</a>.</p></main></body></html>');
writeFileSync('dist/sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + Object.keys(pages).map(path => '<url><loc>' + origin + path + '</loc></url>').join('') + '</urlset>');
writeFileSync('dist/robots.txt', 'User-agent: *\nAllow: /\nDisallow: /app/\nSitemap: ' + origin + '/sitemap.xml\n');
