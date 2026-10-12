/**
 * Orb palette: every tone the Orb draws with, derived from one base colour in OKLCh so lightness steps look even
 * across hues. Dark theme tones are light (they glow additively); light theme tones are dark inks.
 */
import { clamp, fromOklab, toOklab, type Rgb } from "../color";

export type OrbTheme = "dark" | "light";

export interface OrbPalette {
  /** Rim filaments. */
  rim: Rgb;
  /** Hottest rim core and surge highlights. */
  hot: Rgb;
  /** Soft outer halo and flares. */
  halo: Rgb;
  /** Interior haze pool. */
  haze: Rgb;
  /** Spark arcs. */
  spark: Rgb;
  /** Dust tones: deep, base, light, hue-shifted, and a pale tone for sparse outliers. */
  dust: readonly [Rgb, Rgb, Rgb, Rgb, Rgb];
}

type Lch = [number, number, number];

const toLch = (rgb: Rgb): Lch => {
  const [L, a, b] = toOklab(rgb);
  const C = Math.hypot(a, b);
  const H = C < 1e-5 ? 0 : (Math.atan2(b, a) * 180) / Math.PI;
  return [L, C, (H + 360) % 360];
};

const fromLch = ([L, C, H]: Lch): Rgb => {
  const h = (H * Math.PI) / 180;
  return fromOklab([clamp(L, 0, 1), Math.max(0, C) * Math.cos(h), Math.max(0, C) * Math.sin(h)]);
};

/** `rgb` moved by `dL` lightness, scaled by `cScale` chroma and rotated by `dH` degrees, in OKLCh. */
export function shift(rgb: Rgb, dL = 0, cScale = 1, dH = 0): Rgb {
  const [L, C, H] = toLch(rgb);
  return fromLch([L + dL, C * cScale, H + dH]);
}

/** Mix of `a` and `b` in OKLab; `t` 0 gives `a`, 1 gives `b`. */
export function blend(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp(t, 0, 1);
  const la = toOklab(a);
  const lb = toOklab(b);
  return fromOklab([la[0] + (lb[0] - la[0]) * k, la[1] + (lb[1] - la[1]) * k, la[2] + (lb[2] - la[2]) * k]);
}

/** The full palette for a base colour (gamma sRGB 0..1). */
export function buildPalette(color: Rgb, theme: OrbTheme = "dark"): OrbPalette {
  const [L, C, H] = toLch(color);
  // Keep near-greys from blowing up when scaled, and very saturated inputs inside a pleasant range.
  const c = Math.min(C, 0.2);
  const at = (l: number, cs: number, dh = 0) => fromLch([l, c * cs, H + dh]);
  if (theme === "light") {
    const ink = clamp(L * 0.42, 0.2, 0.36);
    return {
      rim: at(ink, 1.1),
      hot: at(ink - 0.08, 0.9),
      halo: at(ink + 0.18, 1),
      haze: at(ink + 0.24, 0.9, 4),
      spark: at(ink - 0.1, 0.8),
      dust: [at(ink - 0.06, 1.1, -6), at(ink + 0.06, 1), at(ink + 0.16, 0.9, 6), at(ink + 0.08, 0.9, 22), at(ink + 0.3, 0.5)],
    };
  }
  const mid = clamp(L, 0.55, 0.85);
  return {
    rim: at(Math.max(mid + 0.06, 0.8), 0.9),
    hot: at(0.97, 0.3),
    halo: at(mid, 1.1),
    haze: at(mid - 0.08, 1.15, 4),
    spark: at(0.98, 0.22),
    dust: [at(mid - 0.12, 1.15, -6), at(mid, 1), at(Math.min(0.93, mid + 0.09), 0.85, 6), at(mid + 0.02, 0.9, 22), at(0.94, 0.3)],
  };
}
