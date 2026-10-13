/**
 * Colour maths shared by the effects: CSS colour parsing (pure, so oklch() works without a canvas) and OKLab
 * conversions (Björn Ottosson's published OKLab matrices). Every colour here is gamma-encoded sRGB in 0..1, as the
 * shaders expect.
 */

export type Rgb = readonly [number, number, number];
type Lab = [number, number, number];

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
export const smooth = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Gamma sRGB to OKLab. */
export function toOklab(rgb: Rgb): Lab {
  const [r, g, b] = rgb.map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to gamma sRGB, clipped to the sRGB gamut. */
export function fromOklab([L, a, b]: readonly [number, number, number]): Rgb {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => clamp(toGamma(clamp(v, 0, 1)), 0, 1)) as unknown as Rgb;
}

/** oklch(L C H) to gamma sRGB. `L` 0..1, `H` in degrees. */
export const fromOklch = (L: number, C: number, H: number): Rgb => {
  const h = (H * Math.PI) / 180;
  return fromOklab([L, C * Math.cos(h), C * Math.sin(h)]);
};

const num = (token: string, percentScale = 1): number => {
  const t = token.trim();
  if (t === "none") return 0;
  if (t.endsWith("%")) return (parseFloat(t) / 100) * percentScale;
  if (t.endsWith("deg")) return parseFloat(t);
  if (t.endsWith("turn")) return parseFloat(t) * 360;
  if (t.endsWith("rad")) return (parseFloat(t) * 180) / Math.PI;
  return parseFloat(t);
};

/** `fn(a b c / alpha)` or `fn(a, b, c, alpha)` → the three channel tokens. */
const channels = (body: string): string[] => body.split("/")[0]!.trim().split(/[\s,]+/).filter(Boolean).slice(0, 3);

/**
 * Parses a CSS colour without the DOM: hex, `rgb()`/`rgba()`, `oklch()`, `oklab()` and `color(srgb …)`.
 * Returns null for anything else (named colours, `hsl()`, relative colour syntax); {@link parseColor} then asks the browser.
 */
export function parseCssColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = parseInt(h.slice(0, 6), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const fn = /^([a-z-]+)\((.*)\)$/.exec(value);
  if (!fn) return null;
  const [, name, body] = fn as unknown as [string, string, string];
  if (body.includes("from ") || body.includes("var(") || body.includes("calc(")) return null;
  const parts = channels(body);
  if (name === "color") {
    const [space, ...rest] = body.split("/")[0]!.trim().split(/\s+/);
    if (space !== "srgb" || rest.length < 3) return null;
    const rgb = rest.slice(0, 3).map((t) => clamp(num(t), 0, 1));
    return rgb.some(Number.isNaN) ? null : (rgb as unknown as Rgb);
  }
  if (parts.length < 3) return null;
  let out: Rgb | null = null;
  if (name === "rgb" || name === "rgba") {
    out = parts.map((t) => clamp(num(t, 255) / 255, 0, 1)) as unknown as Rgb;
  } else if (name === "oklch") {
    out = fromOklch(clamp(num(parts[0]!), 0, 1), Math.max(0, num(parts[1]!, 0.4)), num(parts[2]!));
  } else if (name === "oklab") {
    out = fromOklab([clamp(num(parts[0]!), 0, 1), num(parts[1]!, 0.4), num(parts[2]!, 0.4)]);
  }
  return out && !out.some(Number.isNaN) ? out : null;
}

/** Resolves `var(--name)` against the document root; returns the input unchanged without a DOM. */
function resolveVar(value: string): string {
  const v = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim());
  if (!v) return value;
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return v[2] ?? value;
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(v[1]!).trim();
  return resolved || v[2] || value;
}

let probe: CanvasRenderingContext2D | null | undefined;

/**
 * Any CSS colour string to gamma sRGB 0..1. Pure parsing first ({@link parseCssColor}); otherwise the browser's canvas
 * resolves it (named colours, `hsl()`). The canvas result is parsed again because Chromium serialises wide-gamut inputs
 * such as `oklch()` back as `oklch(...)`/`color(...)` rather than hex, which a naive rgb regex misreads.
 * Returns `fallback` when nothing can resolve the string (for example in Node or jsdom).
 */
export function parseColor(value: string, fallback: Rgb): Rgb {
  const input = resolveVar(value);
  const direct = parseCssColor(input);
  if (direct) return direct;
  try {
    if (typeof document === "undefined" || typeof CanvasRenderingContext2D === "undefined") return fallback;
    if (probe === undefined) probe = document.createElement("canvas").getContext("2d");
    if (!probe) return fallback;
    probe.fillStyle = "#000000";
    probe.fillStyle = input;
    return parseCssColor(String(probe.fillStyle)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Deterministic PRNG (mulberry32, public domain), so seeded layouts are the same on every load. */
export const seeded = (start: number) => {
  let state = start >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
