import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

const subscribeReducedMotion = (onChange: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
};
const readReducedMotion = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(QUERY).matches : false);

/** The OS `prefers-reduced-motion` setting, live. False during SSR. */
export const useSystemReducedMotion = (): boolean => useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);

export interface EffectsSettings {
  /** False renders every effect as its static CSS fallback and creates no WebGL context. */
  enabled: boolean;
  /** True renders one still WebGL frame per effect: no animation, no pointer response, `pulse()` does nothing. */
  reducedMotion: boolean;
  /** Run WebGL on a software renderer (SwiftShader, llvmpipe) too. Off by default: there effects use their CSS fallback. */
  allowSoftwareRenderer: boolean;
}

interface ProviderValue {
  enabled?: boolean;
  reducedMotion?: boolean;
  allowSoftwareRenderer?: boolean;
}

const EffectsContext = createContext<ProviderValue>({});

export interface EffectsProviderProps {
  /** The user's setting. Default true. */
  enabled?: boolean;
  /** Override for reduced motion. Default: follow `prefers-reduced-motion`. */
  reducedMotion?: boolean;
  /**
   * Opt-out of the software-renderer guard, for tests or screenshots that need the live WebGL path on a machine without
   * a GPU. Default false: on SwiftShader or llvmpipe every effect keeps its CSS fallback (see `hasFastWebGL2`).
   */
  allowSoftwareRenderer?: boolean;
  children?: ReactNode;
}

/**
 * Global switch for every effect below it. Without a provider, effects are on and follow `prefers-reduced-motion`.
 * Either way, on a software WebGL renderer effects render their CSS fallback unless `allowSoftwareRenderer` is set.
 * Nested providers override only the props they set.
 */
export function EffectsProvider({ enabled, reducedMotion, allowSoftwareRenderer, children }: EffectsProviderProps) {
  const parent = useContext(EffectsContext);
  const value: ProviderValue = {
    enabled: enabled ?? parent.enabled,
    reducedMotion: reducedMotion ?? parent.reducedMotion,
    allowSoftwareRenderer: allowSoftwareRenderer ?? parent.allowSoftwareRenderer,
  };
  return <EffectsContext.Provider value={value}>{children}</EffectsContext.Provider>;
}

/** Resolved effect settings for this subtree. */
export function useEffectsSettings(): EffectsSettings {
  const ctx = useContext(EffectsContext);
  const system = useSystemReducedMotion();
  return { enabled: ctx.enabled ?? true, reducedMotion: ctx.reducedMotion ?? system, allowSoftwareRenderer: ctx.allowSoftwareRenderer ?? false };
}

/** Whether effects render with WebGL at all (false means CSS fallbacks only). */
export const useEffectsEnabled = (): boolean => useEffectsSettings().enabled;
