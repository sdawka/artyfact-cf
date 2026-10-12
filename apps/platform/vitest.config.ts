import { fileURLToPath, URL } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

// Two projects: Worker code runs in workerd, UI/theme tests run in jsdom.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        resolve: { alias },
        test: { name: "worker", include: ["test/**/*.test.ts"] },
      },
      {
        resolve: { alias },
        test: { name: "ui", environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
      },
    ],
  },
});
