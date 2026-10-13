import type { Question } from "../meta/schema.ts";
import { answerKey } from "./policy.ts";
import type { S1Question } from "./types.ts";

const cap = (s: string, n = 255) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Wording for one subject kind, from the ontology's kind criteria: what to call it, what a genuine instance is, what a
 * grounded one names, what makes it checkable, what its children must jointly satisfy, what a compatible pair of
 * them looks like, and what its description must say about them. Each is a sentence or empty.
 */
export interface KindWording {
  noun: string; instanceOf?: string; grounded?: string; testable?: string; children?: string; pairs?: string; summary?: string;
  /** The kind's own `pairs` criterion: what a compatible pair of its children looks like. Not a token; see `toWire`. */
  childPairs?: string;
}
const OPTIONAL = ["instanceOf", "grounded", "testable", "children", "pairs", "summary"] as const;

/** `byKind[kind]` as wording: a JSON object `{noun, ...}` (see `KindWording`) when it parses as one, else a plain noun. */
export function kindWording(q: Question, kind?: string): KindWording {
  const raw = kind === undefined ? undefined : q.byKind?.[kind];
  if (raw === undefined) return { noun: kind ?? "item" };
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as KindWording).noun === "string") {
      const w = v as Record<string, unknown>;
      return {
        noun: w.noun as string, ...Object.fromEntries(OPTIONAL.filter((k) => typeof w[k] === "string").map((k) => [k, w[k]])),
        ...(typeof w.childPairs === "string" && { childPairs: w.childPairs }),
      };
    }
  } catch { /* a plain noun */ }
  return { noun: raw };
}

/**
 * Kind tokens take the subject kind's wording; root tokens (`{sections}`, `{terms}`) are filled from the template's
 * root criteria when the catalogue is built, so any left here are blanked.
 */
export const WIRE_TOKENS = ["noun", ...OPTIONAL, "sections", "terms"] as const;
const PLACEHOLDER = new RegExp(`\\{(${WIRE_TOKENS.join("|")})\\}`, "g");
const HAS_PLACEHOLDER = new RegExp(PLACEHOLDER.source);
/** Text without placeholders is returned unchanged; an empty placeholder leaves no double space behind. */
export const fillTokens = (s: string, w: Partial<Record<(typeof WIRE_TOKENS)[number], string>>): string =>
  !HAS_PLACEHOLDER.test(s) ? s
    : s.replace(PLACEHOLDER, (_, k: (typeof WIRE_TOKENS)[number]) => w[k] ?? "").replace(/[ \t]{2,}/g, " ").trim();
const fill = (s: string, w: KindWording): string => fillTokens(s, w as unknown as Record<string, string>);

/** Options resolved per subject for a `choicesFrom` question: ids in order, or ids mapped to their criteria. */
export type ResolvedChoices = readonly string[] | Readonly<Record<string, string>>;

/**
 * The catalogue entry as a System One question; `benign` stays on for the fake provider and is stripped on the wire.
 * A yes-no question with exactly two `choices` sends them as the `true` and `false` criteria. A choice question sends
 * each option's `criteria` entry (else the option key) as its criterion. The `WIRE_TOKENS` in the text, choices and
 * criteria take the subject kind's wording (see `kindWording`), so the same question hashes differently per kind. A `choicesFrom` question takes its options from `resolved` (the funnel passes the subject's
 * members or the sections), followed by its declared `choices`.
 *
 * `parentKind` is the kind of the node a pair was drawn under (the set, or the root for section pairs). Its own
 * `childPairs` criterion, when it has one, fills `{pairs}` in place of the subject kind's inherited wording.
 */
export function toWire(q: Question, kind?: string, resolved?: ResolvedChoices, parentKind?: string): S1Question {
  const own = kindWording(q, kind);
  const fromParent = parentKind === undefined ? undefined : kindWording(q, parentKind).childPairs;
  const w = fromParent ? { ...own, pairs: fromParent } : own;
  const instructions = fill(q.text ?? `Judge ${q.id} for state.subject, given state.candidate.`, w);
  const choices = q.choices?.map((c) => fill(c, w));
  if (q.answer === "yes-no") {
    const [yes, no] = choices?.length === 2 ? choices : [`Yes: ${instructions}`, `No: ${instructions}`];
    return {
      type: "noul", instructions,
      criteria: { true: cap(yes!), false: cap(no!) },
      benign: answerKey(q.benign) === "no" ? "no" : "yes",
    };
  }
  if (q.answer === "choice") {
    // Option keys stay the declared (or resolved) choices; only the criteria text is worded per kind.
    const dynamic: [string, string][] = !q.choicesFrom || !resolved ? []
      : Array.isArray(resolved) ? (resolved as readonly string[]).map((id) => [id, id])
        : Object.entries(resolved as Record<string, string>);
    const declared: [string, string][] = (q.choices ?? []).map((c, i) => [c, fill(q.criteria?.[c] ?? choices![i]!, w)]);
    const options = [...dynamic, ...declared.filter(([k]) => !dynamic.some(([d]) => d === k))];
    return { type: "choice", instructions, criteria: Object.fromEntries(options.map(([k, c]) => [k, cap(c)])), benign: String(q.benign) };
  }
  const benign = Number(q.benign);
  return { type: "score", instructions, criteria: (choices ?? []).map((c) => cap(c)), ...(Number.isInteger(benign) && { benign }) };
}
