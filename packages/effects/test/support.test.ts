import { describe, expect, it } from "vitest";
import { isSoftwareRenderer } from "../src/support";

const RENDERER = 0x1f01;
const UNMASKED = 0x9246;
const fakeGl = (renderer: string, debugInfo = true) =>
  ({
    RENDERER,
    getExtension: (name: string) => (debugInfo && name === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: UNMASKED } : null),
    getParameter: (p: number) => (p === UNMASKED ? renderer : p === RENDERER ? (debugInfo ? "WebKit WebGL" : renderer) : null),
  }) as unknown as WebGL2RenderingContext;

describe("isSoftwareRenderer", () => {
  it("flags CPU rasterisers and passes GPUs", () => {
    expect(isSoftwareRenderer(fakeGl("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)"))).toBe(true);
    expect(isSoftwareRenderer(fakeGl("llvmpipe (LLVM 15.0.7, 256 bits)"))).toBe(true);
    expect(isSoftwareRenderer(fakeGl("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)"))).toBe(true);
    expect(isSoftwareRenderer(fakeGl("ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)"))).toBe(false);
    expect(isSoftwareRenderer(fakeGl("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)"))).toBe(false);
  });

  it("falls back to RENDERER without the debug extension, and never throws", () => {
    expect(isSoftwareRenderer(fakeGl("SwiftShader", false))).toBe(true);
    const broken = { getExtension: () => { throw new Error("lost"); } } as unknown as WebGL2RenderingContext;
    expect(isSoftwareRenderer(broken)).toBe(false);
  });
});
