/*
 * Adapted from the Crystalized Ball component in React Bits (https://github.com/DavidHDev/react-bits).
 * Copyright (c) 2026 David Haz. Licensed under MIT + Commons Clause License Condition v1.0, NOT Apache-2.0:
 * use inside an application, website or product only; do not sell, sublicense or redistribute this component on its
 * own, in a bundle or as a ported version. Full text: THIRD_PARTY_NOTICES.md.
 */

/** The Orb's palette: one base colour expanded into rim, spark, haze and dust tones in OKLab. */
import { clamp, fromOklab, toOklab, type Rgb } from "../color";

const WHITE: Rgb = [1, 1, 1];
const BLACK: Rgb = [0, 0, 0];

export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const wrapAngle = (a: number) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
export const mixColor = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Mix in OKLab. */
export const blend = (a: Rgb, b: Rgb, t: number): Rgb => {
  const la = toOklab(a);
  const lb = toOklab(b);
  return fromOklab([la[0] + (lb[0] - la[0]) * t, la[1] + (lb[1] - la[1]) * t, la[2] + (lb[2] - la[2]) * t]);
};

/** Rotate hue (degrees), offset lightness and scale chroma in OKLCh. */
export const shift = (rgb: Rgb, hue: number, lightness: number, chroma: number): Rgb => {
  const [L, a, b] = toOklab(rgb);
  const c = Math.hypot(a, b) * chroma;
  const h = Math.atan2(b, a) + (hue * Math.PI) / 180;
  return fromOklab([clamp(L + lightness, 0, 1), c * Math.cos(h), c * Math.sin(h)]);
};

/** Same hue (rotated by `hue`), absolute `lightness`, chroma scaled with a floor so greys keep a tint. */
export const withLightness = (rgb: Rgb, hue: number, lightness: number, chroma: number): Rgb => {
  const [, a, b] = toOklab(rgb);
  const c = Math.max(Math.hypot(a, b) * chroma, 0.02);
  const h = Math.atan2(b, a) + (hue * Math.PI) / 180;
  return fromOklab([clamp(lightness, 0, 1), c * Math.cos(h), c * Math.sin(h)]);
};

/** The Orb's derived colours: rim layers, spark arcs, haze, edge, and five dust tones. */
export interface OrbPalette {
  rim: Rgb;
  rimHot: Rgb;
  rimMid: Rgb;
  rimDeep: Rgb;
  spark: Rgb;
  sparkGlow: Rgb;
  haze: Rgb;
  edge: Rgb;
  tones: [Rgb, Rgb, Rgb, Rgb, Rgb];
}

/** Builds the palette from one base colour, as in the reference. `light` targets light backgrounds (ink, not light). */
export function buildPalette(color: Rgb, light = false): OrbPalette {
  if (light) {
    const ink = withLightness(color, 0, Math.min(toOklab(color)[0], 0.62), 1.15);
    return {
      rim: ink,
      rimHot: ink,
      rimMid: ink,
      rimDeep: withLightness(color, 0, 0.72, 0.8),
      spark: withLightness(color, 0, 0.6, 1.2),
      sparkGlow: withLightness(color, 0, 0.78, 0.8),
      haze: withLightness(color, 0, 0.8, 0.6),
      edge: withLightness(color, 0, 0.72, 0.8),
      tones: [
        withLightness(color, 0, 0.56, 1.1),
        withLightness(color, 16, 0.6, 1.05),
        withLightness(color, -16, 0.5, 1.1),
        withLightness(color, 0, 0.66, 0.9),
        withLightness(color, 0, 0.74, 0.7),
      ],
    };
  }
  return {
    rim: color,
    rimHot: mixColor(color, WHITE, 0.72),
    rimMid: mixColor(color, BLACK, 0.15),
    rimDeep: mixColor(color, BLACK, 0.45),
    spark: mixColor(color, WHITE, 0.45),
    sparkGlow: shift(color, 0, -0.15, 1),
    haze: mixColor(color, BLACK, 0.6),
    edge: shift(color, 0, -0.3, 0.9),
    tones: [
      shift(color, 0, -0.06, 1),
      shift(color, 16, -0.02, 1),
      shift(color, -16, -0.12, 1.05),
      shift(blend(color, WHITE, 0.25), 0, 0.04, 1),
      blend(color, WHITE, 0.7),
    ],
  };
}

