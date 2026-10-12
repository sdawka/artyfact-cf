// hand-made fixture; replaced by scripts/build-fixture.ts once examples/keep-in-touch-system exists
import type { UiBundle } from "@/model/types";
import raw from "@/fixtures/keep-in-touch.model.json";

export const FIXTURE_SYSTEM_ID = "system.keep-in-touch";

/** A fresh copy of the Keep in Touch bundle, marked `source: 'fixture'`. */
export function fixtureBundle(): UiBundle {
  const { $comment: _comment, ...bundle } = structuredClone(raw) as typeof raw;
  return { ...(bundle as unknown as Omit<UiBundle, "source">), source: "fixture" };
}
