import { beforeEach, describe, expect, it } from "vitest";
import { rememberWhy, whyFor } from "./why";

beforeEach(() => localStorage.clear());

describe("why prefill", () => {
  it("joins the remembered whys of the given realizations", () => {
    rememberWhy("s", "r.1", "Because A");
    rememberWhy("s", "r.2", "Because B");
    expect(whyFor("s", ["r.1", "r.2", "r.1"])).toBe("Because A\n\nBecause B");
    expect(whyFor("s", ["r.3"])).toBeNull();
    expect(whyFor("other", ["r.1"])).toBeNull();
  });
});
