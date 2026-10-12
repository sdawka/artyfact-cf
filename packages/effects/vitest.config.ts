import { defineConfig } from "vitest/config";

// Pure maths runs anywhere; component tests need a DOM. jsdom has no WebGL, so components take the fallback path.
export default defineConfig({
  test: { name: "@artyfact/effects", environment: "jsdom", include: ["test/**/*.test.{ts,tsx}"] },
});
