/** Shared decorative effects. SurfaceField is card-local CSS light; AmbientField is a lazy WebGL page background. */
export { SurfaceField, type SurfaceFieldProps, type SurfaceHandle, type SurfacePoint } from "./surface/SurfaceField";
export { SURFACE_PRESETS, SURFACE_PRESET_NAMES, resolveSurfaceParams, type SurfacePresetName, type SurfaceParams } from "./surface/presets";
export { AmbientField, type AmbientFieldHandle, type AmbientFieldProps } from "./AmbientField";
export {
  EffectsProvider, useEffectsEnabled, useEffectsSettings, useSystemReducedMotion, type EffectsProviderProps, type EffectsSettings,
} from "./context";
export { WHIMSY } from "./presets";
export { parseColor, parseCssColor, type Rgb } from "./color";
export { FALLBACK_CLASS } from "./Fallback";
export type { EffectMode } from "./useEngine";
export { markRectsDirty } from "./pointer";
export { hasFastWebGL2, isSoftwareRenderer } from "./support";
