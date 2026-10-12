/**
 * @artyfact/effects: WebGL signature effects for artyfact UIs.
 *
 * - `Orb`: glowing rim, flares, spark arcs and dust. Adapted from React Bits (MIT + Commons Clause, see src/orb/* and
 *   THIRD_PARTY_NOTICES.md); this package is private and must never be published.
 * - `AmbientField`: cheap full-bleed haze and motes for page backgrounds.
 * - `EffectsProvider` / `useEffectsEnabled`: a global off switch and reduced-motion handling.
 *
 * SSR-safe: components render an empty container on the server and load the WebGL engine (and ogl) lazily in an effect.
 * Without WebGL2 (jsdom, old browsers) or with effects disabled they render a CSS radial-gradient fallback instead.
 */
export { Orb, type OrbHandle, type OrbProps } from "./orb/Orb";
export { AmbientField, type AmbientFieldHandle, type AmbientFieldProps } from "./AmbientField";
export {
  EffectsProvider, useEffectsEnabled, useEffectsSettings, useSystemReducedMotion, type EffectsProviderProps, type EffectsSettings,
} from "./context";
export { WHIMSY, type OrbMotion, type OrbParams, type OrbParticleShape } from "./presets";
export { ORB_PRESETS, ORB_PRESET_NAMES, resolveOrbParams, type OrbPresetName } from "./orb/presets";
export { parseColor, parseCssColor, type Rgb } from "./color";
export { buildPalette, type OrbPalette } from "./orb/palette";
export { FALLBACK_CLASS } from "./Fallback";
export type { EffectMode } from "./useEngine";
export { markRectsDirty } from "./pointer";
