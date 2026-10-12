import { describe, expect, it } from "vitest";
import { fromOklab, fromOklch, parseColor, parseCssColor, seeded, toOklab, type Rgb } from "../src/color";

const close = (a: Rgb | null, b: readonly number[], digits = 2) => {
  expect(a).not.toBeNull();
  a!.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));
};

describe("OKLab", () => {
  it("round-trips sRGB", () => {
    for (const c of [[0.2, 0.5, 0.8], [1, 1, 1], [0, 0, 0], [0.9, 0.4, 0.1]] as Rgb[]) close(fromOklab(toOklab(c)), c, 4);
  });

  it("maps white and black to the ends of the lightness axis", () => {
    expect(toOklab([1, 1, 1])[0]).toBeCloseTo(1, 3);
    expect(toOklab([0, 0, 0])[0]).toBeCloseTo(0, 3);
  });

  it("converts oklch with zero chroma to grey", () => {
    const [r, g, b] = fromOklch(0.6, 0, 123);
    expect(r).toBeCloseTo(g, 4);
    expect(g).toBeCloseTo(b, 4);
  });
});

describe("parseCssColor", () => {
  it("reads hex, rgb, oklch, oklab and color(srgb)", () => {
    close(parseCssColor("#ff8000"), [1, 128 / 255, 0], 3);
    close(parseCssColor("#f80"), [1, 0.5333, 0], 3);
    close(parseCssColor("rgb(255 0 0 / 50%)"), [1, 0, 0]);
    close(parseCssColor("rgba(0, 255, 0, 1)"), [0, 1, 0]);
    close(parseCssColor("oklch(1 0 0)"), [1, 1, 1], 3);
    close(parseCssColor("oklab(0 0 0)"), [0, 0, 0], 3);
    close(parseCssColor("color(srgb 0.2 0.4 0.6)"), [0.2, 0.4, 0.6]);
    const apricot = parseCssColor("oklch(0.79 0.125 60)")!;
    expect(apricot[0]).toBeGreaterThan(apricot[2]);
  });

  it("returns null for what it cannot parse without a DOM", () => {
    expect(parseCssColor("rebeccapurple")).toBeNull();
    expect(parseCssColor("var(--x)")).toBeNull();
    expect(parseCssColor("#12")).toBeNull();
  });
});

describe("parseColor", () => {
  it("falls back when nothing can resolve the colour", () => {
    expect(parseColor("var(--missing)", [0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
  });
});

describe("seeded", () => {
  it("is deterministic and in 0..1", () => {
    const a = seeded(5);
    const b = seeded(5);
    for (let i = 0; i < 50; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
