import type { CSSProperties } from "react";
import { clamp } from "./color";

/** Class on every fallback element; style it globally, or pass `fallbackClassName` for one instance. */
export const FALLBACK_CLASS = "artyfact-fx-fallback";

const tint = (color: string, percent: number) => `color-mix(in oklch, ${color} ${Math.round(clamp(percent, 0, 100))}%, transparent)`;

/** CSS background approximating the Orb: a haze pool low in the ball and a soft rim at `size`. */
export function orbFallbackBackground(color: string, size: number, fill = 0.5): string {
  const r = clamp(size, 0.1, 1.5) * 100;
  const rim = `radial-gradient(circle closest-side at 50% 50%, transparent ${r * 0.9}%, ${tint(color, 55)} ${r * 0.985}%, ${tint(color, 18)} ${r * 1.03}%, transparent ${r * 1.12}%)`;
  const pool = `radial-gradient(ellipse ${r * 0.8}% ${r * (0.35 + 0.3 * clamp(fill, 0, 1))}% at 50% ${50 + r * 0.32}%, ${tint(color, 30)} 0%, transparent 100%)`;
  return `${rim}, ${pool}`;
}

/** CSS background approximating AmbientField: a haze pool along the bottom edge. */
export function ambientFallbackBackground(color: string, intensity: number): string {
  return `radial-gradient(ellipse 90% 60% at 50% 105%, ${tint(color, 8 + 22 * clamp(intensity, 0, 1))} 0%, transparent 100%)`;
}

const FILL: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

export function Fallback({ kind, background, className }: { kind: "orb" | "ambient"; background: string; className?: string | undefined }) {
  return (
    <div
      aria-hidden="true"
      data-effect-fallback={kind}
      className={className ? `${FALLBACK_CLASS} ${className}` : FALLBACK_CLASS}
      style={{ ...FILL, background }}
    />
  );
}
