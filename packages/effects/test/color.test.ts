import { describe, expect, it } from "vitest";
import { fromOklab, fromOklch, parseColor, parseCssColor, toOklab, type Rgb } from "../src/color";
import { blend, buildPalette, shift } from "../src/orb/palette";

const close = (a: readonly number[], b: readonly number[], eps = 2e-3) => a.every((v, i) => Math.abs(v - b[i]!) <= eps);

describe("parseCssColor", () => {
  it("parses hex in all lengths", () => {
    expect(parseCssColor("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(parseCssColor("#f80")).toEqual([1, 136 / 255, 0]);
    expect(parseCssColor("#ff800080")).toEqual([1, 128 / 255, 0]);
    expect(parseCssColor("#ff80")).toEqual([1, 1, 136 / 255]);
  });

  it("parses rgb() in legacy and modern syntax", () => {
    expect(parseCssColor("rgb(255, 0, 51)")).toEqual([1, 0, 0.2]);
    expect(parseCssColor("rgba(255 0 51 / 0.5)")).toEqual([1, 0, 0.2]);
    expect(parseCssColor("rgb(100% 50% 0%)")).toEqual([1, 0.5, 0]);
  });

  it("parses oklch() without a canvas (the reference relied on canvas fillStyle)", () => {
    // White and black are exact.
    expect(close(parseCssColor("oklch(1 0 0)")!, [1, 1, 1])).toBe(true);
    expect(close(parseCssColor("oklch(0 0 0)")!, [0, 0, 0])).toBe(true);
    // The apricot accent: a warm orange, red > green > blue.
    const apricot = parseCssColor("oklch(0.79 0.125 60)")!;
    expect(apricot[0]).toBeGreaterThan(apricot[1]);
    expect(apricot[1]).toBeGreaterThan(apricot[2]);
    // Percent lightness, degree units and an alpha are accepted.
    expect(close(parseCssColor("oklch(79% 0.125 60deg / 0.5)")!, apricot)).toBe(true);
    // What Chromium paints for the same token (canvas getImageData): rgb(245, 166, 99).
    expect(close(apricot, [245 / 255, 166 / 255, 99 / 255], 2 / 255)).toBe(true);
  });

  it("parses oklab() and color(srgb)", () => {
    expect(close(parseCssColor("oklab(1 0 0)")!, [1, 1, 1])).toBe(true);
    expect(parseCssColor("color(srgb 1 0.5 0)")).toEqual([1, 0.5, 0]);
  });

  it("returns null for what it cannot resolve alone", () => {
    for (const v of ["rebeccapurple", "hsl(10 50% 50%)", "oklch(from red l c h)", "var(--x)", "#12", "nonsense("]) {
      expect(parseCssColor(v)).toBeNull();
    }
  });
});

describe("parseColor", () => {
  it("uses the fallback when nothing resolves (no canvas in jsdom)", () => {
    const fb: Rgb = [0.1, 0.2, 0.3];
    expect(parseColor("rebeccapurple", fb)).toEqual(fb);
    expect(close(parseColor("oklch(1 0 0)", fb), [1, 1, 1])).toBe(true);
  });

  it("resolves var(--token) from the document root", () => {
    document.documentElement.style.setProperty("--fx-test", "#00ff00");
    expect(parseColor("var(--fx-test)", [0, 0, 0])).toEqual([0, 1, 0]);
    expect(parseColor("var(--fx-missing, #ff0000)", [0, 0, 0])).toEqual([1, 0, 0]);
  });
});

describe("OKLab maths", () => {
  it("round-trips sRGB", () => {
    for (const c of [[0.2, 0.4, 0.6], [1, 0.5, 0], [0.9, 0.9, 0.1]] as Rgb[]) {
      expect(close(fromOklab(toOklab(c)), c, 1e-4)).toBe(true);
    }
  });

  it("matches the oklch definition", () => {
    const [L, a, b] = toOklab(fromOklch(0.7, 0.1, 120));
    expect(L).toBeCloseTo(0.7, 3);
    expect(Math.hypot(a, b)).toBeCloseTo(0.1, 3);
    expect((Math.atan2(b, a) * 180) / Math.PI).toBeCloseTo(120, 1);
  });

  it("blends through OKLab and shifts lightness", () => {
    expect(close(blend([1, 0, 0], [0, 0, 1], 0), [1, 0, 0])).toBe(true);
    expect(close(blend([1, 0, 0], [0, 0, 1], 1), [0, 0, 1])).toBe(true);
    const base = fromOklch(0.6, 0.08, 200);
    expect(toOklab(shift(base, 0, -0.1, 1))[0]).toBeCloseTo(0.5, 3);
  });
});

describe("buildPalette", () => {
  const color = fromOklch(0.79, 0.125, 60);

  it("derives the dark palette like the reference", () => {
    const p = buildPalette(color);
    expect(p.rim).toEqual(color);
    expect(p.tones).toHaveLength(5);
    // Hot rim is lighter than the rim, deep rim darker.
    expect(toOklab(p.rimHot)[0]).toBeGreaterThan(toOklab(p.rim)[0]);
    expect(toOklab(p.rimDeep)[0]).toBeLessThan(toOklab(p.rim)[0]);
    // Every channel stays in gamut.
    for (const c of [p.rim, p.rimHot, p.rimMid, p.rimDeep, p.spark, p.sparkGlow, p.haze, p.edge, ...p.tones]) {
      for (const v of c) expect(v >= 0 && v <= 1).toBe(true);
    }
  });

  it("derives an ink palette for light themes", () => {
    const p = buildPalette(color, true);
    expect(toOklab(p.rim)[0]).toBeLessThanOrEqual(0.621);
    expect(p.rimHot).toEqual(p.rim);
  });
});
