/**
 * The editor commit's "why", kept in this browser per realization so the Realize step (Promote / Accept) can start
 * from it. The server records it on the candidate; this only pre-fills the form.
 */
const key = (systemId: string, realizationId: string) => `artyfact.why.${systemId}.${realizationId}`;

export function rememberWhy(systemId: string, realizationId: string, why: string) {
  try {
    globalThis.localStorage?.setItem(key(systemId, realizationId), why);
  } catch {
    // Storage blocked: the Realize form just starts empty.
  }
}

/** The remembered whys of these realizations, joined by blank lines; null when there are none. */
export function whyFor(systemId: string, realizationIds: readonly string[]): string | null {
  const parts: string[] = [];
  for (const id of new Set(realizationIds)) {
    try {
      const v = globalThis.localStorage?.getItem(key(systemId, id));
      if (v?.trim()) parts.push(v.trim());
    } catch {
      return null;
    }
  }
  return parts.length ? parts.join("\n\n") : null;
}
