/**
 * Seeded per-particle data for the Orb's dust. Positions are not stored: the vertex shader places each particle from its
 * seeds and the current `fill`, so fill and motion ease on the GPU without rebuilding buffers.
 */
import { seeded } from "../color";

/** Particle kinds (the `w` of the second attribute). */
export const DUST_SEDIMENT = 0;
export const DUST_SHELL = 1;
export const DUST_OUTLIER = 2;

/** Share of particles per kind: settled volume, inner-rim shell, sparse outliers. */
export const DUST_MIX = { sediment: 0.6, shell: 0.32, outlier: 0.08 } as const;

/** Number of dust tones in the palette; the last is the pale outlier tone. */
export const DUST_TONES = 5;

export interface DustData {
  count: number;
  /** Per particle: height seed, azimuth seed, radial seed, tone index. */
  place: Float32Array;
  /** Per particle: phase, rate, size seed, kind. */
  motion: Float32Array;
}

/** Tone for a non-outlier particle from a uniform sample: deep, base, light, shifted, with a rare pale one. */
export function dustTone(u: number): number {
  if (u < 0.27) return 0;
  if (u < 0.6) return 1;
  if (u < 0.84) return 2;
  if (u < 0.97) return 3;
  return 4;
}

/** Kind for a uniform sample, following {@link DUST_MIX}. */
export function dustKind(u: number): number {
  if (u < DUST_MIX.sediment) return DUST_SEDIMENT;
  if (u < DUST_MIX.sediment + DUST_MIX.shell) return DUST_SHELL;
  return DUST_OUTLIER;
}

/** Deterministic dust seeds for `count` particles. */
export function buildDust(count: number, seed = 1913): DustData {
  const n = Math.max(0, Math.floor(count));
  const random = seeded(seed);
  const place = new Float32Array(n * 4);
  const motion = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const kind = dustKind(random());
    const o = i * 4;
    place[o] = random();
    place[o + 1] = random();
    place[o + 2] = random();
    place[o + 3] = kind === DUST_OUTLIER ? DUST_TONES - 1 : dustTone(random());
    motion[o] = random();
    motion[o + 1] = random();
    // Mostly fine grains with a few larger flecks.
    motion[o + 2] = Math.pow(random(), 2.2);
    motion[o + 3] = kind;
  }
  return { count: n, place, motion };
}
