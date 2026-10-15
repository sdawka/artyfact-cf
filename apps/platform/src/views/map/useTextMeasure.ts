import { useEffect, useMemo, useState } from "react";
import type { Measure, TileFont } from "./atlasTile";

/**
 * Measures tile text with the page's own fonts on a canvas, so the layout wraps names and purposes the way the browser
 * will. Re-measures once web fonts finish loading. Without a canvas (tests, very old browsers) it returns undefined and
 * the layout falls back to its per-character estimate.
 */
export function useTextMeasure(): Measure | undefined {
  const [fontsVersion, setFontsVersion] = useState(0);
  useEffect(() => {
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts) return;
    let live = true;
    const bump = () => { if (live) setFontsVersion((v) => v + 1); };
    void fonts.ready.then(bump);
    fonts.addEventListener?.("loadingdone", bump);
    return () => { live = false; fonts.removeEventListener?.("loadingdone", bump); };
  }, []);
  return useMemo(() => canvasMeasure(), [fontsVersion]);
}

function canvasMeasure(): Measure | undefined {
  if (typeof document === "undefined" || /jsdom/i.test(navigator.userAgent)) return undefined;
  const context = document.createElement("canvas").getContext("2d");
  const style = getComputedStyle(document.documentElement);
  const ui = style.getPropertyValue("--font-ui").trim(), display = style.getPropertyValue("--font-display").trim();
  if (!context || !ui || !display) return undefined;
  // Same faces, weights and rem sizes as nodes.module.css.
  const rem = parseFloat(style.fontSize) || 16;
  const fonts: Record<TileFont, string> = { title: `600 ${rem}px ${ui}`, systemTitle: `500 ${1.5 * rem}px ${display}`, purpose: `400 ${0.875 * rem}px ${ui}`, summary: `400 ${0.8125 * rem}px ${ui}` };
  const cache = new Map<string, number>();
  return (text, font) => {
    const key = `${font}\u0000${text}`;
    let width = cache.get(key);
    if (width === undefined) {
      context.font = fonts[font];
      width = context.measureText(text).width;
      cache.set(key, width);
    }
    return width;
  };
}
