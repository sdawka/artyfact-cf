/*
 * Adapted from the Crystalized Ball component in React Bits (https://github.com/DavidHDev/react-bits).
 * Copyright (c) 2026 David Haz. Licensed under MIT + Commons Clause License Condition v1.0, NOT Apache-2.0:
 * use inside an application, website or product only; do not sell, sublicense or redistribute this component on its
 * own, in a bundle or as a ported version. Full text: THIRD_PARTY_NOTICES.md.
 */
/** Orb presets on the whimsy palette; tuning follows the React Bits presets. */
import { WHIMSY, type OrbParams } from "../presets";

const base = {
  particleCount: 15000, fill: 0.5, motion: "rise", particleShape: "square", depth: 0.6, sway: 0.5, twinkle: 0.5, haze: 0.7, dustSpeed: 1,
} as const satisfies Partial<OrbParams>;

export const ORB_PRESETS = {
  /** Accent: the default, for the brand and for neutral or in-progress states. */
  apricot: { ...base, color: WHIMSY.apricot, strands: 6, crackle: 0.7, flares: 0.7, glow: 1, sparks: 0.5, motion: "orbit", sway: 0.7, haze: 0.8 },
  /** Success: calm, steady rise. */
  verdant: { ...base, color: WHIMSY.success, strands: 5, crackle: 0.5, flares: 0.45, glow: 0.85, sparks: 0.4 },
  /** Error: agitated, hot, fast dust. */
  ember: { ...base, color: WHIMSY.error, strands: 5, crackle: 0.9, flares: 0.8, glow: 1, sparks: 0.8, particleCount: 12000, fill: 0.35, particleShape: "round", depth: 0.7, sway: 0.3, twinkle: 0.7, haze: 0.9, dustSpeed: 1.6 },
  /** Info: slow, deep, falling. */
  tide: { ...base, color: WHIMSY.info, strands: 3, crackle: 0.35, flares: 0.35, glow: 0.75, sparks: 0.25, particleCount: 16000, fill: 0.65, motion: "fall", particleShape: "round", depth: 0.8, sway: 0.6, twinkle: 0.4, haze: 0.6, dustSpeed: 0.7 },
  /** Background hue: quiet drift for idle or ambient use. */
  dusk: { ...base, color: WHIMSY.dusk, strands: 4, crackle: 0.5, flares: 0.4, glow: 0.8, sparks: 0.35, particleCount: 14000, motion: "drift", depth: 0.7, haze: 0.6, dustSpeed: 0.8 },
} as const satisfies Record<string, OrbParams>;

export type OrbPresetName = keyof typeof ORB_PRESETS;
export const ORB_PRESET_NAMES = Object.keys(ORB_PRESETS) as OrbPresetName[];

/** The preset's params with any defined overrides applied (undefined and null keep the preset value). */
export function resolveOrbParams(preset: OrbPresetName | undefined, overrides: Partial<Record<keyof OrbParams, unknown>> = {}): OrbParams {
  const out: OrbParams = { ...(ORB_PRESETS[preset ?? "apricot"] ?? ORB_PRESETS.apricot) };
  for (const key of Object.keys(out) as (keyof OrbParams)[]) {
    const v = overrides[key];
    if (v !== undefined && v !== null) (out as unknown as Record<string, unknown>)[key] = v;
  }
  return out;
}
