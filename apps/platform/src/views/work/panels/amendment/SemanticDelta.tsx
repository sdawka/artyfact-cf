import { useId, useState } from "react";
import type { SemanticChange, SemanticDelta as Delta } from "@artyfact/semantic";
import { Button } from "@/components/ui";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useKindViews } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import styles from "../AmendmentReview.module.css";
import summaryStyles from "./SemanticDelta.module.css";
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

export interface SemanticDeltaProps {
  delta: Delta;
  /**
   * Summary first: each group (Added, Changed, Removed) is a count line by node kind ("23 criteria, 12 journeys") with
   * "Show all" for the list. Groups of `showAllUpTo` or fewer changes are listed at once. Off by default.
   */
  summary?: boolean;
  /** Summary mode only: groups at or under this size are not folded. Default 6. */
  showAllUpTo?: number;
}

function KindCounts({ items }: { items: SemanticChange[] }) {
  const views = useKindViews();
  const counts = new Map<string, number>();
  for (const c of items) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  const parts = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([kind, n]) => {
    const v = views.of(kind);
    return `${n} ${n === 1 ? v.label.toLowerCase() : v.plural.toLowerCase()}`;
  });
  return <p className={summaryStyles.counts}>{parts.join(", ")}</p>;
}

function Group({ label, kind, items, folded }: { label: string; kind: ChangeKind; items: SemanticChange[]; folded: boolean }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div data-kind={kind}>
      <h4 className={styles.groupHead}>
        {label} <span className={styles.muted}>{items.length}</span>
      </h4>
      {folded && <KindCounts items={items} />}
      {folded && (
        <Button type="button" variant="ghost" size="compact" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={`${open ? "Hide" : "Show all"} ${label.toLowerCase()} (${items.length})`} onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show all"}
        </Button>
      )}
      {(!folded || open) && (
        <ul id={listId} className={styles.changeList}>
          {items.map((c) => (
            <ChangeDiff key={c.id} change={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Added / changed / removed subjects as chips, then a before/after field diff per changed node. */
export function SemanticDelta({ delta, summary = false, showAllUpTo = 6 }: SemanticDeltaProps) {
  const groups = GROUPS.map((g) => ({ ...g, items: delta.changes.filter((c) => changeKind(c) === g.kind) })).filter((g) => g.items.length);
  if (!delta.changes.length) return <p className={styles.muted}>No Genome subjects changed.</p>;
  if (summary) {
    return (
      <div className={styles.stack}>
        <p className={summaryStyles.headline}>{GROUPS.map((g) => `${delta.changes.filter((c) => changeKind(c) === g.kind).length} ${g.label.toLowerCase()}`).join(", ")}</p>
        {groups.map((g) => (
          <Group key={g.kind} label={g.label} kind={g.kind} items={g.items} folded={g.items.length > showAllUpTo} />
        ))}
      </div>
    );
  }
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
