import { AmbientField, WHIMSY, type AmbientFieldHandle } from "@artyfact/effects";
import { useEffect, useRef, useState } from "react";
import { FX_EVENT, parseAmbientFx, type AmbientFxKind } from "./ambientEvents";
import { useSystemVitals } from "./vitals";

/** Accent colour a ripple tints the room with; null keeps the health colour. Only a promotion may turn it green. */
const ACCENT: Record<AmbientFxKind, string | null> = {
  promoted: WHIMSY.success,
  fail: WHIMSY.error,
  commit: WHIMSY.info,
  submitted: WHIMSY.apricot,
  select: null,
};
const STRENGTH: Record<AmbientFxKind, number> = { promoted: 1.8, fail: 1.4, commit: 1.2, submitted: 1.1, select: 0.7 };
/** How long an accent holds before easing back to the health colour. */
const ACCENT_MS = 1800;
/** The field sits behind every view, copy included: keep it under the README's 0.5 ceiling. */
export const SHELL_MAX_INTENSITY = 0.45;

/**
 * Vitals intensity (0.25 quiet .. 0.6 busy) mapped into 0.3..0.45: a quiet System still reads as a lit room through the
 * Shell's veils, and a busy one stays under the README ceiling for haze behind copy.
 */
export const shellIntensity = (v: number) => Math.min(SHELL_MAX_INTENSITY, Math.max(0.3, 0.3 + (v - 0.25) * 0.43));

/** The room's mood: one fixed AmbientField behind the Shell, coloured by System health and rippled by `artyfact:fx`. */
export function ShellAmbient() {
  const vitals = useSystemVitals();
  const field = useRef<AmbientFieldHandle>(null);
  const [accent, setAccent] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onFx = (e: Event) => {
      const fx = parseAmbientFx((e as CustomEvent).detail);
      if (!fx) return;
      field.current?.pulse(fx.x, fx.y, fx.strength ?? STRENGTH[fx.kind]);
      const tint = ACCENT[fx.kind];
      if (!tint) return;
      clearTimeout(timer);
      setAccent(tint);
      timer = setTimeout(() => setAccent(null), ACCENT_MS);
    };
    window.addEventListener(FX_EVENT, onFx);
    return () => {
      window.removeEventListener(FX_EVENT, onFx);
      clearTimeout(timer);
    };
  }, []);

  const base = shellIntensity(vitals.ambient.intensity);
  return (
    <div data-shell-ambient data-health={vitals.health} data-accent={accent ?? undefined}>
      <AmbientField
        ref={field}
        position="fixed"
        color={accent ?? vitals.ambient.color}
        intensity={accent ? Math.min(0.5, base + 0.15) : base}
        density={0.35}
        parallax={0.3}
      />
    </div>
  );
}
