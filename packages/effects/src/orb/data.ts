/*
 * Adapted from the Crystalized Ball component in React Bits (https://github.com/DavidHDev/react-bits).
 * Copyright (c) 2026 David Haz. Licensed under MIT + Commons Clause License Condition v1.0, NOT Apache-2.0:
 * use inside an application, website or product only; do not sell, sublicense or redistribute this component on its
 * own, in a bundle or as a ported version. Full text: THIRD_PARTY_NOTICES.md.
 */
import { seeded, smooth } from "../color";

export const MAX_STRANDS = 8;
export const MAX_ARCS = 4;
export const MAX_PARTICLES = 40000;
/** Width of the particle state textures; particle `i` lives at texel (i % W, i / W). */
export const STATE_WIDTH = 256;

export interface StrandData {
  harmonics: number[];
  rates: number[];
  phases: number[];
  flareHarmonics: number[];
  flareRates: number[];
  flarePhases: number[];
}

/** Per-strand rim harmonics (four bands) and flare parameters, packed as vec4[8] uniforms. Deterministic. */
export function buildStrands(): StrandData {
  const random = seeded(99);
  const bands: [number, number, number, number][] = [
    [6, 12, 0.6, 1.6],
    [18, 34, 1.5, 3.5],
    [40, 70, 3, 7],
    [80, 130, 6, 12],
  ];
  const data: StrandData = { harmonics: [], rates: [], phases: [], flareHarmonics: [], flareRates: [], flarePhases: [] };
  for (let s = 0; s < MAX_STRANDS; s++) {
    for (const [low, high, slow, fast] of bands) {
      data.harmonics.push(Math.round(low + random() * (high - low)));
      data.rates.push((slow + random() * (fast - slow)) * (random() < 0.5 ? -1 : 1));
      data.phases.push(random() * Math.PI * 2);
    }
    for (let j = 0; j < 3; j++) {
      data.flareHarmonics.push(4 + Math.floor(random() * 6));
      data.flareRates.push((0.4 + random() * 0.8) * (random() < 0.5 ? -1 : 1));
      data.flarePhases.push(random() * Math.PI * 2);
    }
    const lead = s === 0;
    data.flareHarmonics.push(lead ? 0.75 : 0.95 + random() * 0.3);
    data.flareRates.push(lead ? 1.15 : 0.8 + random() * 0.2);
    data.flarePhases.push(lead ? 1 : 0.7 + random() * 0.25);
  }
  return data;
}

export interface DustData {
  /** xyz home position in the unit ball, w = tone index 0..4. */
  home: Float32Array;
  /** x size, y phase, z lifetime period, w travel. */
  seed: Float32Array;
  count: number;
  rows: number;
}

/** Dust home positions: a bowl at the bottom plus a band under the rim, rejection-sampled. Deterministic. */
export function buildDust(count: number): DustData {
  const random = seeded(1337);
  const rows = Math.max(1, Math.ceil(count / STATE_WIDTH));
  const home = new Float32Array(STATE_WIDTH * rows * 4);
  const seed = new Float32Array(STATE_WIDTH * rows * 4);
  let k = 0;
  let guard = 0;
  while (k < count && guard < count * 80) {
    guard++;
    let x: number;
    let y: number;
    let tone: number;
    if (random() < 0.28) {
      const angle = random() * Math.PI * 2;
      const radius = 0.87 + Math.sqrt(random()) * 0.105;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius;
      if (random() > smooth(-0.6, 0.3, -y)) continue;
      const q = random();
      tone = q < 0.5 ? 3 : q < 0.8 ? 2 : 1;
    } else {
      x = random() * 2 - 1;
      y = random() * 2 - 1;
      const radius = Math.hypot(x, y);
      if (radius > 0.975) continue;
      const bowl = Math.pow(smooth(-0.25, 0.85, -y), 1.3);
      const band = smooth(0.66, 0.96, radius) * smooth(-0.7, 0.3, -y);
      const weight = Math.max(bowl, band * 0.9);
      if (random() > 0.012 + 0.988 * weight) continue;
      if (weight < 0.12) tone = 4;
      else {
        const q = random();
        tone = q < 0.32 ? 0 : q < 0.52 ? 1 : q < 0.8 ? 2 : 3;
      }
    }
    const chord = Math.sqrt(Math.max(0, 0.95 - x * x - y * y));
    home[k * 4] = x;
    home[k * 4 + 1] = y;
    home[k * 4 + 2] = (random() * 2 - 1) * chord;
    home[k * 4 + 3] = tone;
    seed[k * 4] = tone === 4 ? 1.8 : random() < 0.22 ? 2.1 : 1.3;
    seed[k * 4 + 1] = random();
    seed[k * 4 + 2] = 2.5 + random() * 3.5;
    seed[k * 4 + 3] = 0.16 + random() * 0.26;
    k++;
  }
  return { home, seed, count: k, rows };
}
