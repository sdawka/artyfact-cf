import { useImperativeHandle, type CSSProperties, type Ref } from "react";
import { useEffectsSettings } from "../context";
import { Fallback, orbFallbackBackground } from "../Fallback";
import type { OrbParams } from "../presets";
import { useEngine } from "../useEngine";
import type { OrbEngine, OrbEngineSettings } from "./engine";
import type { OrbTheme } from "./palette";
import { resolveOrbParams, type OrbPresetName } from "./presets";

export interface OrbHandle {
  /** A surge: brief brightening and crackle, two sparks and an outward kick to the dust. `strength` 0..2 (default 1); `angle` in radians (0 = right, π/2 = up) aims it. No-op under reduced motion. */
  pulse(strength?: number, angle?: number): void;
  /** One spark arc, near `angle` (radians) when given. */
  spark(angle?: number): void;
}

export interface OrbProps extends Partial<OrbParams> {
  /** Starting point for every parameter; explicit props override it. Default `apricot`. */
  preset?: OrbPresetName;
  /** `dark` (default) glows additively; `light` draws ink-like tones for light backgrounds. */
  theme?: OrbTheme;
  /** Orb diameter as a fraction of min(width, height). Default 0.7. Eases. */
  size?: number;
  /** Animation speed multiplier. Default 1. Eases. */
  speed?: number;
  /** React to hover (rim heat, dust stirring, tilt) and clicks (pulse). Default true. */
  interactive?: boolean;
  /** Strength of the hover response, 0..2. Default 1. */
  hoverStrength?: number;
  /** Play the intro the first time the orb scrolls into view. Default true. */
  intro?: boolean;
  /** Freeze the animation (a still frame stays on screen). */
  paused?: boolean;
  /** Easing time constant in seconds for numeric params and colour; 0 snaps. Default 0.6. */
  transition?: number;
  className?: string;
  fallbackClassName?: string;
  style?: CSSProperties;
  ref?: Ref<OrbHandle>;
}

const loadOrb = () => import("./engine").then((m) => m.createOrbEngine);

/**
 * A glass sphere with a live plasma rim, spark arcs, settled glowing dust and a haze pool. Fills its container (give the
 * container a size); the canvas is `aria-hidden`. Falls back to a CSS gradient without a fast WebGL2 or with effects off.
 */
export function Orb({
  preset = "apricot", theme = "dark", size = 0.7, speed = 1, interactive = true, hoverStrength = 1, intro = true, paused = false,
  transition = 0.6, className, fallbackClassName, style, ref,
  color, strands, crackle, flares, glow, sparks, particleCount, fill, motion, particleShape, depth, sway, twinkle, haze, dustSpeed,
}: OrbProps) {
  const fx = useEffectsSettings();
  const params = resolveOrbParams(preset, {
    color, strands, crackle, flares, glow, sparks, particleCount, fill, motion, particleShape, depth, sway, twinkle, haze, dustSpeed,
  });
  const settings: OrbEngineSettings = {
    params, theme, size, speed, interactive, hoverStrength, intro, paused, reducedMotion: fx.reducedMotion, transition,
  };
  const { containerRef, engineRef, mode } = useEngine<OrbEngine, OrbEngineSettings>(loadOrb, settings, fx.enabled, fx.allowSoftwareRenderer);

  useImperativeHandle(ref, () => ({
    pulse: (strength, angle) => engineRef.current?.pulse(strength, angle),
    spark: (angle) => engineRef.current?.spark(angle),
  }), [engineRef]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
      data-effect="orb"
      data-effect-mode={mode}
    >
      {mode === "fallback" && <Fallback kind="orb" background={orbFallbackBackground(params.color, size, params.fill)} className={fallbackClassName} />}
    </div>
  );
}
