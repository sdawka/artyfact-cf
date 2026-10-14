/**
 * jsdom gaps React Flow needs (see reactflow.dev "Testing"): element sizes, DOMMatrixReadOnly and
 * SVG getBBox. Import once at the top of Map tests.
 */
class DOMMatrixReadOnlyStub {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([1-9.])\)/)?.[1];
    this.m22 = scale !== undefined ? +scale : 1;
  }
}
globalThis.DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly;

for (const [prop, size] of [["offsetHeight", 600], ["offsetWidth", 900]] as const) {
  if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, `__flow_${prop}`)) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return parseFloat(this.style[prop === "offsetHeight" ? "height" : "width"]) || size;
      },
    });
    Object.defineProperty(HTMLElement.prototype, `__flow_${prop}`, { value: true });
  }
}

// XYPanZoom caches its interpolation extent from this rectangle (not offset sizes).
// jsdom's zero rectangle makes timed d3 zoom frames nonfinite even with valid node offsets.
HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return new DOMRect(0, 0, this.offsetWidth, this.offsetHeight);
};

// Deliver an initial measurement, matching the browser observer contract. Shared render's
// no-op fallback cannot initialize React Flow's measured pane/node extents.
globalThis.ResizeObserver = class {
  private observed = new Set<Element>();
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.observed.add(target);
    queueMicrotask(() => {
      if (!this.observed.has(target)) return;
      const contentRect = target.getBoundingClientRect();
      this.callback([{ target, contentRect } as ResizeObserverEntry], this as unknown as ResizeObserver);
    });
  }
  unobserve(target: Element) { this.observed.delete(target); }
  disconnect() { this.observed.clear(); }
} as unknown as typeof ResizeObserver;

(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox ??= () =>
  ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
