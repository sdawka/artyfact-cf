import { describe, expect, it } from "vitest";
import { parseCssColor, toOklab, type Rgb } from "../src/color";
import { buildDust, DUST_OUTLIER, DUST_SEDIMENT, DUST_SHELL, DUST_TONES, dustKind, dustTone } from "../src/orb/data";
import { sparkRate } from "../src/orb/engine";
import { blend, buildPalette, shift } from "../src/orb/palette";
import { MAX_PARTICLES, MAX_STRANDS, ORB_PRESET_NAMES, ORB_PRESETS, resolveOrbParams } from "../src/orb/presets";
import { WHIMSY } from "../src/presets";

const L = (rgb: Rgb) => toOklab(rgb)[0];

describe("presets", () => {
  it("covers every name, built on the whimsy palette", () => {
    expect([...ORB_PRESET_NAMES]).toEqual(["apricot", "verdant", "ember", "tide", "dusk"]);
    expect(Object.keys(ORB_PRESETS).sort()).toEqual([...ORB_PRESET_NAMES].sort());
    expect(ORB_PRESETS.apricot.color).toBe(WHIMSY.apricot);
    expect(ORB_PRESETS.verdant.color).toBe(WHIMSY.success);
    expect(ORB_PRESETS.ember.color).toBe(WHIMSY.error);
    expect(ORB_PRESETS.tide.color).toBe(WHIMSY.info);
    expect(ORB_PRESETS.dusk.color).toBe(WHIMSY.dusk);
    for (const name of ORB_PRESET_NAMES) expect(parseCssColor(ORB_PRESETS[name].color)).not.toBeNull();
  });

  it("keeps every preset inside the documented ranges", () => {
    for (const name of ORB_PRESET_NAMES) expect(resolveOrbParams(name)).toEqual(ORB_PRESETS[name]);
  });

  it("gives ember the most agitated rim and tide the calmest", () => {
    const crackle = ORB_PRESET_NAMES.map((n) => ORB_PRESETS[n].crackle);
    expect(Math.max(...crackle)).toBe(ORB_PRESETS.ember.crackle);
    expect(Math.min(...crackle)).toBe(ORB_PRESETS.tide.crackle);
  });
});

describe("resolveOrbParams", () => {
  it("defaults to apricot and falls back to it for unknown names", () => {
    expect(resolveOrbParams()).toEqual(ORB_PRESETS.apricot);
    expect(resolveOrbParams("nope" as never)).toEqual(ORB_PRESETS.apricot);
  });

  it("applies overrides and ignores undefined ones", () => {
    const p = resolveOrbParams("tide", { crackle: 0.9, motion: "orbit", color: "var(--x)", glow: undefined });
    expect(p.crackle).toBe(0.9);
    expect(p.motion).toBe("orbit");
    expect(p.color).toBe("var(--x)");
    expect(p.glow).toBe(ORB_PRESETS.tide.glow);
  });

  it("clamps numbers, rounds the particle count and rejects bad enums", () => {
    const p = resolveOrbParams("apricot", {
      strands: 20, crackle: -1, glow: 9, particleCount: 123456, fill: Number.NaN, motion: "spin" as never, particleShape: "star" as never, color: "  ",
    });
    expect(p.strands).toBe(MAX_STRANDS);
    expect(p.crackle).toBe(0);
    expect(p.glow).toBe(2);
    expect(p.particleCount).toBe(MAX_PARTICLES);
    expect(p.fill).toBe(ORB_PRESETS.apricot.fill);
    expect(p.motion).toBe(ORB_PRESETS.apricot.motion);
    expect(p.particleShape).toBe(ORB_PRESETS.apricot.particleShape);
    expect(p.color).toBe(ORB_PRESETS.apricot.color);
    expect(resolveOrbParams("apricot", { particleCount: 1249 }).particleCount).toBe(1200);
    expect(resolveOrbParams("apricot", { strands: 0 }).strands).toBe(1);
  });
});

