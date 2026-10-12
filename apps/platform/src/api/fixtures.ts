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

export interface FixtureFiles {
  entries: { path: string; hash: string; size: number }[];
  files: Record<string, string>;
}

/** The Keep in Touch Genome files (`{ entries, files }`), a separate chunk loaded only when a fixture file route is read. */
export const fixtureFiles = (): Promise<FixtureFiles> =>
  import("@/fixtures/keep-in-touch.files.json").then((m) => m.default as FixtureFiles);
