import type { ProposalProblem, ProposedOp } from "../../../../shared/api";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { StatusChip } from "@/components/StatusChip/StatusChip";
import { useModel } from "@/model/useModel";
import { currentField, problemTone, valueText } from "./lib";
import styles from "./intent.module.css";

const VERB: Record<ProposedOp["op"], string> = { add: "Add", update: "Update", remove: "Remove", link: "Link", unlink: "Unlink" };

interface Row { key: string; label: string; before: string; after: string; removed?: boolean }

function DiffTable({ label, rows }: { label: string; rows: Row[] }) {
  return (
    <table className={styles.diff} aria-label={label}>
      <thead>
        <tr><th scope="col">{label.endsWith("criteria") ? "Criterion" : "Field"}</th><th scope="col">Before</th><th scope="col">After</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row"><code>{r.label}</code></th>
            <td data-side="before">{r.before}</td>
            <td data-side="after" data-removed={r.removed || undefined}>{r.after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ProblemList({ problems, label }: { problems: ProposalProblem[]; label: string }) {
  if (!problems.length) return null;
  return (
    <ul className={styles.problems} aria-label={label}>
      {problems.map((p, i) => (
        <li key={i}>
          <StatusChip status={p.severity} tone={problemTone(p.severity)} />
          <span>{p.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** One proposed op: include toggle, target, and its before/after for fields, criteria and links. */
export function OpDiff({ op, included, onToggle, problems, disabled }: {
  op: ProposedOp;
  included: boolean;
  onToggle(on: boolean): void;
  problems: ProposalProblem[];
  disabled?: boolean;
}) {
  const m = useModel();
  const entry = m.byId(op.node);
  const known = !!entry;
  const fieldRows: Row[] = Object.entries(op.fields ?? {}).map(([field, after]) => ({
    key: field,
    label: field,
    before: op.op === "add" ? "none" : known ? valueText(currentField(entry.item, field)) : "unknown",
    after: after === null ? "removed" : valueText(after),
    removed: after === null,
  }));
  const criteria = m.index.model.criteria ?? [];
  const criterionRows: Row[] = (op.criteria ?? []).map((c) => {
    const before = criteria.find((x) => x.id === c.id);
    const removed = "remove" in c;
    return {
      key: c.id,
      label: c.id,
      before: op.op === "add" || !before ? "none" : before.claim,
      after: removed ? "removed" : c.claim,
      removed,
    };
  });
  return (
    <li className={styles.op} data-op={op.op} data-included={included}>
      <label className={styles.opHead}>
        <input type="checkbox" checked={included} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
        <span className={styles.verb}>{VERB[op.op]}</span>
        <NodeChip id={op.node} kind={op.kind} interactive={false} size="sm" showId />
        <code className={styles.opId}>{op.id}</code>
      </label>
      {op.op === "add" && (
        <p className={styles.line}>
          New {op.kind ?? "unknown"} under {op.parent ? <NodeChip id={op.parent} size="sm" interactive={false} /> : "unknown"}
        </p>
      )}
      {op.op === "remove" && <p className={styles.line}>Removes this node{known ? "" : " (not in this revision)"} and the criteria it owns.</p>}
      {op.link && (
        <p className={styles.line}>
          {op.op === "unlink" ? "Removes" : "Adds"} <NodeChip id={op.node} size="sm" interactive={false} /> <code>{op.link.rel}</code> →{" "}
          <NodeChip id={op.link.to} size="sm" interactive={false} />
          {op.link.certainty && <span className={styles.muted}> ({op.link.certainty})</span>}
        </p>
      )}
      <details><summary>Review {op.id} delta</summary>
      {fieldRows.length > 0 && <DiffTable label={`${op.id} fields`} rows={fieldRows} />}
      {criterionRows.length > 0 && <DiffTable label={`${op.id} criteria`} rows={criterionRows} />}
      </details>
      {op.dependsOn?.length ? <p className={styles.muted}>Needs {op.dependsOn.join(", ")}</p> : null}
      <ProblemList problems={problems} label={`Problems with ${op.id}`} />
    </li>
  );
}
