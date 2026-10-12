/** Capability checks shared by the effects. Nothing here touches the DOM at import time, so it is SSR-safe. */

/** True when the WebGL2 API exists at all (false in Node, jsdom and very old browsers). Does not create a context. */
export const hasWebGL2Api = (): boolean => typeof window !== "undefined" && typeof WebGL2RenderingContext !== "undefined";

/** Renderer strings of CPU rasterisers: WebGL there runs on the main thread's CPU budget and starves the page. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render driver/i;

/** True for a CPU (software) WebGL renderer such as SwiftShader or llvmpipe (no GPU, or a blocklisted one). */
export function isSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = `${String(gl.getParameter(gl.RENDERER) ?? "")} ${info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? "") : ""}`;
    return SOFTWARE_RENDERER.test(name);
  } catch {
    return false;
  }
}

let fast: boolean | undefined;

/**
 * True when WebGL2 is GPU-backed. False without WebGL2 (SSR, jsdom, old browsers) or on a software renderer
 * (SwiftShader, llvmpipe: machines and CI runners without a usable GPU), where a full-viewport effect takes most of the
 * main thread and the page stops responding to input. Chromium does not flag SwiftShader through
 * `failIfMajorPerformanceCaveat`, so the renderer string is checked too. Probed once per page with a throwaway context.
 */
export function hasFastWebGL2(): boolean {
  if (fast !== undefined) return fast;
  if (!hasWebGL2Api()) return false;
  try {
    const gl = document.createElement("canvas").getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    fast = !!gl && !isSoftwareRenderer(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    fast = false;
  }
  return fast;
}

/** Test hook: forget the cached {@link hasFastWebGL2} probe. */
export const resetWebGLProbe = () => {
  fast = undefined;
};

let supported: boolean | undefined;

/**
 * A fresh canvas with a WebGL2 context, or null (no DOM, no WebGL2, or an earlier attempt failed). Each live effect
 * holds one context; browsers cap live contexts (about 16 in Chromium), so keep effects per page to a handful.
 * Software renderers are filtered earlier, by `useEngine` through {@link hasFastWebGL2}.
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
