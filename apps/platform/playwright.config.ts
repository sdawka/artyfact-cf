import { defineConfig, devices } from "@playwright/test";

/**
 * Fixture mode (default): `vite preview` of the built SPA. The API 404s, so the SPA falls back
 * to its bundled fixture. Live mode (`ARTYFACT_E2E_LIVE=1`): `wrangler dev` serves the built
 * SPA and the Worker API together; specs tagged `@live` run only there, specs tagged `@fixture`
 * only in fixture mode.
 */
const live = process.env.ARTYFACT_E2E_LIVE === "1";
const port = live ? 8787 : 4173;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e-artifacts/results",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "e2e-artifacts/report" }]] : "list",
  grep: live ? /^(?!.*@fixture)/ : /^(?!.*@live)/,
  use: { baseURL, trace: "retain-on-failure", viewport: { width: 1440, height: 900 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: live
      ? `npx wrangler dev --port ${port}`
      : `npx vite preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
