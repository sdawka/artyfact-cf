import { test, expect } from '@playwright/test';
import { serveDist } from './serve';
// Machines without a usable GPU get WebGL through SwiftShader, which runs the orb at a few frames per second on the
// main thread. The effects must detect that and keep their CSS fallbacks so the explorer stays responsive.
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'] } });
test.beforeEach(({ page }) => serveDist(page));
test('software WebGL keeps CSS fallbacks and a responsive explorer', async ({ page }) => {
  await page.goto('https://artyfact.test/');
  await expect(page.locator('[data-hero-orb] [data-effect="orb"]')).toHaveAttribute('data-effect-mode', 'fallback', { timeout: 15000 });
  await expect(page.locator('[data-ambient] [data-effect="ambient"]')).toHaveAttribute('data-effect-mode', 'fallback');
  await page.getByRole('button', { name: /Wanted contact/ }).click({ timeout: 3000 });
  await expect(page.locator('[data-hero-orb]')).toHaveAttribute('data-orb-facet', 'purpose');
});
