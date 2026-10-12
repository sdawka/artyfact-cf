/*
 * Adapted from the Crystalized Ball component in React Bits (https://github.com/DavidHDev/react-bits).
 * Copyright (c) 2026 David Haz. Licensed under MIT + Commons Clause License Condition v1.0, NOT Apache-2.0:
 * use inside an application, website or product only; do not sell, sublicense or redistribute this component on its
 * own, in a bundle or as a ported version. Full text: THIRD_PARTY_NOTICES.md.
 */
import { useImperativeHandle, type CSSProperties, type Ref } from "react";
import { useEffectsSettings } from "../context";
import { Fallback, orbFallbackBackground } from "../Fallback";
import type { OrbEngine, OrbEngineSettings } from "./engine";
import type { OrbParams } from "../presets";
import { resolveOrbParams, type OrbPresetName } from "./presets";
import { useEngine } from "../useEngine";

/** Imperative handle for event moments ("Evolution promoted", "agent committed"). Calls before the canvas is live are dropped. */
export interface OrbHandle {
  /** A surge: brighter, faster rim, two spark arcs and a kick to the dust, as if clicked at `angle`. `strength` 0..2, default 1; `angle` in radians (0 = right, π/2 = top), default random. */
  pulse(strength?: number, angle?: number): void;
  /** One spark arc on the rim at `angle` (radians, default random). */
  spark(angle?: number): void;
}

export interface OrbProps extends Partial<OrbParams> {
  /** Starting values; any {@link OrbParams} prop overrides its preset value. Default `apricot`. */
  preset?: OrbPresetName;
  /** `light` switches to an ink palette for light backgrounds. Default `dark`. */
  theme?: "dark" | "light";
  /** Diameter as a share of the container's shorter side, 0.1..1.5. Default 0.7. */
  size?: number;
  /** Rim animation speed. Default 1. */
  speed?: number;
  /** Pointer hover and press stir the orb. Default true. */
  interactive?: boolean;
  /** Pointer influence 0..1. Default 0.7. */
  hoverStrength?: number;
  /** Play the 2.2 s unfold on mount. Default true. */
  intro?: boolean;
  /** Freeze animation (pointer settling still renders). */
  paused?: boolean;
  /** Seconds for numeric props and colour to ease to new values (time constant; ~95% after 3×). 0 snaps. Default 0.6. */
  transition?: number;
  className?: string;
  /** Extra class on the CSS fallback element (rendered without WebGL2 or with effects disabled). */
  fallbackClassName?: string;
  style?: CSSProperties;
  ref?: Ref<OrbHandle>;
}

const loadOrb = () => import("./engine").then((m) => m.createOrbEngine);

const BOX: CSSProperties = { position: "relative", width: "100%", height: "100%", overflow: "hidden" };

/**
 * The signature orb: a glowing rim of strands with flares and spark arcs around a ball of drifting dust. Fills its
 * container (give the container a size). Decorative: the canvas is `aria-hidden`; put meaning in nearby text.
 */
export function Orb({
  preset = "apricot", theme = "dark", size = 0.7, speed = 1, interactive = true, hoverStrength = 0.7, intro = true, paused = false,
  transition = 0.6, className, fallbackClassName, style, ref, ...overrides
}: OrbProps) {
  const fx = useEffectsSettings();
  const params = resolveOrbParams(preset, overrides);
  const settings: OrbEngineSettings = {
    params, light: theme === "light", size, speed, interactive, hoverStrength, intro, paused, reducedMotion: fx.reducedMotion, transition,
  };
  const { containerRef, engineRef, mode } = useEngine<OrbEngine, OrbEngineSettings>(loadOrb, settings, fx.enabled, fx.allowSoftwareRenderer);

  useImperativeHandle(ref, () => ({
    pulse: (strength, angle) => engineRef.current?.pulse(strength, angle),
    spark: (angle) => engineRef.current?.spark(angle),
  }), [engineRef]);

  return (
    <div ref={containerRef} className={className} style={{ ...BOX, ...style }} data-effect="orb" data-effect-mode={mode}>
      {mode === "fallback" && <Fallback kind="orb" background={orbFallbackBackground(params.color, size, params.fill)} className={fallbackClassName} />}
    </div>
  );
}