describe("palette", () => {
  const apricot = parseCssColor(WHIMSY.apricot)!;

  it("glows light on the dark theme and inks dark on the light theme", () => {
    const dark = buildPalette(apricot);
    const light = buildPalette(apricot, "light");
    expect(L(dark.rim)).toBeGreaterThan(0.75);
    expect(L(dark.hot)).toBeGreaterThan(L(dark.rim));
    expect(L(dark.spark)).toBeGreaterThan(0.9);
    expect(L(light.rim)).toBeLessThan(0.45);
    expect(L(light.spark)).toBeLessThan(L(light.halo));
  });

  it("derives five dust tones from deep to pale", () => {
    const { dust } = buildPalette(apricot);
    expect(dust).toHaveLength(DUST_TONES);
    expect(L(dust[0])).toBeLessThan(L(dust[1]));
    expect(L(dust[1])).toBeLessThan(L(dust[2]));
    expect(L(dust[4])).toBeGreaterThan(0.9);
    for (const c of dust) for (const v of c) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("keeps the hue of the base colour", () => {
    const hue = (rgb: Rgb) => {
      const [, a, b] = toOklab(rgb);
      return Math.atan2(b, a);
    };
    for (const name of ORB_PRESET_NAMES) {
      const base = parseCssColor(ORB_PRESETS[name].color)!;
      expect(Math.abs(hue(buildPalette(base).halo) - hue(base))).toBeLessThan(0.2);
    }
  });

  it("copes with greys and black", () => {
    for (const c of [[0.5, 0.5, 0.5], [0, 0, 0], [1, 1, 1]] as Rgb[]) {
      const p = buildPalette(c);
      for (const v of [...p.rim, ...p.halo, ...p.dust.flat()]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("blends and shifts in OKLab", () => {
    const red: Rgb = [1, 0, 0];
    const blue: Rgb = [0, 0, 1];
    expect(blend(red, blue, 0)).toEqual(expect.arrayContaining([expect.closeTo(1, 4)]));
    const mid = blend(red, blue, 0.5);
    expect(L(mid)).toBeCloseTo((L(red) + L(blue)) / 2, 2);
    expect(blend(red, blue, 7)).toEqual(blend(red, blue, 1));
    const grey: Rgb = [0.4, 0.4, 0.4];
    expect(L(shift(grey, 0.1))).toBeCloseTo(L(grey) + 0.1, 3);
    expect(L(shift(apricot, -0.2))).toBeCloseTo(L(apricot) - 0.2, 2);
    const [, a, b] = toOklab(shift(apricot, 0, 0));
    expect(Math.hypot(a, b)).toBeLessThan(1e-3);
  });
});

describe("dust data", () => {
  it("is deterministic and sized to the count", () => {
    const a = buildDust(1000);
    const b = buildDust(1000);
    expect(a.count).toBe(1000);
    expect(a.place).toHaveLength(4000);
    expect(a.motion).toHaveLength(4000);
    expect(a.place).toEqual(b.place);
    expect(buildDust(1000, 7).place).not.toEqual(a.place);
    expect(buildDust(-5).count).toBe(0);
  });

  it("mixes sediment, shell and pale outliers", () => {
    const { motion, place, count } = buildDust(20000);
    const kinds = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      const kind = motion[i * 4 + 3]!;
      kinds[kind]!++;
      const tone = place[i * 4 + 3]!;
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(DUST_TONES);
      if (kind === DUST_OUTLIER) expect(tone).toBe(DUST_TONES - 1);
      for (let k = 0; k < 3; k++) {
        expect(place[i * 4 + k]).toBeGreaterThanOrEqual(0);
        expect(place[i * 4 + k]).toBeLessThan(1);
      }
    }
    expect(kinds[DUST_SEDIMENT]! / count).toBeCloseTo(0.6, 1);
    expect(kinds[DUST_SHELL]! / count).toBeCloseTo(0.32, 1);
    expect(kinds[DUST_OUTLIER]! / count).toBeCloseTo(0.08, 1);
  });

  it("maps samples to kinds and tones", () => {
    expect(dustKind(0)).toBe(DUST_SEDIMENT);
    expect(dustKind(0.7)).toBe(DUST_SHELL);
    expect(dustKind(0.99)).toBe(DUST_OUTLIER);
    expect([0, 0.3, 0.7, 0.9, 0.99].map(dustTone)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("spark rate", () => {
  it("is zero without sparks and rises with crackle and surges", () => {
    expect(sparkRate(0, 1, 2)).toBe(0);
    expect(sparkRate(0.5, 1, 0)).toBeGreaterThan(sparkRate(0.5, 0, 0));
    expect(sparkRate(0.5, 0.5, 1)).toBeGreaterThan(sparkRate(0.5, 0.5, 0));
  });
});
