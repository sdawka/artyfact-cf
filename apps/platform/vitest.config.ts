import { fileURLToPath, URL } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

// Worker code runs in workerd, UI/theme tests in jsdom, the opt-in integration loop in Node.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.test.jsonc" },
            // Test-only secret/var values (the real ones live in .dev.vars / Cloudflare secrets).
            // Provider and preview vars are pinned off so a developer's .dev.vars (FAKE_S1=1, ALLOW_LOCAL_PREVIEW=1) never leaks in.
            miniflare: {
              bindings: {
                ADMIN_TOKEN: "test-admin-token", ACCOUNT_ID: "test-account",
                FAKE_S1: "", TYPESAFE_API_KEY: "", OPENROUTER_API_KEY: "", ALLOW_LOCAL_PREVIEW: "", PREVIEW_HOST_ALLOWLIST: "",
              },
            },
          }),
        ],
        resolve: { alias },
        test: { name: "worker", include: ["test/**/*.test.ts"], exclude: ["test/integration/**"], testTimeout: 30_000 },
      },
      {
        resolve: { alias },
        test: { name: "ui", environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
      },
      // Real Artifacts (namespace artyfact-test); skipped unless ARTYFACT_INTEGRATION=1. See test/integration/loop.test.ts.
      { test: { name: "integration", environment: "node", include: ["test/integration/**/*.test.ts"] } },
    ],
  },
});
