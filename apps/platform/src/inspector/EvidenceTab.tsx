import { Link } from "react-router";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import type { IndexEntry } from "@/model/index";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import { EvaluationsTable } from "@/views/evaluations/EvaluationsTable";

/** Evaluations whose subject is this node or one of its descendants, as a compact table. */
export function EvidenceTab({ entry }: { entry: IndexEntry }) {
  const m = useModel();
  const href = useKeepParams();
  const ids = new Set(m.descendants(entry.id));
  const rows = m.evaluations.filter((e) => ids.has(e.subjectId));
  if (!rows.length) {
    const n = [...ids].reduce((k, id) => k + m.criteriaFor(id).length, 0);
    return (
      <EmptyState title="No evaluations yet." action={<Link to={href("evaluations")}>Open Evaluations</Link>}>
        {n ? `${n} ${n === 1 ? "criterion applies" : "criteria apply"} here and none has run.` : "No criteria have this object as their subject."}
      </EmptyState>
    );
  }
  return <EvaluationsTable evaluations={rows} compact />;
}
