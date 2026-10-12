import { useImperativeHandle, type CSSProperties, type Ref } from "react";
import type { AmbientEngine, AmbientEngineSettings } from "./ambient/engine";
import { useEffectsSettings } from "./context";
import { Fallback, ambientFallbackBackground } from "./Fallback";
import { WHIMSY } from "./presets";
import { useEngine } from "./useEngine";

export interface AmbientFieldHandle {
  /** A ripple from a point in viewport (client) coordinates, e.g. a PointerEvent's clientX/clientY or an element's rect centre. Default: the field's centre. `strength` 0..2, default 1. */
  pulse(clientX?: number, clientY?: number, strength?: number): void;
}

export interface AmbientFieldProps {
  /** Any CSS colour, including `oklch()` and `var(--token)`. Default the apricot accent. Eases. */
  color?: string;
  /** Overall brightness 0..1. Default 0.5. Eases. */
  intensity?: number;
  /** Mote density 0..1 (200..3000 motes). Default 0.5. */
  density?: number;
  /** Drift speed; 0 renders a still frame and stops the loop. Default 1. Eases. */
  motion?: number;
  /** How far the field leans toward the pointer, 0..1. Default 0.5. */
  parallax?: number;
  /** Freeze the drift. */
  paused?: boolean;
  /** `fixed` covers the viewport; `absolute` (default) covers the nearest positioned ancestor. */
  position?: "fixed" | "absolute";
  /** Easing time constant in seconds for colour, intensity and motion; 0 snaps. Default 1.2. */
  transition?: number;
  className?: string;
  fallbackClassName?: string;
  style?: CSSProperties;
  ref?: Ref<AmbientFieldHandle>;
}

const loadAmbient = () => import("./ambient/engine").then((m) => m.createAmbientEngine);

/**
 * Full-bleed background haze with sparse drifting motes. Never takes pointer events and sits at `z-index: 0`; put
 * content in a later sibling (or give it a higher z-index). The canvas is `aria-hidden`.
 */
export function AmbientField({
  color = WHIMSY.apricot, intensity = 0.5, density = 0.5, motion = 1, parallax = 0.5, paused = false, position = "absolute",
  transition = 1.2, className, fallbackClassName, style, ref,
}: AmbientFieldProps) {
  const fx = useEffectsSettings();
  const settings: AmbientEngineSettings = { color, intensity, density, motion, parallax, paused, reducedMotion: fx.reducedMotion, transition };
  const { containerRef, engineRef, mode } = useEngine<AmbientEngine, AmbientEngineSettings>(loadAmbient, settings, fx.enabled, fx.allowSoftwareRenderer);

  useImperativeHandle(ref, () => ({
    pulse: (x, y, strength) => engineRef.current?.pulse(x, y, strength),
  }), [engineRef]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position, inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none", ...style }}
      data-effect="ambient"
      data-effect-mode={mode}
    >
      {mode === "fallback" && <Fallback kind="ambient" background={ambientFallbackBackground(color, intensity)} className={fallbackClassName} />}
    </div>
  );
}
