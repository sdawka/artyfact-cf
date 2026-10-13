export interface Cardinality { min: number; max: number | null }

const GRAMMAR = /^(\d+)(?:\.\.(\d+|\*))?$/;

/** Parses `1`, `0..1`, `1..*`, `0..5`; `max: null` is unbounded. */
export function parseCardinality(src: string): Cardinality {
  const m = GRAMMAR.exec(src.trim());
  if (!m) throw new SyntaxError(`invalid cardinality '${src}' (expected N, N..M or N..*)`);
  const min = Number(m[1]);
  const max = m[2] === undefined ? min : m[2] === "*" ? null : Number(m[2]);
  if (max !== null && max < min) throw new SyntaxError(`invalid cardinality '${src}': upper bound below lower bound`);
  return { min, max };
}

export const isCardinality = (src: string): boolean => {
  try { parseCardinality(src); return true; } catch { return false; }
};

/** Datalog encoding of an unbounded upper bound. */
export const UNBOUNDED = -1;
export const maxOf = (c: Cardinality): number => c.max ?? UNBOUNDED;
