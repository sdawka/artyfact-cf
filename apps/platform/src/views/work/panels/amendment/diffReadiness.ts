import type { Finding, Readiness } from "../../../../../shared/api";

/** A finding is the same finding when rule and subject match; rewording the message does not make it new. */
export const findingKey = (f: Finding) => `${f.rule}\u0000${f.subject ?? ""}`;

export interface ReadinessDiff {
  /** In the base, gone in the candidate. */
  resolved: Finding[];
  /** New in the candidate. */
  added: Finding[];
  /** Added findings of level `error`: they block acceptance. */
  hardAdded: Finding[];
}

/** Hard (blocking) findings are `error`; moving into or out of `error` counts as added or resolved. */
const hard = (f: Finding | undefined) => f?.level === "error";

export function diffReadiness(base: Readiness, candidate: Readiness): ReadinessDiff {
  const baseBy = new Map(base.findings.map((f) => [findingKey(f), f]));
  const candBy = new Map(candidate.findings.map((f) => [findingKey(f), f]));
  const added = candidate.findings.filter((f) => {
    const was = baseBy.get(findingKey(f));
    return !was || (hard(f) && !hard(was));
  });
  return {
    resolved: base.findings.filter((f) => {
      const now = candBy.get(findingKey(f));
      return !now || (hard(f) && !hard(now));
    }),
    added,
    hardAdded: added.filter(hard),
  };
}
