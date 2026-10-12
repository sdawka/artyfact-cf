/** Capability checks shared by the effects. Nothing here touches the DOM at import time, so it is SSR-safe. */

/** True when the WebGL2 API exists at all (false in Node, jsdom and very old browsers). Does not create a context. */
export const hasWebGL2Api = (): boolean => typeof window !== "undefined" && typeof WebGL2RenderingContext !== "undefined";

let supported: boolean | undefined;

/**
 * A fresh canvas with a WebGL2 context, or null (no DOM, no WebGL2, or an earlier attempt failed). Each live effect
 * holds one context; browsers cap live contexts (about 16 in Chromium), so keep effects per page to a handful.
 */
export function createContext(): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null {
  if (!hasWebGL2Api() || supported === false) return null;
  const canvas = document.createElement("canvas");
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  } catch {
    gl = null;
  }
  supported = !!gl;
  return gl ? { canvas, gl } : null;
}
