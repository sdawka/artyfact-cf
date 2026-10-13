import type { Level } from "../evaluate/findings.ts";
import type { Question } from "../meta/schema.ts";
import type { Answer, JudgmentStatus, Thresholds } from "./types.ts";

export const DEFAULT_THRESHOLDS: Thresholds = { confident: 0.9, review: 0.5 };

export function thresholdsOf(t: Partial<Thresholds> = {}): Thresholds {
  const out = { ...DEFAULT_THRESHOLDS, ...t };
  if (!(0 <= out.review && out.review <= out.confident && out.confident <= 1)) throw new RangeError("thresholds need 0 <= review <= confident <= 1");
  return out;
}

/** Policy answers compare as strings; booleans read as yes and no. */
export const answerKey = (v: string | number | boolean): string => (v === true ? "yes" : v === false ? "no" : String(v));

export const band = (confidence: number, t: Thresholds): JudgmentStatus =>
  confidence >= t.confident ? "confident" : confidence >= t.review ? "review" : "unknown";

export interface Reading { answer: string; confidence: number; probabilities: Record<string, number> }

/**
 * The provider's answer to `q` as a policy key, the probability behind it and the distribution over keys (noul reads
 * as `{yes, no}`), or undefined when it does not fit the answer type.
 */
export function readAnswer(q: Question, a: Answer | undefined): Reading | undefined {
  const ok = (x: unknown): x is number => typeof x === "number" && !Number.isNaN(x);
  const dist = (p: unknown): Record<string, number> =>
    p && typeof p === "object" ? Object.fromEntries(Object.entries(p).filter(([, v]) => ok(v))) as Record<string, number> : {};
  if (q.answer === "yes-no" && a?.type === "noul" && ok(a.noul)) {
    const probabilities = { yes: a.noul, no: 1 - a.noul };
    return a.noul >= 0.5 ? { answer: "yes", confidence: a.noul, probabilities } : { answer: "no", confidence: 1 - a.noul, probabilities };
  }
  if (q.answer === "choice" && a?.type === "choice" && ok(a.confidence)) return { answer: a.choice, confidence: a.confidence, probabilities: dist(a.probabilities) };
  if (q.answer === "score" && a?.type === "score" && ok(a.confidence)) return { answer: String(a.score), confidence: a.confidence, probabilities: dist(a.probabilities) };
  return undefined;
}

export interface Decision {
  status: JudgmentStatus;
  level: Level;
  answer?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  /** The defect the answer stands for: the policy entry's `defect`, else the question's. */
  defect?: string;
}

/** Policy answer that matches any answer no other entry names. */
export const ANY_ANSWER = "*";

type PolicyEntry = Question["policy"][number];
const numeric = (q: Question) => q.policy.map((p) => [Number(answerKey(p.answer)), p] as const).filter(([n]) => Number.isInteger(n));

/**
 * The lowest passing score of a `score` question for a subject kind: `passFrom[kind]` when set, else the lowest
 * score the policy maps to `pass` (3 when none does). The funnel's `scoreConfidence` uses the same boundary.
 */
export function passFromOf(q: Question, kind?: string): number {
  const own = kind === undefined ? undefined : q.passFrom?.[kind];
  if (own !== undefined) return own;
  const passing = numeric(q).filter(([, p]) => p.level === "pass").map(([n]) => n);
  return passing.length ? Math.min(...passing) : 3;
}

/**
 * The policy entry for an answer: the exact one, else `"*"`. A score question with a `passFrom` override for `kind`
 * reads the boundary from it: at or above it the first passing entry applies, below it the score's own entry when that
 * one does not pass, else the passing entry's nearest non-passing neighbour below.
 */
export function policyEntry(q: Question, answer: string, kind?: string): PolicyEntry | undefined {
  const exact = q.policy.find((p) => answerKey(p.answer) === answer) ?? q.policy.find((p) => answerKey(p.answer) === ANY_ANSWER);
  if (q.answer !== "score" || kind === undefined || q.passFrom?.[kind] === undefined) return exact;
  const score = Number(answer);
  if (!Number.isFinite(score)) return exact;
  const from = passFromOf(q, kind);
  const sorted = numeric(q).sort((x, y) => x[0] - y[0]);
  if (score >= from) return exact?.level === "pass" ? exact : sorted.find(([, p]) => p.level === "pass")?.[1] ?? exact;
  if (exact && exact.level !== "pass") return exact;
  return [...sorted].reverse().find(([n, p]) => p.level !== "pass" && n <= score)?.[1] ?? sorted.find(([, p]) => p.level !== "pass")?.[1] ?? exact;
}

