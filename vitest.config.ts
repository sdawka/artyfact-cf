import { defineConfig } from "vitest/config";

// Each workspace is its own project; apps/platform ships a vitest.config.ts with workerd + jsdom projects.
export default defineConfig({
  test: { projects: ["packages/*", "apps/*", "examples/*"] },
});
