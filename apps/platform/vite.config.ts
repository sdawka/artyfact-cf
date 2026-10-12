import { fileURLToPath, URL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // e2e fixture mode previews with in-memory state, so a System imported for the demo (.wrangler/state) never leaks in.
  plugins: [react(), cloudflare(process.env.ARTYFACT_E2E_FIXTURE === "1" ? { persistState: false } : {})],
  // Local default port is 1337 (fixture preview and e2e use 1338). Not strict: Vite takes the next free port and the CLI finds it.
  server: { port: 1337 },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
