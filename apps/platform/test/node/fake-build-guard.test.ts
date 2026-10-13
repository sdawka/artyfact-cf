import { describe, expect, it } from "vitest";
import { assertNoFakeBuild } from "../../scripts/fake-build-guard";

describe("FAKE_ARTIFACTS under vite", () => {
  it("refuses a build with fake vars unless it is for the fake e2e suite", () => {
    expect(() => assertNoFakeBuild("build", { FAKE_ARTIFACTS: "1" })).toThrow(/FAKE_ARTIFACTS=1 is refused for `vite build`/);
    expect(() => assertNoFakeBuild("build", { FAKE_ARTIFACTS: "1", ARTYFACT_E2E_FAKE: "1" })).not.toThrow();
  });

  it("allows the dev server and builds without fakes", () => {
    expect(() => assertNoFakeBuild("serve", { FAKE_ARTIFACTS: "1" })).not.toThrow();
    expect(() => assertNoFakeBuild("build", {})).not.toThrow();
    expect(() => assertNoFakeBuild("build", { FAKE_ARTIFACTS: "0" })).not.toThrow();
  });
});
