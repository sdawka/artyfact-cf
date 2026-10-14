import { test, expect } from '@playwright/test';
import { serveDist, revealStory } from './serve';
// Machines without a usable GPU get WebGL through SwiftShader, which would run GPU effects at a few frames per second on the
// main thread. The effects must detect that and keep their CSS fallbacks so the example stays responsive.
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'] } });
test.beforeEach(({ page }) => serveDist(page));
test('software WebGL keeps CSS fallbacks and a responsive explorer', async ({ page }) => {
  await page.goto('https://artyfact.test/');
  await revealStory(page);
  await expect(page.locator('[data-ambient] [data-effect="ambient"]')).toHaveAttribute('data-effect-mode', 'fallback', { timeout: 15000 });
  await page.getByRole('button', { name: 'Step 6: Deploy and observe' }).click({ timeout: 3000 });
  await expect(page.locator('.checkout-story')).toHaveAttribute('data-step', '5');
  await expect(page.locator('.checkout-deploy')).toHaveAttribute('data-phase', 'current');
});
