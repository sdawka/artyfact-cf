// Generated from examples/peopling-system by scripts/build-fixture.ts (pnpm run build:fixture).
import type { UiBundle } from "@/model/types";
import raw from "@/fixtures/peopling.model.json";

/**
 * A fresh copy of the Peopling bundle, marked `source: 'fixture'`. App code must load this
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

/** The Peopling Genome files (`{ entries, files }`), a separate chunk loaded only when a fixture file route is read. */
export const fixtureFiles = (): Promise<FixtureFiles> =>
  import("@/fixtures/peopling.files.json").then((m) => m.default as FixtureFiles);
