import { act, cleanup, render, waitFor } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EffectsProvider, SurfaceField, resolveSurfaceParams, WHIMSY } from "../src/index";
import { pointerRegistryState } from "../src/pointer";
import { createSurfaceEngine, type SurfaceEngineSettings } from "../src/surface/engine";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("surface controls", () => {
  it("keeps malformed and extreme values within bounded drawing ranges", () => {
    expect(resolveSurfaceParams("apricot", { level: Infinity, activity: -3, agitation: 7, channels: 50, alerts: NaN, density: 10, color: " " })).toEqual({
      color: WHIMSY.apricot, level: 0.5, activity: 0, agitation: 1, channels: 8, alerts: 0.4, density: 1,
    });
    expect(resolveSurfaceParams("tide", { channels: 0, density: 0 }).channels).toBe(1);
    const { container } = render(<EffectsProvider enabled={false}><SurfaceField density={0} channels={0} /></EffectsProvider>);
    expect(container.querySelectorAll("[data-surface-mote]")).toHaveLength(0);
    expect(container.querySelectorAll(".artyfact-surface-channel")).toHaveLength(1);
  });

  it("preserves the semantic palette and custom token colors", () => {
    expect(resolveSurfaceParams("verdant").color).toBe(WHIMSY.success);
    expect(resolveSurfaceParams("ember").color).toBe(WHIMSY.error);
    expect(resolveSurfaceParams("tide").color).toBe(WHIMSY.info);
    expect(resolveSurfaceParams("dusk").color).toBe(WHIMSY.dusk);
    expect(resolveSurfaceParams("apricot", { color: "var(--test)" }).color).toBe("var(--test)");
  });
});

describe("surface lifecycle", () => {
  it("pauses offscreen and hidden, resumes when visible, and releases listeners on disposal", () => {
    let notify!: IntersectionObserverCallback;
    let disconnected = false;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { notify = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    });
    const element = document.createElement("div");
    const settings: SurfaceEngineSettings = { paused: false, reducedMotion: false, interactive: true, activity: 0.5 };
    let hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    const engine = createSurfaceEngine(element, settings);
    const visible = (isIntersecting: boolean) => notify([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(element.style.animationPlayState).toBe("paused");
    expect(pointerRegistryState().subscribers).toBe(0);
    visible(true);
    expect(element.style.animationPlayState).toBe("running");
    expect(pointerRegistryState().subscribers).toBe(1);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(element.style.animationPlayState).toBe("paused");
    expect(pointerRegistryState().subscribers).toBe(0);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(element.style.animationPlayState).toBe("running");
    visible(false);
    expect(element.style.animationPlayState).toBe("paused");
    engine.dispose();
    expect(disconnected).toBe(true);
    expect(pointerRegistryState()).toEqual({ subscribers: 0, attached: false });
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(element.dataset.surfaceRunning).toBe("false");
  });

  it("bounds finite bursts and cancels them when motion is disabled", () => {
    const element = document.createElement("div");
    element.innerHTML = '<span data-surface-pulse></span><span data-surface-spark></span>';
    const frames: Keyframe[][] = [];
    let live = 0;
    for (const target of element.children) {
      Object.defineProperty(target, "animate", { value: (keyframes: Keyframe[]) => {
        frames.push(keyframes); live++;
        return { finished: new Promise(() => {}), cancel() { live--; } };
      } });
    }
    const settings = { paused: false, reducedMotion: false, interactive: false, activity: 1 };
    const engine = createSurfaceEngine(element, settings);
    engine.pulse(100, { x: -3, y: 4 });
    engine.pulse(0.5);
    expect(live).toBe(2);
    expect(frames[0]![1]!.opacity).toBe(1);
    const spark = element.querySelector<HTMLElement>("[data-surface-spark]")!;
    expect(spark.style.left).toBe("0%");
    expect(spark.style.top).toContain("100% - 1px");
    expect(spark.style.top).not.toBe("100%");
    engine.update({ ...settings, reducedMotion: true });
    expect(live).toBe(0);
    engine.spark();
    expect(live).toBe(0);
    engine.dispose();
  });

  it("responds to a manual pointer without intercepting the caller's control", () => {
    const card = document.createElement("div");
    const button = document.createElement("button");
    const surface = document.createElement("div");
    const pulse = document.createElement("span");
    pulse.dataset.surfacePulse = "";
    surface.append(pulse);
    card.append(surface, button);
    document.body.append(card);
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0, toJSON() {} });
    let flashes = 0;
    Object.defineProperty(pulse, "animate", { value: () => { flashes++; return { finished: new Promise(() => {}), cancel() {} }; } });
    const engine = createSurfaceEngine(surface, { paused: false, reducedMotion: false, interactive: true, activity: 1 });
    const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 });
    button.dispatchEvent(event);
    expect(flashes).toBe(1);
    expect(event.target).toBe(button);
    expect(event.defaultPrevented).toBe(false);
    engine.update({ paused: true, reducedMotion: false, interactive: true, activity: 1 });
    button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 30, clientY: 40 }));
    expect(flashes).toBe(1);
    engine.dispose();
    card.remove();
  });

  it("refreshes card-local pointer coordinates after an element resize", () => {
    let resize!: ResizeObserverCallback;
    let disconnected = false;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    });
    const element = document.createElement("div");
    document.body.append(element);
    element.innerHTML = '<span data-surface-pulse></span><span data-surface-spark></span>';
    let width = 200;
    element.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: 100, width, height: 100, x: 0, y: 0, toJSON() {} });
    let flashes = 0;
    for (const target of element.children) Object.defineProperty(target, "animate", { value: () => { flashes++; return { finished: new Promise(() => {}), cancel() {} }; } });
    const engine = createSurfaceEngine(element, { paused: false, reducedMotion: false, interactive: true, activity: 1 });
    window.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 50 }));
    expect(flashes).toBe(2);
    width = 400;
    expect(resize).toBeTypeOf("function");
    resize([], {} as ResizeObserver);
    window.dispatchEvent(new MouseEvent("pointerdown", { clientX: 300, clientY: 50 }));
    expect(flashes).toBe(4);
    expect(element.querySelector<HTMLElement>("[data-surface-spark]")!.style.left).toBe("65%");
    engine.dispose();
    expect(disconnected).toBe(true);
    element.remove();
  });

  it("cleans up on the global effects switch and when the component unmounts", async () => {
    const { container, rerender, unmount } = render(<EffectsProvider><SurfaceField interactive /></EffectsProvider>);
    await waitFor(() => expect(container.querySelector("[data-effect=surface]")?.getAttribute("data-effect-mode")).toBe("css"));
    expect(pointerRegistryState().subscribers).toBe(1);
    rerender(<EffectsProvider enabled={false}><SurfaceField interactive /></EffectsProvider>);
    expect(container.querySelector("[data-effect=surface]")?.getAttribute("data-effect-mode")).toBe("static");
    expect(pointerRegistryState().subscribers).toBe(0);
    unmount();
    expect(pointerRegistryState()).toEqual({ subscribers: 0, attached: false });
  });

  it("hydrates the static SSR surface without replacing or mismatching the geometry", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(<SurfaceField preset="tide" density={0.25} />);
    const firstMote = container.querySelector("[data-surface-mote]");
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, <SurfaceField preset="tide" density={0.25} />, { onRecoverableError: (error) => errors.push(error) }); });
    expect(errors).toEqual([]);
    expect(container.querySelector("[data-surface-mote]")).toBe(firstMote);
    await act(async () => root.unmount());
    container.remove();
  });
});
