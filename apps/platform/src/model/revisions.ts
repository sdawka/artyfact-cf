// TODO(rebase): import RevisionOption from shared/api once b0-contract lands.
export interface RevisionOption {
  id: string;
  kind: "head" | "commit" | "candidate";
  label: string;
  at?: string;
  evolution?: string;
  state?: string;
}

const HEX40 = /^[0-9a-f]{40}$/i;

/** Short display form of a ref: `head` and `sc-N` as is, a 40-hex hash as 7 chars, other ids up to 16 chars. */
export function shortRev(rev: string | null | undefined): string {
  if (!rev) return "unknown";
  if (HEX40.test(rev)) return rev.slice(0, 7);
  return rev.length > 16 ? `${rev.slice(0, 15)}…` : rev;
}

export interface RevisionGroup {
  label: string;
  options: RevisionOption[];
}

/** Head first, then System commits, then candidates (empty groups dropped). Keeps `value` selectable if unlisted. */
export function revisionGroups(options: RevisionOption[], value?: string): RevisionGroup[] {
  const all = value && !options.some((o) => o.id === value)
    ? [...options, { id: value, kind: value === "head" ? "head" : HEX40.test(value) || /^sc-\d+$/.test(value) ? "commit" : "candidate", label: shortRev(value) } satisfies RevisionOption]
    : options;
  const groups: RevisionGroup[] = [
    { label: "Head", options: all.filter((o) => o.kind === "head") },
    { label: "System commits", options: all.filter((o) => o.kind === "commit") },
    { label: "Candidates", options: all.filter((o) => o.kind === "candidate") },
  ];
  return groups.filter((g) => g.options.length > 0);
}
