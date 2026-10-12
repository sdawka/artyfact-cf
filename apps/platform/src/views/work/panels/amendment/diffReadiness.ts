import type { Finding, Readiness } from "../../../../../shared/api";

export const findingKey = (f: Finding) => `${f.rule}\u0000${f.subject ?? ""}\u0000${f.message}`;

export interface ReadinessDiff {
  /** In the base, gone in the candidate. */
  resolved: Finding[];
  /** New in the candidate. */
  added: Finding[];
  /** Added findings of level `error`: they block acceptance. */
  hardAdded: Finding[];
}

export function diffReadiness(base: Readiness, candidate: Readiness): ReadinessDiff {
  const baseKeys = new Set(base.findings.map(findingKey));
  const candKeys = new Set(candidate.findings.map(findingKey));
  const added = candidate.findings.filter((f) => !baseKeys.has(findingKey(f)));
  return {
    resolved: base.findings.filter((f) => !candKeys.has(findingKey(f))),
    added,
    hardAdded: added.filter((f) => f.level === "error"),
  };
}
