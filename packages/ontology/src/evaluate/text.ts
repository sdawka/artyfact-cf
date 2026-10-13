import { DEFAULT_PLACEHOLDERS, TEXT_DEFAULT_FIELDS, TEXT_KEYS, type Field, type Kind, type TextConstraints } from "../meta/schema.ts";

/**
 * Text-quality helpers shared by `toFacts` and the meta@1 form check. Everything a rule needs that the Datalog
 * dialect cannot compute (trimmed length, word count, placeholder match, normalised equality, regex) is computed
 * here and emitted as EDB facts, so every text finding still derives from facts.
 */

const ALNUM = /[\p{L}\p{N}]/u;

/** Trimmed length in code points. */
export const textLength = (v: string): number => [...v.trim()].length;

/** Whitespace-separated tokens that contain at least one letter or digit. */
export const textWords = (v: string): number => v.trim().split(/\s+/u).filter((w) => ALNUM.test(w)).length;

/** Lower case, every run of characters that are not letters or digits collapsed to one space, trimmed. */
export const normaliseText = (v: string): string => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const squash = (v: string): string => v.trim().toLowerCase().replace(/\s+/gu, " ");

/**
 * True when the trimmed value equals the token, or contains it as a whole word, case-insensitively. A token edge that
 * is a letter or digit needs a neighbour that is not; a punctuation edge (as in `???`) needs whitespace or the end of
 * the value, so `really???` is not a placeholder but `TBD ???` is.
 */
export function isPlaceholder(value: string, token: string): boolean {
  const v = squash(value), t = squash(token);
  if (!t) return false;
  if (v === t) return true;
  const edgeOk = (edge: string, neighbour: string | undefined) =>
    neighbour === undefined || (ALNUM.test(edge) ? !ALNUM.test(neighbour) : /\s/u.test(neighbour));
  for (let i = v.indexOf(t); i >= 0; i = v.indexOf(t, i + 1)) {
    if (edgeOk(t[0]!, i > 0 ? v[i - 1] : undefined) && edgeOk(t[t.length - 1]!, v[i + t.length])) return true;
  }
  return false;
}

/** The compiled pattern, or undefined when the source does not compile. */
export function compilePattern(source: string): RegExp | undefined {
  try { return new RegExp(source); } catch { return undefined; }
}

const ownText = (fd: Field): TextConstraints => {
  const out: TextConstraints = {};
  for (const k of TEXT_KEYS) if (fd[k] !== undefined) (out as Record<string, unknown>)[k] = fd[k];
  return out;
};

/**
 * The text constraints in force on each field of a kind. A field's own keys apply as declared. When the template
 * has `textDefaults`, every declared `string` field named `description` or `title` also gets the defaults, with its
 * own keys winning key by key; a default `distinctFrom` keeps only `"id"` and fields the kind declares, never itself.
 */
export function kindTextConstraints(kind: Kind, defaults: TextConstraints | undefined): Map<string, TextConstraints> {
  const out = new Map<string, TextConstraints>();
  const declared = new Set(kind.fields.map((f) => f.name));
  for (const fd of kind.fields) {
    const own = ownText(fd);
    let eff = own;
    if (defaults && fd.type === "string" && TEXT_DEFAULT_FIELDS.includes(fd.name)) {
      const d: TextConstraints = { placeholders: [...DEFAULT_PLACEHOLDERS], ...defaults };
      if (d.distinctFrom) d.distinctFrom = d.distinctFrom.filter((o) => o !== fd.name && (o === "id" || declared.has(o)));
      eff = { ...d, ...own };
    }
    if (Object.keys(eff).length) out.set(fd.name, eff);
  }
  return out;
}
