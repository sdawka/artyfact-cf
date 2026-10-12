// Generated from examples/keep-in-touch-system by scripts/build-fixture.ts (npm run build:fixture).
import type { UiBundle } from "@/model/types";
import raw from "@/fixtures/keep-in-touch.model.json";

/**
 * A fresh copy of the Keep in Touch bundle, marked `source: 'fixture'`. App code must load this
 * module with a dynamic `import()` (client.ts does) so the JSON stays out of the main chunk;
 * tests may import it directly.
 */
export function fixtureBundle(): UiBundle {
  return { ...(structuredClone(raw) as unknown as Omit<UiBundle, "source">), source: "fixture" };
}
