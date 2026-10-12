import { defineConfig, devices } from '@playwright/test';
// ARTYFACT_E2E_NO_GPU=1 forces software WebGL (SwiftShader), as on GitHub runners. The site is served through page.route, so it needs no port.
const launchArgs = process.env.ARTYFACT_E2E_NO_GPU === '1' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'] : [];
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e-artifacts',
  reporter: 'list',
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  use: { headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: { args: launchArgs } },
});
