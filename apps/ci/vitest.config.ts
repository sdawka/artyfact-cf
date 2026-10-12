import { defineConfig } from "vitest/config";

// The pipeline logic is pure (src/pipeline.ts) and runs in Node; src/index.ts needs workerd + containers and is not unit-tested.
export default defineConfig({ test: { name: "ci", environment: "node", include: ["test/**/*.test.ts"] } });
