import type { RevisionOption } from "@/model/revisions";

/** System commits, newest first (by `at` when both have it, else server order). */
const commitsNewestFirst = (options: readonly RevisionOption[]) =>
  options
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.kind === "commit")
    .sort((a, b) => (a.o.at && b.o.at ? b.o.at.localeCompare(a.o.at) : a.i - b.i))
    .map(({ o }) => o.id);

/**
 * The pair to compare when the URL names none: `to` defaults to head; `from` to the System commit before `to` (head's
 * parent for head), else `to` itself (a single revision compares with itself).
 */
export function defaultPair(options: readonly RevisionOption[], from: string | null, to: string | null): { from: string; to: string } {
  const toRef = to || "head";
  if (from) return { from, to: toRef };
  const commits = commitsNewestFirst(options);
  if (toRef === "head") return { from: commits[1] ?? "head", to: toRef };
  const i = commits.indexOf(toRef);
  return { from: i >= 0 ? (commits[i + 1] ?? toRef) : "head", to: toRef };
}
