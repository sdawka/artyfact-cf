import { cleanup, render, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AmbientField, EffectsProvider, FALLBACK_CLASS, Orb, useEffectsEnabled, useEffectsSettings, type AmbientFieldHandle, type OrbHandle,
} from "../src/index";
import { ambientFallbackBackground, orbFallbackBackground } from "../src/Fallback";
import { pointerRegistryState, subscribePointer } from "../src/pointer";

afterEach(cleanup);

describe("fallback in jsdom (no WebGL2)", () => {
  it("renders the Orb as a tinted CSS gradient with the class hook", () => {
    const { container } = render(<Orb preset="verdant" fallbackClassName="mine" />);
    const root = container.querySelector('[data-effect="orb"]')!;
    expect(root.getAttribute("data-effect-mode")).toBe("fallback");
    const fb = root.querySelector("[data-effect-fallback=orb]") as HTMLElement;
    expect(fb.className).toBe(`${FALLBACK_CLASS} mine`);
    expect(fb.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelector("canvas")).toBeNull();
  });

  it("tints the fallback gradients with the effect colour (jsdom drops color-mix, so check the strings)", () => {
    const orb = orbFallbackBackground("oklch(0.5 0.1 200)", 0.7, 0.5);
    expect(orb).toMatch(/^radial-gradient\(circle closest-side/);
    expect(orb).toContain("color-mix(in oklch, oklch(0.5 0.1 200) 55%, transparent) 68.95%");
    expect(ambientFallbackBackground("var(--color-success)", 1)).toContain("var(--color-success) 30%");
  });

  it("renders the AmbientField fallback without pointer events", () => {
    const { container } = render(<AmbientField position="fixed" intensity={0.8} />);
    const root = container.querySelector('[data-effect="ambient"]') as HTMLElement;
    expect(root.style.position).toBe("fixed");
    expect(root.style.pointerEvents).toBe("none");
    expect(root.querySelector("[data-effect-fallback=ambient]")).not.toBeNull();
  });

  it("exposes handles that are safe to call without a canvas", () => {
    const orb = createRef<OrbHandle>();
    const field = createRef<AmbientFieldHandle>();
    render(<><Orb ref={orb} /><AmbientField ref={field} /></>);
    expect(() => {
      orb.current!.pulse(1.5, Math.PI / 2);
      orb.current!.spark();
      field.current!.pulse(10, 10, 1);
    }).not.toThrow();
  });
});

describe("SSR", () => {
  it("renders an empty pending container on the server", () => {
    const html = renderToString(<><Orb preset="ember" /><AmbientField /></>);
    expect(html).toContain('data-effect="orb"');
    expect(html).toContain('data-effect-mode="pending"');
    expect(html).not.toContain("canvas");
    expect(html).not.toContain("data-effect-fallback");
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
