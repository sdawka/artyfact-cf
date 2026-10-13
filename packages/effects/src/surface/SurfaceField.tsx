import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from "react";
import { clamp, seeded } from "../color";
import { useEffectsSettings } from "../context";
import { FALLBACK_CLASS } from "../Fallback";
import type { SurfaceEngine, SurfaceEngineSettings } from "./engine";
import { resolveSurfaceParams, type SurfaceParams, type SurfacePresetName } from "./presets";

export interface SurfacePoint { x: number; y: number }
export interface SurfaceHandle {
  /** Finite rectangular edge brightening. No-op while paused, hidden or under reduced motion. */
  pulse(strength?: number, point?: SurfacePoint): void;
  /** One short filament at a normalized card-local point. */
  spark(point?: SurfacePoint): void;
}
export interface SurfaceFieldProps extends Partial<SurfaceParams> {
  preset?: SurfacePresetName;
  paused?: boolean;
  interactive?: boolean;
  /** CSS transition duration in seconds; 0 snaps. */
  transition?: number;
  className?: string;
  fallbackClassName?: string;
  style?: CSSProperties;
  ref?: Ref<SurfaceHandle>;
}
const random = seeded(1913);
// Geometry is seeded once, shared by SSR and hydration, and never recomputed during motion.
const MOTES = Array.from({ length: 64 }, () => ({ x: 3 + random() * 94, y: random(), size: 0.8 + random() * 1.7, phase: random() * 20, depth: random() }));
const CSS = `
[data-effect="surface"] .artyfact-surface-mote { animation: artyfact-surface-drift var(--surface-period) ease-in-out infinite alternate; animation-play-state: inherit; }
[data-effect="surface"] .artyfact-surface-channel { animation: artyfact-surface-shimmer calc(var(--surface-period) * .8) ease-in-out infinite alternate; animation-play-state: inherit; }
@keyframes artyfact-surface-drift { from { transform: translate(0, 3px); opacity: calc(var(--surface-mote-opacity) * .35); } to { transform: translate(var(--surface-travel), -8px); opacity: var(--surface-mote-opacity); } }
@keyframes artyfact-surface-shimmer { from { opacity: calc(var(--surface-channel-opacity) * .4); transform: translateX(-3px); } to { opacity: var(--surface-channel-opacity); transform: translateX(3px); } }
@media (forced-colors: active) { [data-effect="surface"] { display: none !important; } }
@media (prefers-reduced-motion: reduce) { [data-effect="surface"] .artyfact-surface-mote, [data-effect="surface"] .artyfact-surface-channel { animation: none; } }
`;
const load = () => import("./engine");
const finite = (value: number, fallback: number, max: number) => Number.isFinite(value) ? clamp(value, 0, max) : fallback;

/** Rectangular light, depth and motes belonging to the caller's card. The caller owns content and semantics. */
export function SurfaceField({ preset = "apricot", paused = false, interactive = false, transition = 0.6, className, fallbackClassName, style, ref, ...overrides }: SurfaceFieldProps) {
  const params = resolveSurfaceParams(preset, overrides);
  const fx = useEffectsSettings();
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<SurfaceEngine | null>(null);
  const settings: SurfaceEngineSettings = { paused, interactive, activity: params.activity, reducedMotion: fx.reducedMotion };
  const latest = useRef(settings);
  latest.current = settings;
  const [mode, setMode] = useState<"static" | "css">("static");
  useEffect(() => {
    if (!fx.enabled) { setMode("static"); return; }
    let cancelled = false;
    void load().then(({ createSurfaceEngine }) => {
      if (cancelled || !container.current) return;
      engine.current = createSurfaceEngine(container.current, latest.current);
      setMode("css");
    }).catch(() => { if (!cancelled) setMode("static"); });
    return () => { cancelled = true; engine.current?.dispose(); engine.current = null; };
  }, [fx.enabled]);
  useEffect(() => { engine.current?.update(settings); });
  useImperativeHandle(ref, () => ({ pulse: (strength, point) => engine.current?.pulse(strength, point), spark: (point) => engine.current?.spark(point) }), []);
  const duration = `${fx.reducedMotion ? 0 : finite(transition, 0.6, 10)}s`;
  const variables = {
    "--surface-color": params.color,
    "--surface-haze": `color-mix(in oklch, ${params.color} ${Math.round(15 + params.level * 12)}%, transparent)`,
    "--surface-edge": `color-mix(in oklch, ${params.color} ${Math.round(22 + params.alerts * 24)}%, transparent)`,
    "--surface-period": `${18 - params.activity * 10}s`,
    "--surface-travel": `${2 + params.agitation * 10}px`,
  } as CSSProperties;
  return (
    <div ref={container} className={className} aria-hidden="true" data-effect="surface" data-effect-mode={mode}
      style={{ position: "absolute", inset: 0, borderRadius: "inherit", overflow: "hidden", ...style, ...variables, pointerEvents: "none", animationPlayState: "paused" }}>
      <style>{CSS}</style>
      <div data-effect-fallback="surface" className={fallbackClassName ? `${FALLBACK_CLASS} ${fallbackClassName}` : FALLBACK_CLASS}
        style={{ position: "absolute", inset: 0, borderRadius: "inherit", background: "linear-gradient(0deg, var(--surface-haze), transparent 76%), linear-gradient(112deg, transparent 48%, var(--surface-haze) 100%)", opacity: 0.65 + params.level * 0.35, transition: `opacity ${duration}` }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: "inherit", border: "1px solid var(--surface-edge)", boxShadow: "inset 0 -12px 24px -16px var(--surface-color), inset 0 1px 8px -5px var(--surface-color)", opacity: 0.55 + params.alerts * 0.45, transition: `opacity ${duration}` }} />
      {Array.from({ length: Math.ceil(params.channels) }, (_, i) => (
        <span key={i} className="artyfact-surface-channel" style={{ position: "absolute", left: `${3 + i * 7}%`, bottom: `${1 + i * 1.6}%`, width: `${88 - i * 7}%`, height: 1, background: "linear-gradient(90deg, transparent, var(--surface-color), transparent)", ...({ "--surface-channel-opacity": i + 1 > params.channels ? params.channels % 1 * 0.6 : 0.6 } as CSSProperties), opacity: "var(--surface-channel-opacity)", animationDelay: `${-i * 1.8}s`, animationPlayState: "inherit" }} />
      ))}
      {MOTES.slice(0, Math.round(params.density * 64)).map((m, i) => (
        <span key={i} data-surface-mote className="artyfact-surface-mote" style={{ position: "absolute", left: `${m.x}%`, top: `${98 - m.y * (24 + params.level * 72)}%`, width: m.size, height: m.size, background: "var(--surface-color)", boxShadow: "0 0 5px var(--surface-color)", ...({ "--surface-mote-opacity": 0.25 + m.depth * 0.55 } as CSSProperties), opacity: "var(--surface-mote-opacity)", animationDelay: `${-m.phase}s`, animationPlayState: "inherit" }} />
      ))}
      <span data-surface-pulse style={{ position: "absolute", inset: 0, borderRadius: "inherit", border: "1px solid var(--surface-color)", boxShadow: "inset 0 0 20px -8px var(--surface-color)", opacity: 0 }} />
      <span data-surface-spark style={{ position: "absolute", left: "40%", top: "85%", width: "20%", height: 1, background: "linear-gradient(90deg, transparent, var(--surface-color), transparent)", boxShadow: "0 0 5px var(--surface-color)", opacity: 0 }} />
    </div>
  );
}
