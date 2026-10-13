/**
 * Cheap lexical pre-filters, ported from lfp `find-contradictions`. They only order and cap candidate pairs and pick
 * terms for the funnel; they never produce or suppress a finding on their own.
 */

const STOP = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "of", "to", "in", "on", "at", "by", "for", "with", "from",
  "as", "is", "are", "was", "were", "be", "been", "being", "it", "its", "this", "that", "these", "those", "there", "their",
  "they", "them", "we", "our", "us", "you", "your", "he", "she", "his", "her", "i", "me", "my", "so", "not", "no", "do",
  "does", "did", "can", "could", "should", "would", "will", "shall", "may", "might", "must", "never", "always", "only",
  "all", "every", "any", "each", "at", "most", "least", "require", "requires", "required", "forbid", "forbids",
  "forbidden", "into", "than", "when", "where", "which", "who", "what", "how", "has", "have", "had", "also", "about",
]);

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
/** Lower-cased words with stop and modal words removed. */
export const contentWords = (s: string): Set<string> => new Set(words(s).filter((w) => !STOP.has(w) && w.length > 1));

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (!a.size && !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
};

const NEGATIVE = /\b(never|must not|mustn't|may not|cannot|can't|shall not|only|at most|forbids?|forbidden|prohibit(?:s|ed)?)\b/i;
const POSITIVE = /\b(always|must|all|every|requires?|required|at least)\b/i;
const polarity = (s: string): { neg: boolean; pos: boolean } => {
  const neg = NEGATIVE.test(s);
  // "must not" is negative only; strip the negative phrases before looking for a positive modal.
  const pos = POSITIVE.test(s.replace(new RegExp(NEGATIVE.source, "gi"), " "));
  return { neg, pos };
};

/**
 * One statement uses a restrictive modal (never, must not, only, at most, forbid) where the other uses a mandatory
 * one (always, must, all, every, require), and they share at least two content words. Returns 0 when they do not
 * clash, else 0.5 plus half the content-word Jaccard, so any clash ranks above a near-duplicate.
 */
export function modalClash(a: string, b: string): number {
  const pa = polarity(a), pb = polarity(b);
  if (!((pa.neg && pb.pos) || (pb.neg && pa.pos))) return 0;
  const wa = contentWords(a), wb = contentWords(b);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared >= 2 ? 0.5 + 0.5 * jaccard(wa, wb) : 0;
}

export interface Texted { title?: unknown; description?: unknown }
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Title Jaccard of at least 0.6 or description Jaccard of at least 0.5; returns the larger Jaccard, else 0. */
export function sameThing(a: Texted, b: Texted): number {
  const t = str(a.title) && str(b.title) ? jaccard(contentWords(str(a.title)), contentWords(str(b.title))) : 0;
  const d = str(a.description) && str(b.description) ? jaccard(contentWords(str(a.description)), contentWords(str(b.description))) : 0;
  return t >= 0.6 || d >= 0.5 ? Math.max(t, d) : 0;
}

const QUOTED = /"([^"]{2,60})"|“([^”]{2,60})”|'([^']{2,60})'|`([^`]{2,60})`/g;
const CAPITAL = /\b[A-Z][\p{L}\p{N}-]*[\p{L}\p{N}]\b/gu;

/** Capitalised or quoted terms of one text, lower-cased; the first word of a sentence counts only when it is not a stop word. */
export function termsOf(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(QUOTED)) out.add((m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim().toLowerCase());
  const bare = s.replace(QUOTED, " ");
  for (const m of bare.matchAll(CAPITAL)) {
    const w = m[0].toLowerCase();
    if (!STOP.has(w) && w.length > 2) out.add(w);
  }
  out.delete("");
  return out;
}

/** Capitalised or quoted terms both texts use, sorted. */
export function sharedTerms(a: string, b: string): string[] {
  const tb = termsOf(b);
  return [...termsOf(a)].filter((t) => tb.has(t)).sort();
}

export interface SectionTexts { id: string; texts: string[] }
export interface TermSpread { term: string; sections: string[] }

/** Terms used in the subtrees of at least two sections, widest spread first, then alphabetically. */
export function termsAcross(sections: SectionTexts[]): TermSpread[] {
  const where = new Map<string, Set<string>>();
  for (const s of sections) {
    for (const t of termsOf(s.texts.join("\n"))) {
      if (!where.has(t)) where.set(t, new Set());
      where.get(t)!.add(s.id);
    }
  }
  return [...where].filter(([, ids]) => ids.size >= 2)
    .map(([term, ids]) => ({ term, sections: [...ids].sort() }))
    .sort((x, y) => y.sections.length - x.sections.length || (x.term < y.term ? -1 : x.term > y.term ? 1 : 0));
}

/** Ordering score for a candidate pair: a modal clash outranks a near-duplicate. */
export const pairScore = (a: Texted, b: Texted): number => {
  const text = (n: Texted) => [str(n.title), str(n.description)].filter(Boolean).join(". ");
  return 2 * modalClash(text(a), text(b)) + sameThing(a, b);
};
