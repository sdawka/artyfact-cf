import { fileURLToPath, URL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // e2e fixture mode previews with in-memory state, so a System imported for the demo (.wrangler/state) never leaks in.
  plugins: [react(), cloudflare(process.env.ARTYFACT_E2E_FIXTURE === "1" ? { persistState: false } : {})],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
