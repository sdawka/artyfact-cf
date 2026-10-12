import type { ChoiceAnswer, Verdict } from './types';

/** Never green under threshold: anything between failAt and passAt is `unknown`. */
export function verdict(p: number | null | undefined, o: { passAt?: number; failAt?: number } = {}): Verdict {
  const { passAt = 0.9, failAt = 0.1 } = o;
  if (typeof p !== 'number' || Number.isNaN(p)) return 'unknown';
  if (p >= passAt) return 'pass';
  if (p <= failAt) return 'fail';
  return 'unknown';
}

export type Band = 'act' | 'review' | 'abstain';
export function band(p: number): Band {
  return p >= 0.9 ? 'act' : p >= 0.5 ? 'review' : 'abstain';
}

export const UNRESOLVED = 'unresolved-interpretation';

/** The chosen option, or 'unresolved-interpretation' when confidence is under the minimum. */
export function choiceOutcome(a: Pick<ChoiceAnswer, 'choice' | 'confidence'>, o: { minConfidence?: number } = {}): string {
  const { minConfidence = 0.5 } = o;
  return a.confidence < minConfidence ? UNRESOLVED : a.choice;
}
