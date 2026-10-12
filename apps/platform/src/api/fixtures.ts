// Generated from examples/keep-in-touch-system by scripts/build-fixture.ts (npm run build:fixture).
import type { UiBundle } from "@/model/types";
import raw from "@/fixtures/keep-in-touch.model.json";

export const FIXTURE_SYSTEM_ID = "system.keep-in-touch";

/** A fresh copy of the Keep in Touch bundle, marked `source: 'fixture'`. */
export function fixtureBundle(): UiBundle {
  return { ...(structuredClone(raw) as unknown as Omit<UiBundle, "source">), source: "fixture" };
}
