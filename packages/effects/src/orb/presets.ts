/**
 * Orb presets, tuned around the whimsy palette. Each preset is a complete {@link OrbParams}; `resolveOrbParams` layers
 * per-instance overrides on top and clamps everything into range.
 */
import { clamp } from "../color";
import { WHIMSY, type OrbMotion, type OrbParams, type OrbParticleShape } from "../presets";

export type OrbPresetName = "apricot" | "verdant" | "ember" | "tide" | "dusk";

export const ORB_PRESET_NAMES: readonly OrbPresetName[] = ["apricot", "verdant", "ember", "tide", "dusk"];

/** Most particles the dust can hold. */
export const MAX_PARTICLES = 40000;
/** Most rim strands. */
export const MAX_STRANDS = 8;

export const ORB_PRESETS: Readonly<Record<OrbPresetName, Readonly<OrbParams>>> = {
  // Warm accent: a lively rim, steady sparks, dust rising out of a half-full ball.
  apricot: {
    color: WHIMSY.apricot, strands: 4, crackle: 0.35, flares: 0.4, glow: 1, sparks: 0.35, particleCount: 12000, fill: 0.5,
    motion: "rise", particleShape: "square", depth: 0.6, sway: 0.3, twinkle: 0.45, haze: 1, dustSpeed: 1,
  },
  // Success: calm and full, round dust drifting gently.
  verdant: {
    color: WHIMSY.success, strands: 3, crackle: 0.18, flares: 0.25, glow: 1.1, sparks: 0.2, particleCount: 12000, fill: 0.62,
    motion: "drift", particleShape: "round", depth: 0.55, sway: 0.4, twinkle: 0.35, haze: 1.1, dustSpeed: 0.8,
  },
  // Error: agitated rim, tall flares, frequent sparks and quick rising dust.
  ember: {
    color: WHIMSY.error, strands: 6, crackle: 0.75, flares: 0.7, glow: 1.15, sparks: 0.6, particleCount: 12000, fill: 0.45,
    motion: "rise", particleShape: "square", depth: 0.6, sway: 0.25, twinkle: 0.6, haze: 1, dustSpeed: 1.45,
  },
  // Info: a quiet teal with dust slowly settling.
  tide: {
    color: WHIMSY.info, strands: 3, crackle: 0.15, flares: 0.2, glow: 0.95, sparks: 0.15, particleCount: 12000, fill: 0.55,
    motion: "fall", particleShape: "round", depth: 0.7, sway: 0.35, twinkle: 0.3, haze: 1.15, dustSpeed: 0.7,
  },
  // Background hue: soft lavender, dust looping in small orbits.
  dusk: {
    color: WHIMSY.dusk, strands: 5, crackle: 0.28, flares: 0.35, glow: 1.2, sparks: 0.25, particleCount: 12000, fill: 0.5,
    motion: "orbit", particleShape: "round", depth: 0.65, sway: 0.45, twinkle: 0.7, haze: 1, dustSpeed: 0.9,
  },
};

const MOTIONS: readonly OrbMotion[] = ["rise", "fall", "drift", "orbit"];
const SHAPES: readonly OrbParticleShape[] = ["square", "round"];

const num = (value: number | undefined, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;

/**
 * A preset (default apricot) with `overrides` applied. Unknown presets fall back to apricot, `undefined` overrides are
 * ignored, numbers are clamped into their documented ranges and `particleCount` is rounded to a multiple of 100.
 */
export function resolveOrbParams(preset: OrbPresetName = "apricot", overrides: Partial<OrbParams> = {}): OrbParams {
  const base = ORB_PRESETS[preset] ?? ORB_PRESETS.apricot;
  const o = overrides;
  const count = num(o.particleCount, base.particleCount, 0, MAX_PARTICLES);
  return {
    color: typeof o.color === "string" && o.color.trim() ? o.color : base.color,
    strands: num(o.strands, base.strands, 1, MAX_STRANDS),
    crackle: num(o.crackle, base.crackle, 0, 1),
    flares: num(o.flares, base.flares, 0, 1),
    glow: num(o.glow, base.glow, 0, 2),
    sparks: num(o.sparks, base.sparks, 0, 1),
    particleCount: Math.round(count / 100) * 100,
    fill: num(o.fill, base.fill, 0, 1),
    motion: o.motion && MOTIONS.includes(o.motion) ? o.motion : base.motion,
    particleShape: o.particleShape && SHAPES.includes(o.particleShape) ? o.particleShape : base.particleShape,
    depth: num(o.depth, base.depth, 0, 1),
    sway: num(o.sway, base.sway, 0, 1),
    twinkle: num(o.twinkle, base.twinkle, 0, 1),
    haze: num(o.haze, base.haze, 0, 2),
    dustSpeed: num(o.dustSpeed, base.dustSpeed, 0, 4),
  };
}
