import { useEffect, useRef, useState } from "react";
import { hasWebGL2Api } from "./support";

/** `pending` until the engine loads (and during SSR), `gl` once the canvas is live, `fallback` for the CSS version. */
export type EffectMode = "pending" | "gl" | "fallback";

interface Disposable<S> {
  update(settings: S): void;
  dispose(): void;
}

export type EngineFactory<E, S> = (container: HTMLElement, settings: S, onLost: () => void) => E | null;

/**
 * Mounts a WebGL engine into a container once, keeps it updated with the latest settings every render, and disposes it
 * on unmount. The engine module (and ogl) is loaded lazily, so nothing runs during SSR and the main bundle stays small.
 * Without WebGL2, when `enabled` is false, or if the GPU drops the context, `mode` becomes `fallback`.
 */
export function useEngine<E extends Disposable<S>, S>(load: () => Promise<EngineFactory<E, S>>, settings: S, enabled: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<E | null>(null);
  const latest = useRef(settings);
  latest.current = settings;
  const [mode, setMode] = useState<EffectMode>("pending");

  useEffect(() => {
    if (!enabled || !hasWebGL2Api()) {
      setMode("fallback");
      return;
    }
    let cancelled = false;
    const lost = () => {
      engineRef.current?.dispose();
      engineRef.current = null;
      if (!cancelled) setMode("fallback");
    };
    load()
      .then((create) => {
        const el = containerRef.current;
        if (cancelled || !el) return;
        const engine = create(el, latest.current, lost);
        engineRef.current = engine;
        setMode(engine ? "gl" : "fallback");
      })
      .catch(() => {
        if (!cancelled) setMode("fallback");
      });
    return () => {
      cancelled = true;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // `load` is a module-level constant in every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    engineRef.current?.update(latest.current);
  });

  return { containerRef, engineRef, mode };
}
