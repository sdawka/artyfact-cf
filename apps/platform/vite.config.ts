import { fileURLToPath, URL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type UserConfig } from "vite";
import { assertNoFakeBuild } from "./scripts/fake-build-guard";

const fake = process.env.FAKE_ARTIFACTS === "1";

/** The Artyfact seed (this repo's own source, several MB) is bundled only for FAKE_ARTIFACTS=1; other builds get an empty one. */
const noSelfSeed = (): Plugin => ({
  name: "artyfact-no-self-seed",
  load: (id) => (id.endsWith("/worker/artifacts/fake-seed-artyfact.ts")
    ? `export const artyfactSystemId = "system.artyfact"; export const artyfactGenome = {}; export const artyfactApp = {};`
    : undefined),
});

const config = {
  // A second dev server in the same checkout (the e2e self-model one) sets its own dep cache so cold starts cannot race.
  ...(process.env.VITE_CACHE_DIR && { cacheDir: process.env.VITE_CACHE_DIR }),
  // e2e fixture mode previews with in-memory state, so a System imported for the demo (.wrangler/state) never leaks in.
  // FAKE_ARTIFACTS=1 runs the backend on in-memory Artifacts seeded from examples/ (FAKE_SEED=artyfact|both adds the
  // repo-root genome/, Artyfact itself): no remote binding, no persisted state (the fake repos live in the isolate),
  // the fake System One (deployed vars no longer set FAKE_S1), no AI or BROWSER, and an admin token unless ADMIN_TOKEN is set.
  plugins: [react(), ...(fake ? [] : [noSelfSeed()]), cloudflare({
    ...((process.env.ARTYFACT_E2E_FIXTURE === "1" || fake) && { persistState: false }),
    ...(fake && {
      config: (c) => {
        // Artifacts, Workers AI and Browser Run are remote-only: without them the dev server needs no Cloudflare login.
        for (const k of ["artifacts", "ai", "browser"]) delete (c as Record<string, unknown>)[k];
        c.vars = { ...c.vars, FAKE_ARTIFACTS: "1", FAKE_S1: "1", ALLOW_LOCAL_PREVIEW: "1", ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? "fake-admin-token",
          ...(process.env.FAKE_SEED && { FAKE_SEED: process.env.FAKE_SEED }) };
      },
    }),
  })],
  // Local default port is 1337 (fixture preview and e2e use 1338). Not strict: Vite takes the next free port and the CLI finds it.
  // Playwright writes trace HTML into e2e-artifacts while the fake suite runs on this dev server; watching it reloads the page.
  // Under the fake e2e suite a background poll that the dev server fails once ("fetch failed" from miniflare) would paint
  // Vite's error overlay over the page under test and fail its axe check; the SPA itself retries the poll.
  server: { port: 1337, watch: { ignored: ["**/e2e-artifacts/**"] }, hmr: { overlay: process.env.ARTYFACT_E2E_FAKE !== "1" } },
  // The elk worker is only reached when a graph first lays out; pre-bundle it so a cold dev server does not re-optimize and
  // reload the page mid-test.
  optimizeDeps: { include: ["elkjs/lib/elk-worker.min.js", "elkjs/lib/elk-api.js", "elkjs/lib/elk.bundled.js"] },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
} satisfies UserConfig;

export default defineConfig(({ command }) => {
  assertNoFakeBuild(command, process.env);
  return config;
});
