// Dev-only: serves amendment-dev.html without the Cloudflare plugin (whose SPA fallback hides extra html pages).
// pnpm exec vite --config vite.amendment-dev.config.ts --port 5199, then /amendment-dev.html?scenario=hard
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
