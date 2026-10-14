// Renders public/social.png (1200x630) from scripts/social-card.html: node scripts/social-card.mjs
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const here = new URL('.', import.meta.url);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(new URL('social-card.html', here).href);
await page.screenshot({ path: fileURLToPath(new URL('../public/social.png', here)) });
await browser.close();
