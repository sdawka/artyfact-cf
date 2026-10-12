/**
 * Effect parameter types and the whimsy palette tokens (apps/platform/src/theme/whimsy.css) as oklch() strings, so
 * CSS fallbacks can use them directly. The Orb presets themselves live in orb/presets.ts.
 */

/** How dust moves inside the orb. */
export type OrbMotion = "rise" | "fall" | "drift" | "orbit";
/** Dust particle shape. */
export type OrbParticleShape = "square" | "round";

/** Every tunable Orb parameter. Numeric ones ease when they change (see `OrbProps.transition`). */
export interface OrbParams {
  /** Base colour: any CSS colour string, including `oklch()` and `var(--token)`. */
  color: string;
  /** Rim strands, 1..8. Fractional values fade the last strand in. */
  strands: number;
  /** Rim jitter and spark frequency, 0..1. */
  crackle: number;
  /** Height of the rim flares, 0..1. */
  flares: number;
  /** Rim bloom, 0..2. */
  glow: number;
  /** Rate of spark arcs, 0..1. */
  sparks: number;
  /** Dust particles (rounded to 100, max 40000). Changing it rebuilds the dust; it does not ease. */
  particleCount: number;
  /** How full the orb is with dust and haze, 0..1. */
  fill: number;
  motion: OrbMotion;
  particleShape: OrbParticleShape;
  /** Depth shading of the dust, 0..1. */
  depth: number;
  /** Slow rotation of the dust, 0..1. */
  sway: number;
  /** Dust twinkle, 0..1. */
  twinkle: number;
  /** Haze pool brightness, 0..2. */
  haze: number;
  /** Dust speed multiplier. */
  dustSpeed: number;
}

/** Palette token values the presets are built from. */
export const WHIMSY = {
  apricot: "oklch(0.79 0.125 60)",
  aubergine: "oklch(0.18 0.018 286)",
  success: "oklch(0.723 0.081 166.2)",
  error: "oklch(0.686 0.107 25.3)",
  info: "oklch(0.693 0.055 211.4)",
  /** The aubergine hue lifted to a visible lavender (the background itself is too dark to glow). */
  dusk: "oklch(0.74 0.075 286)",
} as const;

