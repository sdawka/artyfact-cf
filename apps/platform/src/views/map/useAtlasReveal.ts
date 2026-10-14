import { useLayoutEffect, useRef } from "react";
import { useSystemReducedMotion } from "@artyfact/effects";
import { useEffectsPreference } from "@/effects/effectsPreference";

/** Reveal a changed surface without touching React Flow's camera or node geometry. */
export function useAtlasReveal(element: HTMLElement | null, key: string | boolean | null, duration = 180) {
  const { enabled } = useEffectsPreference();
  const reduced = useSystemReducedMotion();
  const previous = useRef(key);
  useLayoutEffect(() => {
    const changed = previous.current !== key;
    if (key && !element) return; // Wait for a newly opened overlay to attach.
    previous.current = key;
    if (!changed || !element || !key || !enabled || reduced || typeof element.animate !== "function") return;
    const animation = element.animate([{ opacity: 0.55 }, { opacity: 1 }], {
      duration, easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
    return () => animation.cancel();
  }, [element, key, duration, enabled, reduced]);
}
