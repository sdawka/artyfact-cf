import { defineConfig, devices } from "@playwright/test";

/**
 * Fixture mode (default): `vite preview` of the static SPA built by `vite.fixture.config.ts` (no Cloudflare plugin, no login). The API 404s, so the SPA falls back
 * to its bundled fixture. Live mode (`ARTYFACT_E2E_LIVE=1`): `wrangler dev` serves the SPA built by `npm run build` and the Worker API together; specs tagged `@live` run only there, specs tagged `@fixture`
 * only in fixture mode. Fake mode (`ARTYFACT_E2E_FAKE=1`): `vite` boots the Worker with `FAKE_ARTIFACTS=1` (in-memory Artifacts seeded from `examples/*`)
 * and `ADMIN_TOKEN=test`; only specs tagged `@fake` run there, one at a time because they share one in-memory platform. A second server
 * (port + 1, `FAKE_SEED=artyfact`) serves the self-model specs, so Artyfact's own Genome is exercised too.
 */
const live = process.env.ARTYFACT_E2E_LIVE === "1";
const fake = process.env.ARTYFACT_E2E_FAKE === "1";
// ARTYFACT_E2E_PORT picks another port when the default is taken (e.g. by a parallel checkout, whose server would be reused).
const port = Number(process.env.ARTYFACT_E2E_PORT) || (live ? 8787 : fake ? 1339 : 1338);
// ARTYFACT_E2E_NO_GPU=1 forces software WebGL (SwiftShader), as on GitHub runners, so GPU-only passes cannot hide.
const launchArgs = process.env.ARTYFACT_E2E_NO_GPU === "1" ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"] : [];
const chromium = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions: { args: launchArgs } };
const baseURL = `http://localhost:${port}`;
const selfURL = `http://localhost:${port + 1}`;
const selfSpec = /self-model\.fake\.spec/;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e-artifacts/results",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: !fake,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: fake ? 1 : process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "e2e-artifacts/report" }]] : "list",
  grep: fake ? /@fake/ : live ? /^(?!.*@(fixture|fake))/ : /^(?!.*@(live|fake))/,
  use: { baseURL, trace: "retain-on-failure", viewport: { width: 1440, height: 900 } },
  projects: fake
    ? [
        // Home asserts the untouched System, so it runs first; the flows then change the shared platform.
        { name: "fake-home", testMatch: /home\.fake\.spec/, use: chromium },
        { name: "fake-flows", testIgnore: [/home\.fake\.spec/, selfSpec], dependencies: ["fake-home"], use: chromium },
        { name: "fake-self", testMatch: selfSpec, use: { ...chromium, baseURL: selfURL } },
      ]
    : [{ name: "chromium", use: chromium }],
  webServer: [
    {
      command: fake
        ? `npx vite --port ${port} --strictPort`
        : live
          ? `npx wrangler dev --port ${port}`
          : `npx vite preview --config vite.fixture.config.ts --port ${port} --strictPort`,
      url: baseURL,
      env: fake ? { FAKE_ARTIFACTS: "1", ADMIN_TOKEN: "test" } : live ? {} : { ARTYFACT_E2E_FIXTURE: "1" },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    ...(fake
      ? [{
          command: `npx vite --port ${port + 1} --strictPort`,
          url: selfURL,
          env: { FAKE_ARTIFACTS: "1", ADMIN_TOKEN: "test", FAKE_SEED: "artyfact" },
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        }]
      : []),
  ],
});
