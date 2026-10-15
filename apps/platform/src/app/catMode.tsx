import { useEffect } from "react";
import { usePlatform } from "@/api/queries";

/** The `cat-mode` Flagship flag, read from `GET /api/platform`; off until it loads and whenever the request fails. */
export const useCatMode = (): boolean => usePlatform().data?.catMode === true;

/** Header badge next to the wordmark: an aria-hidden glyph plus the words for assistive tech. */
export function CatModeBadge() {
  return <><span aria-hidden className="u-glyph">🐈</span><span className="sr-only">cat mode on</span></>;
}

/** Sets `data-cat-mode="on"` on the root element while the flag is on, for the one rule in whimsy.css. */
export function CatModeRoot() {
  const on = useCatMode();
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    root.dataset.catMode = "on";
    return () => { delete root.dataset.catMode; };
  }, [on]);
  return null;
}
