/**
 * Frame-rate independent easing for data-driven props. Each value approaches its target exponentially with time constant
 * `tau` seconds (about 95% of the way after 3·tau), so a prop change mid-transition simply retargets without a jump.
 */

/** One step of exponential approach. `tau <= 0` snaps. */
export const approach = (current: number, target: number, dt: number, tau: number): number =>
  tau <= 0 || !Number.isFinite(current) ? target : target + (current - target) * Math.exp(-Math.max(0, dt) / tau);

/** Values closer than this to their target count as settled and snap. */
export const SETTLE_EPSILON = 1e-4;

/**
 * Eases a record of numbers towards targets. `step` mutates `current` in place and returns true while anything is still
 * moving, so a render loop can stop once everything has settled.
 */
export function stepNumbers<K extends string>(current: Record<K, number>, target: Readonly<Record<K, number>>, dt: number, tau: number): boolean {
  let moving = false;
  for (const key of Object.keys(target) as K[]) {
    const goal = target[key];
    if (!(key in current)) {
      current[key] = goal;
      continue;
    }
    const next = approach(current[key], goal, dt, tau);
    if (Math.abs(next - goal) <= SETTLE_EPSILON * Math.max(1, Math.abs(goal))) current[key] = goal;
    else {
      current[key] = next;
      moving = true;
    }
  }
  return moving;
}

/** Eases a fixed-length vector (a colour in OKLab, for example) towards `target`; same contract as {@link stepNumbers}. */
export function stepVector(current: number[], target: readonly number[], dt: number, tau: number): boolean {
  let moving = false;
  for (let i = 0; i < target.length; i++) {
    const goal = target[i]!;
    const next = current[i] === undefined ? goal : approach(current[i]!, goal, dt, tau);
    if (Math.abs(next - goal) <= SETTLE_EPSILON) current[i] = goal;
    else {
      current[i] = next;
      moving = true;
    }
  }
  return moving;
}
