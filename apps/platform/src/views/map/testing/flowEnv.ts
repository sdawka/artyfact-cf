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

(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox ??= () =>
  ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
