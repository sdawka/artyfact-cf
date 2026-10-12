import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Fixture-mode variant: no Cloudflare plugin, so building and previewing need no Cloudflare login.
 * The SPA is served statically and `/api/*` answers 404 JSON, which sends the client to its bundled fixture.
 */
const apiUnavailable = (): Plugin => ({
  name: "artyfact-fixture-api-404",
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith("/api/")) return next();
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { code: "not-found", message: "No API in fixture mode" } }));
    });
  },
});

export default defineConfig({
  plugins: [react(), apiUnavailable()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist-fixture" },
});
