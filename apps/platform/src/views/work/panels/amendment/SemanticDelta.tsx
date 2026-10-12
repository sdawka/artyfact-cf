import type { SemanticChange, SemanticDelta as Delta } from "@artyfact/semantic";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useModel } from "@/model/useModel";
import styles from "../AmendmentReview.module.css";
import { changeKind, fieldValue, show, type ChangeKind } from "./helpers";

const GROUPS: { kind: ChangeKind; label: string }[] = [
  { kind: "added", label: "Added" },
  { kind: "changed", label: "Changed" },
  { kind: "removed", label: "Removed" },
];

function Chips({ ids, label }: { ids: string[]; label: string }) {
  if (!ids.length) return null;
  return (
    <div className={styles.chipRow}>
      <span className={styles.muted}>{label}</span>
      <ul className={styles.chips}>
        {ids.map((id) => (
          <li key={id}>
            <NodeChip id={id} size="sm" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChangeDiff({ change }: { change: SemanticChange }) {
  const m = useModel();
  const criteria = m.criteriaFor(change.id).map((c) => c.id);
  const journeys = m.journeysFor(change.id).map((j) => j.id);
  return (
    <li className={styles.change}>
      <div className={styles.changeHead}>
        <NodeChip id={change.id} kind={change.kind} showId />
      </div>
      {change.fieldsChanged.length > 0 && (
        <dl className={styles.fields}>
          {change.fieldsChanged.map((f) => (
            <div key={f} className={styles.field}>
              <dt>{f}</dt>
              <dd className={styles.before} aria-label={`${f} before`}>
                <span className={styles.side}>before</span>
                <pre>{show(fieldValue(change.before, f))}</pre>
              </dd>
              <dd className={styles.after} aria-label={`${f} after`}>
                <span className={styles.side}>after</span>
                <pre>{show(fieldValue(change.after, f))}</pre>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <Chips ids={criteria} label="affects criteria" />
      <Chips ids={journeys} label="affects journeys" />
    </li>
  );
}

/** Added / changed / removed subjects as chips, then a before/after field diff per changed node. */
export function SemanticDelta({ delta }: { delta: Delta }) {
  const groups = GROUPS.map((g) => ({ ...g, items: delta.changes.filter((c) => changeKind(c) === g.kind) })).filter((g) => g.items.length);
  if (!delta.changes.length) return <p className={styles.muted}>No Genome subjects changed.</p>;
  return (
    <div className={styles.stack}>
      {groups.map((g) => (
        <div key={g.kind} data-kind={g.kind}>
          <h4 className={styles.groupHead}>
            {g.label} <span className={styles.muted}>{g.items.length}</span>
          </h4>
          <ul className={styles.changeList}>
            {g.items.map((c) => (
              <ChangeDiff key={c.id} change={c} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
