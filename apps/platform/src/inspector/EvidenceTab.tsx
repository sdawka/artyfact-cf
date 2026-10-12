import { EmptyState } from "@/components/EmptyState/EmptyState";
import type { IndexEntry } from "@/model/index";
import { useModel } from "@/model/useModel";
import { EvaluationsTable } from "@/views/evaluations/EvaluationsTable";

/** Evaluations whose subject is this node or one of its descendants, as a compact table. */
export function EvidenceTab({ entry }: { entry: IndexEntry }) {
  const m = useModel();
  const ids = new Set(m.descendants(entry.id));
  const rows = m.evaluations.filter((e) => ids.has(e.subjectId));
  if (!rows.length) {
    const n = [...ids].reduce((k, id) => k + m.criteriaFor(id).length, 0);
    return <EmptyState title="No evaluations yet — nothing is known">{n ? `${n} criteria apply here and none has run.` : "No criteria have this object as their subject."}</EmptyState>;
  }
  return <EvaluationsTable evaluations={rows} compact />;
}

