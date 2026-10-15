import type { ReactNode } from "react";
import type { SystemCommit, SystemCompare } from "../../../shared/api";
import { shortSha } from "@/model/time";

/** One comparable field of the System table. `name` is the plain label the sentence uses. */
export interface SystemRow {
  key: string;
  name: string;
  label: ReactNode;
  from: ReactNode;
  to: ReactNode;
  changed: boolean;
  /** Rows that say whether the Genome or the app moved: the sentence treats them apart from manifest-level changes. */
  role?: "genome" | "app";
}

/** A long hash in the row, e09a721…973a; the whole value stays in the title. */
const clip = (s: string) => (s.length > 16 ? `${s.slice(0, 7)}…${s.slice(-4)}` : s);
const idCode = (s: string) => <code title={s}>{clip(s)}</code>;
const full = (s: string | null | undefined, n: number) => (s ? <code title={s}>{s.slice(0, n)}</code> : "unknown");
const sha = (s: string | null | undefined) => (s ? <code title={s}>{shortSha(s)}</code> : "unknown");
const versions = (c: SystemCommit | null, kind: "templateVersions" | "hookVersions", key: string) => c?.composition?.[kind]?.[key] ?? "none";
const platform = (c: SystemCommit | null) => {
  const p = c?.composition?.platform;
  return p ? <code>{p.repo}@{shortSha(p.commit)}</code> : "unknown";
};

/** The two System commits as rows: Genome, manifest, platform, per-artifact commits and changed versions. Pure. */
export function systemRows(cmp: SystemCompare): SystemRow[] {
  const { from, to } = cmp;
  const artifacts = [...new Set([...(from?.manifest ?? []), ...to.manifest].map((b) => b.artifact))].sort();
  const commitOf = (c: SystemCommit | null, artifact: string) => c?.manifest.find((b) => b.artifact === artifact);
  const rows: SystemRow[] = [
    { key: "system", name: "System commit", label: "System commit", from: from ? idCode(from.id) : "none", to: idCode(to.id), changed: from?.id !== to.id },
    { key: "genome", name: "Genome commit", label: "Genome commit", from: sha(cmp.genome.from), to: sha(cmp.genome.to), changed: cmp.genome.from !== cmp.genome.to, role: "genome" },
    {
      key: "manifest", name: "manifest hash", label: "Manifest hash",
      from: full(from?.manifestHash, 12), to: full(to.manifestHash, 12),
      changed: (from?.manifestHash ?? null) !== (to.manifestHash ?? null),
    },
    { key: "platform", name: "platform", label: "Platform", from: platform(from), to: platform(to), changed: cmp.manifest.platformChanged },
    ...artifacts.map((a): SystemRow => {
      const l = commitOf(from, a);
      const r = commitOf(to, a);
      return {
        key: `a-${a}`, name: `artifact ${a}`, label: <>Artifact <code>{a}</code></>,
        from: l ? <>{l.repo ?? "unknown repo"} {sha(l.commit)}</> : "none",
        to: r ? <>{r.repo ?? "unknown repo"} {sha(r.commit)}</> : "none",
        changed: l?.commit !== r?.commit,
      };
    }),
    ...(cmp.app
      ? [{ key: "app", name: "app files", label: "App files", from: sha(cmp.app.from?.commit), to: sha(cmp.app.to.commit), changed: (cmp.app.from?.commit ?? null) !== cmp.app.to.commit, role: "app" } satisfies SystemRow]
      : []),
    ...cmp.manifest.templateVersions.map((k): SystemRow => ({ key: `t-${k}`, name: `template ${k}`, label: <>Template <code>{k}</code></>, from: versions(from, "templateVersions", k), to: versions(to, "templateVersions", k), changed: true })),
    ...cmp.manifest.hookVersions.map((k): SystemRow => ({ key: `h-${k}`, name: `hook ${k}`, label: <>Hook <code>{k}</code></>, from: versions(from, "hookVersions", k), to: versions(to, "hookVersions", k), changed: true })),
  ];
  if (!cmp.manifest.templateVersions.length && !cmp.manifest.hookVersions.length) {
    rows.push({ key: "versions", name: "template and hook versions", label: "Template and hook versions", from: "—", to: "—", changed: false });
  }
  return rows;
}

const list = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? ""));

/**
 * One sentence about the pair, derived from the rows and never from `SystemCompare.identical`: that flag only says the
 * Genome and app commits match, while the System commit and manifest can still differ.
 */
export function systemSentence(rows: SystemRow[]): string {
  const changed = rows.filter((r) => r.changed);
  if (!changed.length) return "Nothing differs between these revisions.";
  const genome = rows.find((r) => r.role === "genome");
  const app = rows.find((r) => r.role === "app");
  const others = changed.filter((r) => !r.role).map((r) => r.name);
  const moved = [genome?.changed && "Genome", app?.changed && "App"].filter(Boolean) as string[];
  if (!moved.length) {
    return `${app ? "Genome and app files are" : "Genome files are"} identical; only ${list(others)} changed.`;
  }
  return `${list(moved)} changed${others.length ? `, with ${list(others)}` : ""}.`;
}
