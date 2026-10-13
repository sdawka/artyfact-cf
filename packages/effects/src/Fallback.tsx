import type { CSSProperties } from "react";
import { clamp } from "./color";

/** Class on every fallback element; style it globally, or pass `fallbackClassName` for one instance. */
export const FALLBACK_CLASS = "artyfact-fx-fallback";

const tint = (color: string, percent: number) => `color-mix(in oklch, ${color} ${Math.round(clamp(percent, 0, 100))}%, transparent)`;

/** CSS background approximating AmbientField: a haze pool along the bottom edge. */
export function ambientFallbackBackground(color: string, intensity: number): string {
  return `radial-gradient(ellipse 90% 60% at 50% 105%, ${tint(color, 8 + 22 * clamp(intensity, 0, 1))} 0%, transparent 100%)`;
}

const FILL: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

export function Fallback({ kind, background, className }: { kind: "ambient"; background: string; className?: string | undefined }) {
  return (
    <div
      aria-hidden="true"
      data-effect-fallback={kind}
      className={className ? `${FALLBACK_CLASS} ${className}` : FALLBACK_CLASS}
      style={{ ...FILL, background }}
    />
  );
}
