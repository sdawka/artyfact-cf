import type { ChangelogRow } from "../../../shared/api";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One-line change summary of a System commit: `nodes +a ~c −r · n files · k criteria`. */
export function summaryLine(s: ChangelogRow["summary"]): string {
  return `nodes +${s.nodesAdded} ~${s.nodesChanged} −${s.nodesRemoved} · ${plural(s.filesChanged, "file")} · ${plural(s.criteriaAffected, "criterion", "criteria")}`;
}

/** Distinct Evolutions across rows, in first-seen order (newest commits first). */
export function evolutionOptions(rows: readonly ChangelogRow[]): { id: string; title: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows) for (const e of r.evolutions) if (!seen.has(e.id)) seen.set(e.id, e.title);
  return [...seen].map(([id, title]) => ({ id, title }));
}
