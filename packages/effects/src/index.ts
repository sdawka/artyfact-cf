/**
 * @artyfact/effects: WebGL signature effects for artyfact UIs.
 *
 * - `Orb`: a glass sphere with a plasma rim, flares, spark arcs, settled dust and a haze pool.
 * - `AmbientField`: cheap full-bleed haze and motes for page backgrounds.
 * - `EffectsProvider` / `useEffectsEnabled`: a global off switch and reduced-motion handling.
 *
 * SSR-safe: components render an empty container on the server and load the WebGL engine (and ogl) lazily in an effect.
 * Without WebGL2 (jsdom, old browsers), on a software renderer (SwiftShader, llvmpipe) or with effects disabled they
 * render a CSS radial-gradient fallback instead.
 */
export { Orb, type OrbHandle, type OrbProps } from "./orb/Orb";
export { AmbientField, type AmbientFieldHandle, type AmbientFieldProps } from "./AmbientField";
export {
  EffectsProvider, useEffectsEnabled, useEffectsSettings, useSystemReducedMotion, type EffectsProviderProps, type EffectsSettings,
} from "./context";
export { WHIMSY, type OrbMotion, type OrbParams, type OrbParticleShape } from "./presets";
export { ORB_PRESETS, ORB_PRESET_NAMES, resolveOrbParams, type OrbPresetName } from "./orb/presets";
export { parseColor, parseCssColor, type Rgb } from "./color";
export { buildPalette, type OrbPalette, type OrbTheme } from "./orb/palette";
export { FALLBACK_CLASS } from "./Fallback";
export type { EffectMode } from "./useEngine";
export { markRectsDirty } from "./pointer";
export { hasFastWebGL2, isSoftwareRenderer } from "./support";
