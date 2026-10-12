import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EffectsProvider, useEffectsSettings } from "../src";
import { hasFastWebGL2, isSoftwareRenderer, resetWebGLProbe } from "../src/support";

const RENDERER = 0x1f01;
const UNMASKED = 0x9246;
const fakeGl = (renderer: string, debugInfo = true) => {
  const lose = vi.fn();
  return {
    lose,
    gl: {
      RENDERER,
      getExtension: (name: string) =>
        name === "WEBGL_debug_renderer_info" ? (debugInfo ? { UNMASKED_RENDERER_WEBGL: UNMASKED } : null) : name === "WEBGL_lose_context" ? { loseContext: lose } : null,
      getParameter: (p: number) => (p === UNMASKED ? renderer : p === RENDERER ? (debugInfo ? "WebKit WebGL" : renderer) : null),
    } as unknown as WebGL2RenderingContext,
  };
};

/** Pretend the browser has WebGL2 and every canvas yields `gl` (null: no context). */
function stubWebGL(gl: WebGL2RenderingContext | null) {
  vi.stubGlobal("WebGL2RenderingContext", class {});
  return vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(gl as never);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetWebGLProbe();
});

describe("isSoftwareRenderer", () => {
  it("flags CPU rasterisers and passes GPUs", () => {
    expect(isSoftwareRenderer(fakeGl("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)").gl)).toBe(true);
    expect(isSoftwareRenderer(fakeGl("llvmpipe (LLVM 15.0.7, 256 bits)").gl)).toBe(true);
    expect(isSoftwareRenderer(fakeGl("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)").gl)).toBe(true);
    expect(isSoftwareRenderer(fakeGl("ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)").gl)).toBe(false);
    expect(isSoftwareRenderer(fakeGl("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)").gl)).toBe(false);
  });

  it("reads RENDERER without the debug extension, and never throws", () => {
    expect(isSoftwareRenderer(fakeGl("SwiftShader", false).gl)).toBe(true);
    const broken = { getExtension: () => { throw new Error("lost"); } } as unknown as WebGL2RenderingContext;
    expect(isSoftwareRenderer(broken)).toBe(false);
  });
});

describe("hasFastWebGL2", () => {
  it("is false without WebGL2 (jsdom) and creates no canvas", () => {
    const spy = vi.spyOn(document, "createElement");
    expect(hasFastWebGL2()).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("is true on a GPU, probes once per page and releases the probe context", () => {
    const { gl, lose } = fakeGl("ANGLE (Apple, ANGLE Metal Renderer: Apple M2)");
    const getContext = stubWebGL(gl);
    expect(hasFastWebGL2()).toBe(true);
    expect(hasFastWebGL2()).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith("webgl2", { failIfMajorPerformanceCaveat: true });
    expect(lose).toHaveBeenCalledTimes(1);
  });

  it("is false on SwiftShader, and when the context is refused", () => {
    stubWebGL(fakeGl("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)").gl);
    expect(hasFastWebGL2()).toBe(false);
    resetWebGLProbe();
    stubWebGL(null);
    expect(hasFastWebGL2()).toBe(false);
  });
});

describe("allowSoftwareRenderer", () => {
  it("defaults off and is inherited by nested providers", () => {
    expect(renderHook(() => useEffectsSettings()).result.current.allowSoftwareRenderer).toBe(false);
    const { result } = renderHook(() => useEffectsSettings().allowSoftwareRenderer, {
      wrapper: ({ children }) => (
        <EffectsProvider allowSoftwareRenderer>
          <EffectsProvider enabled>{children}</EffectsProvider>
        </EffectsProvider>
      ),
    });
    expect(result.current).toBe(true);
  });
});
