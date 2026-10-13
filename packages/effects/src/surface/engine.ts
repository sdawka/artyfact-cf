import { clamp } from "../color";
import { markRectsDirty, subscribePointer, type PointerSubscriber } from "../pointer";
import type { SurfaceHandle, SurfacePoint } from "./SurfaceField";

export interface SurfaceEngineSettings { paused: boolean; reducedMotion: boolean; interactive: boolean; activity: number }
export interface SurfaceEngine extends SurfaceHandle { update(settings: SurfaceEngineSettings): void; dispose(): void }

/** Lazy CSS lifecycle controller. No canvas, GPU context, pixel buffers, or per-frame JavaScript. */
export function createSurfaceEngine(element: HTMLElement, initial: SurfaceEngineSettings): SurfaceEngine {
  let settings = initial;
  let disposed = false;
  let visible = typeof IntersectionObserver === "undefined";
  let offPointer: (() => void) | undefined;
  const animations = new Map<HTMLElement, Animation>();
  const moving = () => !disposed && visible && !document.hidden && !settings.paused && !settings.reducedMotion;
  const stopBursts = () => { for (const animation of animations.values()) animation.cancel(); animations.clear(); };
  const point = (p?: SurfacePoint) => ({ x: clamp(Number.isFinite(p?.x) ? p!.x : 0.5, 0, 1), y: clamp(Number.isFinite(p?.y) ? p!.y : 0.85, 0, 1) });
  const burst = (selector: string, strength: number, p?: SurfacePoint) => {
    if (!moving()) return;
    const target = element.querySelector<HTMLElement>(selector);
    if (!target?.animate) return;
    if (p && selector === "[data-surface-spark]") {
      const at = point(p);
      target.style.left = `${clamp(at.x * 100 - 10, 0, 80)}%`;
      target.style.top = `clamp(0px, ${at.y * 100}%, calc(100% - 1px))`;
    }
    animations.get(target)?.cancel();
    const animation = target.animate([{ opacity: 0 }, { opacity: clamp(strength, 0, 1), offset: 0.2 }, { opacity: 0 }], { duration: 650, easing: "ease-out" });
    animations.set(target, animation);
    void animation.finished.then(() => { if (animations.get(target) === animation) animations.delete(target); }, () => {});
  };
  const engine: SurfaceEngine = {
    pulse(strength = 1, p) { burst("[data-surface-pulse]", Number.isFinite(strength) ? strength : 1, p); if (p) engine.spark(p); },
    spark(p) { burst("[data-surface-spark]", 0.8, p); },
    update(next) { settings = next; sync(); },
    dispose() {
      disposed = true;
      offPointer?.(); offPointer = undefined;
      observer?.disconnect();
      resizeObserver?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      element.dataset.surfaceRunning = "false";
      element.style.animationPlayState = "paused";
      stopBursts();
    },
  };
  const pointer: PointerSubscriber = {
    element, active: false,
    onDown(spot) { if (spot.inside) engine.pulse(0.55, { x: spot.x / Math.max(spot.width, 1), y: spot.y / Math.max(spot.height, 1) }); },
  };
  function sync() {
    const running = moving();
    element.dataset.surfaceRunning = String(running);
    element.style.animationPlayState = running && settings.activity > 0 ? "running" : "paused";
    pointer.active = running && settings.interactive;
    if (pointer.active && !offPointer) offPointer = subscribePointer(pointer);
    if (!pointer.active && offPointer) { offPointer(); offPointer = undefined; }
    if (!running) stopBursts();
  }
  const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting;
    markRectsDirty();
    sync();
  });
  observer?.observe(element);
  const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(markRectsDirty);
  resizeObserver?.observe(element);
  document.addEventListener("visibilitychange", sync);
  sync();
  return engine;
}
