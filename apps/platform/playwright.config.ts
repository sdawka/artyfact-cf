import { defineConfig, devices } from "@playwright/test";

/**
 * Fixture mode (default): `vite preview` of the static SPA built by `vite.fixture.config.ts` (no Cloudflare plugin, no login). The API 404s, so the SPA falls back
 * to its bundled fixture. Live mode (`ARTYFACT_E2E_LIVE=1`): `wrangler dev` serves the SPA built by `npm run build` and the Worker API together; specs tagged `@live` run only there, specs tagged `@fixture`
 * only in fixture mode.
 */
const live = process.env.ARTYFACT_E2E_LIVE === "1";
// ARTYFACT_E2E_PORT picks another port when the default is taken (e.g. by a parallel checkout, whose server would be reused).
const port = Number(process.env.ARTYFACT_E2E_PORT) || (live ? 8787 : 1338);
// ARTYFACT_E2E_NO_GPU=1 forces software WebGL (SwiftShader), as on GitHub runners, so GPU-only passes cannot hide.
const launchArgs = process.env.ARTYFACT_E2E_NO_GPU === "1" ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"] : [];
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions: { args: launchArgs } } }],
  webServer: {
    command: live
      ? `npx wrangler dev --port ${port}`
      : `npx vite preview --config vite.fixture.config.ts --port ${port} --strictPort`,
    url: baseURL,
    env: live ? {} : { ARTYFACT_E2E_FIXTURE: "1" },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
