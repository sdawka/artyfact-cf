import { describe, expect, it } from "vitest";
import { parseCssColor } from "../src/color";
import { buildDust, buildStrands, MAX_STRANDS, STATE_WIDTH } from "../src/orb/data";
import { ORB_PRESET_NAMES, ORB_PRESETS, resolveOrbParams } from "../src/orb/presets";
import { WHIMSY } from "../src/presets";

describe("presets", () => {
  it("has the whimsy names, each on a palette token", () => {
    expect(ORB_PRESET_NAMES).toEqual(["apricot", "verdant", "ember", "tide", "dusk"]);
    expect(ORB_PRESETS.apricot.color).toBe("oklch(0.79 0.125 60)");
    expect(ORB_PRESETS.verdant.color).toBe(WHIMSY.success);
    expect(ORB_PRESETS.ember.color).toBe(WHIMSY.error);
    expect(ORB_PRESETS.tide.color).toBe(WHIMSY.info);
  });

  it("keeps every preset in range and parseable", () => {
    for (const name of ORB_PRESET_NAMES) {
      const p = ORB_PRESETS[name];
      expect(parseCssColor(p.color), name).not.toBeNull();
      expect(p.strands).toBeGreaterThanOrEqual(1);
      expect(p.strands).toBeLessThanOrEqual(MAX_STRANDS);
      for (const k of ["crackle", "flares", "sparks", "fill", "depth", "sway", "twinkle"] as const) {
        expect(p[k], `${name}.${k}`).toBeGreaterThanOrEqual(0);
        expect(p[k], `${name}.${k}`).toBeLessThanOrEqual(1);
      }
      expect(p.particleCount).toBeLessThanOrEqual(40000);
    }
  });

  it("applies overrides but ignores undefined and null", () => {
    const p = resolveOrbParams("ember", { fill: 0.9, color: "#fff", crackle: undefined, flares: null });
    expect(p.fill).toBe(0.9);
    expect(p.color).toBe("#fff");
    expect(p.crackle).toBe(ORB_PRESETS.ember.crackle);
    expect(p.flares).toBe(ORB_PRESETS.ember.flares);
    expect(resolveOrbParams(undefined).color).toBe(WHIMSY.apricot);
  });
});

describe("orb data", () => {
  it("builds 8 strands of vec4 harmonics deterministically", () => {
    const a = buildStrands();
    expect(a.harmonics).toHaveLength(MAX_STRANDS * 4);
    expect(a.flarePhases).toHaveLength(MAX_STRANDS * 4);
    expect(buildStrands()).toEqual(a);
  });

  it("samples dust inside the unit ball, padded to the state texture", () => {
    const d = buildDust(1000);
    expect(d.count).toBe(1000);
    expect(d.rows).toBe(Math.ceil(1000 / STATE_WIDTH));
    expect(d.home.length).toBe(STATE_WIDTH * d.rows * 4);
    for (let i = 0; i < d.count; i++) {
      const [x, y, z, tone] = [d.home[i * 4]!, d.home[i * 4 + 1]!, d.home[i * 4 + 2]!, d.home[i * 4 + 3]!];
      expect(Math.hypot(x, y, z)).toBeLessThan(1);
      expect([0, 1, 2, 3, 4]).toContain(tone);
    }
  });
});