/**
 * Unknown never passes: an unreadable answer, one below `review`, or one the policy does not map is `unknown` at `info`.
 * Between `review` and `confident` is `review`. At or above `confident` the policy's level applies. `kind` is the
 * subject's kind, read only by score questions with a `passFrom` override.
 */
export function decide(q: Question, a: Answer | undefined, t: Thresholds, kind?: string): Decision {
  const r = readAnswer(q, a);
  if (!r) return { status: "unknown", level: "info" };
  const entry = policyEntry(q, r.answer, kind);
  const status = entry ? band(r.confidence, t) : "unknown";
  const level: Level = status === "confident" ? (entry!.level as Level) : status === "review" ? "review" : "info";
  const defect = entry?.defect ?? q.defect;
  return { status, level, ...r, ...(defect !== undefined && { defect }) };
}

/** Probability mass on answers other than the question's benign one, from a reading's distribution. */
export function harmOf(q: Question, r: Pick<Reading, "probabilities"> | undefined): number | undefined {
  if (!r) return undefined;
  const benign = answerKey(q.benign);
  const entries = Object.entries(r.probabilities);
  if (!entries.length) return undefined;
  const total = entries.reduce((s, [, p]) => s + p, 0);
  return total > 0 ? entries.filter(([k]) => k !== benign).reduce((s, [, p]) => s + p, 0) / total : undefined;
}

export interface Combined { status: JudgmentStatus; harmful?: boolean; confidence: number }

/**
 * Two questions of opposite polarity asked about the same thing (for example "can all of these hold?" and "is any of
 * these inconsistent?"), each given as the probability that its answer is the harmful one.
 *
 * - Both lean harmful: harmful, with the agreement (noisy-or) as confidence, banded.
 * - Both lean benign: benign likewise; a pass therefore needs both to agree.
 * - They disagree: `review` on the stronger side when that side alone is confident, else `unknown`.
 * - One unreadable: the other's side, at most `review`. Both unreadable: `unknown`.
 */
export function combine(a: number | undefined, b: number | undefined, t: Thresholds): Combined {
  if (a === undefined && b === undefined) return { status: "unknown", confidence: 0 };
  if (a === undefined || b === undefined) {
    const h = (a ?? b)!;
    const harmful = h >= 0.5;
    const confidence = harmful ? h : 1 - h;
    const status = band(confidence, t);
    return { status: status === "confident" ? "review" : status, ...(status !== "unknown" && { harmful }), confidence };
  }
  const ha = a >= 0.5, hb = b >= 0.5;
  if (ha === hb) {
    const [pa, pb] = ha ? [a, b] : [1 - a, 1 - b];
    const confidence = 1 - (1 - pa) * (1 - pb);
    const status = band(confidence, t);
    return { status, ...(status !== "unknown" && { harmful: ha }), confidence };
  }
  const [sa, sb] = [ha ? a : 1 - a, hb ? b : 1 - b];
  const strong = sa >= sb ? { harmful: ha, p: sa } : { harmful: hb, p: sb };
  return strong.p >= t.confident ? { status: "review", harmful: strong.harmful, confidence: strong.p } : { status: "unknown", confidence: strong.p };
}

/**
 * For a score answer: the probability mass on the chosen side of the pass boundary, where levels at or above
 * `passFrom` pass. The chosen side is the side of `score`, by default the most probable level.
 */
export function scoreConfidence(probabilities: Record<string, number>, passFrom: number, score?: number): number {
  const entries = Object.entries(probabilities).map(([k, p]) => [Number(k), p] as const).filter(([k, p]) => Number.isFinite(k) && Number.isFinite(p));
  const total = entries.reduce((s, [, p]) => s + p, 0);
  if (!entries.length || total <= 0) return 0;
  const chosen = score ?? entries.reduce((best, e) => (e[1] > best[1] ? e : best))[0];
  const passes = chosen >= passFrom;
  return entries.filter(([k]) => (k >= passFrom) === passes).reduce((s, [, p]) => s + p, 0) / total;
}
