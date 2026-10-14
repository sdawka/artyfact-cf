import { describe, expect, it } from "vitest";
import { contrast, parseOklch } from "./styleContrast";

describe("style contrast", () => {
  it("parses oklch with alpha", () => {
    expect(parseOklch("oklch(0.79 0.125 60 / 0.55)")).toEqual({ l: 0.79, c: 0.125, h: 60, a: 0.55 });
    expect(parseOklch("rgb(0 0 0)")).toBeNull();
  });
  it("white on black is 21:1; primary text on the page is AA", () => {
    expect(contrast("oklch(1 0 0)", "oklch(0 0 0)")).toBeCloseTo(21, 0);
    expect(contrast("oklch(0.94 0.015 95)", "oklch(0.18 0.018 286)")!).toBeGreaterThan(12);
    expect(contrast("oklch(0.665 0.03 280)", "oklch(0.25 0.024 282)")!).toBeGreaterThan(4.5);
  });
});
