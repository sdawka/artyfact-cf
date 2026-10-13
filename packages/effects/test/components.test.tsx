import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AmbientField, EffectsProvider, FALLBACK_CLASS, SurfaceField, useEffectsEnabled, useEffectsSettings, type AmbientFieldHandle, type SurfaceHandle,
} from "../src/index";
import { ambientFallbackBackground } from "../src/Fallback";
import { pointerRegistryState, subscribePointer } from "../src/pointer";

afterEach(cleanup);

describe("card-local surface", () => {
  it("renders the surface as visible rectangular light, without any GPU", () => {
    expect(SurfaceField).toBeTypeOf("function");
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const { container } = render(<EffectsProvider enabled={false}><SurfaceField preset="verdant" density={1} fallbackClassName="mine" /></EffectsProvider>);
    const root = container.querySelector('[data-effect="surface"]') as HTMLElement;
    expect(root.dataset.effectMode).toBe("static");
    expect(root.style.pointerEvents).toBe("none");
    expect(root.getAttribute("aria-hidden")).toBe("true");
    const fb = root.querySelector("[data-effect-fallback=surface]") as HTMLElement;
    expect(fb.className).toBe(`${FALLBACK_CLASS} mine`);
    expect(fb.style.background).toContain("linear-gradient");
    expect(fb.style.background).not.toContain("radial-gradient");
    expect(root.querySelectorAll("[data-surface-mote]").length).toBeLessThanOrEqual(64);
    expect(root.querySelector("canvas, circle, ellipse")).toBeNull();
    expect(context).not.toHaveBeenCalled();
    context.mockRestore();
  });

  it("keeps reduced-motion and explicitly paused surfaces still", async () => {
    const { container, rerender } = render(<EffectsProvider reducedMotion><SurfaceField interactive /></EffectsProvider>);
    const root = container.querySelector('[data-effect="surface"]') as HTMLElement;
    await waitFor(() => expect(root.dataset.effectMode).toBe("css"));
    expect(root.dataset.surfaceRunning).toBe("false");
    expect(pointerRegistryState().subscribers).toBe(0);
    rerender(<EffectsProvider reducedMotion={false}><SurfaceField paused interactive /></EffectsProvider>);
    expect(root.dataset.surfaceRunning).toBe("false");
    expect(pointerRegistryState().subscribers).toBe(0);
  });

  it("exposes safe finite handles before enhancement and under reduced motion", () => {
    const surface = createRef<SurfaceHandle>();
    const field = createRef<AmbientFieldHandle>();
    render(<EffectsProvider reducedMotion><SurfaceField ref={surface} /><AmbientField ref={field} /></EffectsProvider>);
    expect(() => {
      surface.current!.pulse(1.5, { x: 1, y: 0 });
      surface.current!.spark({ x: 0, y: 1 });
      field.current!.pulse(10, 10, 1);
    }).not.toThrow();
  });

  it("renders the AmbientField fallback without changing its pointer behavior", () => {
    const { container } = render(<AmbientField position="fixed" intensity={0.8} />);
    const root = container.querySelector('[data-effect="ambient"]') as HTMLElement;
    expect(root.style.position).toBe("fixed");
    expect(root.style.pointerEvents).toBe("none");
    expect(root.querySelector("[data-effect-fallback=ambient]")).not.toBeNull();
    expect(ambientFallbackBackground("var(--color-success)", 1)).toContain("var(--color-success) 30%");
  });
});

describe("SSR", () => {
  it("renders visible deterministic surface light before JavaScript runs", () => {
    const html = renderToString(<SurfaceField preset="ember" density={0.3} />);
    expect(html).toContain('data-effect="surface"');
    expect(html).toContain('data-effect-mode="static"');
    expect(html).toContain('data-effect-fallback="surface"');
    expect(html).toContain("linear-gradient");
    expect(html).not.toContain("radial-gradient");
    expect(html).not.toContain("canvas");
    expect(html).toEqual(renderToString(<SurfaceField preset="ember" density={0.3} />));
  });
});

describe("EffectsProvider", () => {
  it("defaults to enabled and follows prefers-reduced-motion", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("matchMedia", matchMedia);
    const { result } = renderHook(() => useEffectsSettings());
    expect(result.current).toEqual({ enabled: true, reducedMotion: true, allowSoftwareRenderer: false });
    vi.unstubAllGlobals();
  });

  it("turns effects off for a subtree, and nested providers only override what they set", () => {
    const { result } = renderHook(() => [useEffectsEnabled(), useEffectsSettings().reducedMotion] as const, {
      wrapper: ({ children }) => (
        <EffectsProvider enabled={false} reducedMotion={false}>
          <EffectsProvider reducedMotion>{children}</EffectsProvider>
        </EffectsProvider>
      ),
    });
    expect(result.current).toEqual([false, true]);
  });
});

describe("pointer registry", () => {
  it("attaches window listeners once and detaches with the last subscriber", () => {
    const add = vi.spyOn(window, "addEventListener");
    const el = document.createElement("div");
    const offA = subscribePointer({ element: el, active: true });
    const offB = subscribePointer({ element: el, active: true });
    expect(pointerRegistryState()).toEqual({ subscribers: 2, attached: true });
    expect(add.mock.calls.filter(([type]) => type === "pointermove")).toHaveLength(1);
    offA();
    expect(pointerRegistryState().attached).toBe(true);
    offB();
    expect(pointerRegistryState()).toEqual({ subscribers: 0, attached: false });
    add.mockRestore();
  });

  it("only notifies subscribers the pointer is over or has just left", () => {
    const inside = document.createElement("div");
    const outside = document.createElement("div");
    inside.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} });
    outside.getBoundingClientRect = () => ({ left: 500, top: 500, width: 10, height: 10, right: 510, bottom: 510, x: 500, y: 500, toJSON() {} });
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribePointer({ element: inside, active: true, onMove: a });
    const offB = subscribePointer({ element: outside, active: true, onMove: b });
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 50, clientY: 50 }));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 200, clientY: 200 }));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 300 }));
    expect(a.mock.calls.map(([s]) => s.inside)).toEqual([true, false]);
    expect(b).not.toHaveBeenCalled();
    offA();
    offB();
  });
});
