/**
 * One set of window pointer listeners shared by every effect on the page. Listeners attach with the first subscriber and
 * detach with the last. Element rects are cached and only re-read after scroll, resize or a subscriber's own resize, and
 * a subscriber only hears about moves while the pointer is over it or has just left it.
 */

export interface PointerSpot {
  /** Position relative to the element's top-left, in CSS px. */
  x: number;
  y: number;
  width: number;
  height: number;
  inside: boolean;
}

export interface PointerSubscriber {
  element: Element;
  /** Set false while the element is offscreen; inactive subscribers are skipped. */
  active: boolean;
  /** Pointer moved while over the element, or has just left it (`inside: false`). */
  onMove?(spot: PointerSpot): void;
  /** Primary pointer pressed anywhere; `spot.inside` says whether it was over the element. */
  onDown?(spot: PointerSpot, event: PointerEvent): void;
  /** Pointer left the window, the window blurred, or a touch ended. */
  onLeave?(): void;
}

interface Entry {
  sub: PointerSubscriber;
  rect: DOMRect | null;
  epoch: number;
  inside: boolean;
}

const entries = new Set<Entry>();
let epoch = 0;
let attached = false;

const rectOf = (e: Entry) => {
  if (!e.rect || e.epoch !== epoch) {
    e.rect = e.sub.element.getBoundingClientRect();
    e.epoch = epoch;
  }
  return e.rect;
};

const spotOf = (e: Entry, ev: PointerEvent): PointerSpot => {
  const r = rectOf(e);
  const x = ev.clientX - r.left;
  const y = ev.clientY - r.top;
  return { x, y, width: r.width, height: r.height, inside: x >= 0 && y >= 0 && x <= r.width && y <= r.height };
};

const onMove = (ev: PointerEvent) => {
  for (const e of entries) {
    if (!e.sub.active) continue;
    const spot = spotOf(e, ev);
    if (spot.inside || e.inside) e.sub.onMove?.(spot);
    e.inside = spot.inside;
  }
};

const onDown = (ev: PointerEvent) => {
  for (const e of entries) {
    if (!e.sub.active) continue;
    const spot = spotOf(e, ev);
    e.inside = spot.inside;
    e.sub.onDown?.(spot, ev);
  }
};

const leaveAll = () => {
  for (const e of entries) {
    if (!e.inside) continue;
    e.inside = false;
    e.sub.onLeave?.();
  }
};

const onOut = (ev: PointerEvent) => {
  if (!ev.relatedTarget) leaveAll();
};
const onUp = (ev: PointerEvent) => {
  if (ev.pointerType === "touch") leaveAll();
};

/** Invalidate cached rects (layout changed). Called on scroll and resize; call it after moving an effect element yourself. */
export const markRectsDirty = () => {
  epoch++;
};

const listen = (on: boolean) => {
  const fn = on ? window.addEventListener.bind(window) : window.removeEventListener.bind(window);
  fn("pointermove", onMove as EventListener, { passive: true });
  fn("pointerdown", onDown as EventListener, { passive: true });
  fn("pointerout", onOut as EventListener, { passive: true });
  fn("pointerup", onUp as EventListener, { passive: true });
  fn("blur", leaveAll);
  fn("scroll", markRectsDirty, { passive: true, capture: true });
  fn("resize", markRectsDirty, { passive: true });
  attached = on;
};

/** Registers a subscriber; returns the unsubscribe function. No-op without a window (SSR). */
export function subscribePointer(sub: PointerSubscriber): () => void {
  if (typeof window === "undefined") return () => {};
  const entry: Entry = { sub, rect: null, epoch: -1, inside: false };
  entries.add(entry);
  if (!attached) listen(true);
  return () => {
    entries.delete(entry);
    if (!entries.size && attached) listen(false);
  };
}

/** Number of live subscribers and whether the window listeners are attached (tests and diagnostics). */
export const pointerRegistryState = () => ({ subscribers: entries.size, attached });
