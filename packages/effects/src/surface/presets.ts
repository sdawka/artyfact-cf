import { clamp } from "../color";
import { WHIMSY } from "../presets";

export type SurfacePresetName = "apricot" | "verdant" | "ember" | "tide" | "dusk";
export const SURFACE_PRESET_NAMES: readonly SurfacePresetName[] = ["apricot", "verdant", "ember", "tide", "dusk"];
export interface SurfaceParams {
  color: string;
  /** Vertical reach of the illuminated haze, 0..1. */
  level: number;
  /** Ambient motion and twinkle, 0..1. */
  activity: number;
  /** Lateral movement of the light, 0..1. */
  agitation: number;
  /** Edge filaments, 1..8. */
  channels: number;
  /** Strength of the edge highlights, 0..1. */
  alerts: number;
  /** Mote density, 0..1; at most 64 motes. */
  density: number;
}
export const SURFACE_PRESETS: Readonly<Record<SurfacePresetName, Readonly<SurfaceParams>>> = {
  apricot: { color: WHIMSY.apricot, level: 0.5, activity: 0.35, agitation: 0.35, channels: 4, alerts: 0.4, density: 0.45 },
  verdant: { color: WHIMSY.success, level: 0.62, activity: 0.2, agitation: 0.18, channels: 3, alerts: 0.25, density: 0.4 },
  ember: { color: WHIMSY.error, level: 0.45, activity: 0.6, agitation: 0.75, channels: 6, alerts: 0.7, density: 0.45 },
  tide: { color: WHIMSY.info, level: 0.55, activity: 0.15, agitation: 0.15, channels: 3, alerts: 0.2, density: 0.35 },
  dusk: { color: WHIMSY.dusk, level: 0.5, activity: 0.25, agitation: 0.28, channels: 5, alerts: 0.35, density: 0.45 },
};
const finite = (value: number | undefined, fallback: number, max = 1, min = 0) =>
  typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
export function resolveSurfaceParams(preset: SurfacePresetName = "apricot", overrides: Partial<SurfaceParams> = {}): SurfaceParams {
  const base = SURFACE_PRESETS[preset] ?? SURFACE_PRESETS.apricot;
  return {
    color: overrides.color?.trim() || base.color,
    level: finite(overrides.level, base.level), activity: finite(overrides.activity, base.activity),
    agitation: finite(overrides.agitation, base.agitation), channels: finite(overrides.channels, base.channels, 8, 1),
    alerts: finite(overrides.alerts, base.alerts), density: finite(overrides.density, base.density),
  };
}
