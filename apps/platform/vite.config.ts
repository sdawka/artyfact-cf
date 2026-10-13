import { fileURLToPath, URL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const fake = process.env.FAKE_ARTIFACTS === "1";

export default defineConfig({
  // e2e fixture mode previews with in-memory state, so a System imported for the demo (.wrangler/state) never leaks in.
  // FAKE_ARTIFACTS=1 runs the backend on in-memory Artifacts seeded from examples/: no remote binding, no persisted state
  // (the fake repos live in the isolate), the fake System One (deployed vars no longer set FAKE_S1), and an admin token
  // for local use unless ADMIN_TOKEN is set.
  plugins: [react(), cloudflare({
    ...((process.env.ARTYFACT_E2E_FIXTURE === "1" || fake) && { persistState: false }),
    ...(fake && {
      config: (c) => {
        delete (c as { artifacts?: unknown }).artifacts;
        c.vars = { ...c.vars, FAKE_ARTIFACTS: "1", FAKE_S1: "1", ALLOW_LOCAL_PREVIEW: "1", ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? "fake-admin-token" };
      },
    }),
  })],
  // Local default port is 1337 (fixture preview and e2e use 1338). Not strict: Vite takes the next free port and the CLI finds it.
  server: { port: 1337 },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
