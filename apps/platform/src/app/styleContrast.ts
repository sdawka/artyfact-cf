/** WCAG contrast for the /style swatches, from computed `oklch(L C H [/ a])` colours (alpha composited over `bg`). */
type Rgb = [number, number, number];

export function parseOklch(css: string): { l: number; c: number; h: number; a: number } | null {
  const m = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+|none)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)/.exec(css);
  if (!m) return null;
  const l = Number(m[1]) / (m[2] ? 100 : 1);
  const a = m[5] === undefined ? 1 : Number(m[5]) / (m[6] ? 100 : 1);
  return { l, c: Number(m[3]), h: m[4] === "none" ? 0 : Number(m[4]), a };
}

/** OKLCH to linear-light sRGB (Björn Ottosson's OKLab matrices), clamped to gamut. */
export function oklchToLinear(l: number, c: number, h: number): Rgb {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr), B = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Contrast ratio of `fg` on `bg` (both computed oklch strings); null when either does not parse. */
export function contrast(fg: string, bg: string): number | null {
  const f = parseOklch(fg), b = parseOklch(bg);
  if (!f || !b) return null;
  const bl = oklchToLinear(b.l, b.c, b.h);
  // Alpha compositing in linear light is close enough for a reference swatch.
  const fl = oklchToLinear(f.l, f.c, f.h).map((v, i) => v * f.a + bl[i]! * (1 - f.a)) as Rgb;
  const [hi, lo] = [luminance(fl), luminance(bl)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
