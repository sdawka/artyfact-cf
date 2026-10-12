/** Capability checks shared by the effects. Nothing here touches the DOM at import time, so it is SSR-safe. */

/** True when the WebGL2 API exists at all (false in Node, jsdom and very old browsers). Does not create a context. */
export const hasWebGL2Api = (): boolean => typeof window !== "undefined" && typeof WebGL2RenderingContext !== "undefined";

let supported: boolean | undefined;

/** Renderer strings of CPU rasterisers: WebGL there runs on the main thread's CPU budget and starves the page. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render driver/i;

/** True for a CPU (software) WebGL renderer such as SwiftShader or llvmpipe (no GPU, or a blocklisted one). */
export function isSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    return SOFTWARE_RENDERER.test(name);
  } catch {
    return false;
  }
}

/**
 * A fresh canvas with a hardware WebGL2 context, or null (no DOM, no WebGL2, a software renderer, or an earlier attempt failed). Each live effect
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
  // A software renderer costs more than the effect is worth (a full-viewport field at 1-in-4 frames on CI-class CPUs):
  // release it and let every effect use its CSS fallback.
  if (gl && isSoftwareRenderer(gl)) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    gl = null;
  }
  supported = !!gl;
  return gl ? { canvas, gl } : null;
}
