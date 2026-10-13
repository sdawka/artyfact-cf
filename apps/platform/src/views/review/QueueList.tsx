import { useId } from "react";
import { Link } from "react-router";
import { useKeepParams, useSelection } from "@/model/useSelection";
import { ConflictChips } from "../work/ConflictChips";
import type { QueueGroup, QueueRow } from "./queue";
import styles from "./review.module.css";

interface Props {
  groups: readonly QueueGroup[];
  evolutionId: string | null;
  realizationId: string | null;
  promoting: boolean;
}

/** The decision queue: one row per pending decision, grouped by Evolution. A row is a link that opens it on the right. */
export function QueueList({ groups, evolutionId, realizationId, promoting }: Props) {
  const count = groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <section className={styles.queue} aria-labelledby="queue-title">
      <h2 id="queue-title" className={styles.queueTitle}>
        Waiting on you <span className={styles.count}>{count}</span>
      </h2>
      {groups.length ? (
        groups.map((g) => (
          <Group key={g.evolution} group={g} evolutionId={evolutionId} realizationId={realizationId} promoting={promoting} />
        ))
      ) : (
        <p className={styles.muted}>Nothing is waiting on you.</p>
      )}
    </section>
  );
}

function Group({ group, evolutionId, realizationId, promoting }: { group: QueueGroup } & Omit<Props, "groups">) {
  const id = useId();
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h3 id={id} className={styles.groupTitle}>{group.title}</h3>
      <ul className={styles.rows}>
        {group.rows.map((row) => {
          const current = row.kind === "promotion"
            ? promoting && evolutionId === group.evolution
            : !promoting && !!row.realization && row.realization.id === realizationId;
          return <li key={row.key}><Row row={row} current={current} /></li>;
        })}
      </ul>
    </section>
  );
}

function Row({ row, current }: { row: QueueRow; current: boolean }) {
  const href = useKeepParams();
  const { candidates: selected } = useSelection();
  const to = row.kind === "promotion"
    ? href("review", { evolution: row.evolution, realization: null, panel: "promote" })
    : href("review", { evolution: row.evolution, realization: row.realization?.id ?? null, panel: null });
  const r = row.realization;
  const ready = row.kind === "promotion";
  return (
    <Link to={to} className={styles.row} data-kind={row.kind} aria-current={current ? "true" : undefined}>
      <span className={styles.rowTop}>
        <span className={styles.kind} data-kind={row.kind}>{row.kind}</span>
        {r && <strong className={styles.agent}>{r.agent.id}</strong>}
        {r && <span className={styles.muted}>{r.agent.role}</span>}
        {ready && <span className={styles.muted}>ready to promote</span>}
      </span>
      {row.candidateId && (
        <span className={styles.rowMeta}>
          <code>{row.candidateId}</code>
          {selected.includes(row.candidateId) && <span className={styles.selected}>selected for composition</span>}
        </span>
      )}
      <ConflictChips conflicts={row.conflicts} />
      <BaseLine behind={row.behind} />
    </Link>
  );
}

/** "base = head" in the neutral tone; "behind by N" (or "behind head" when the distance is unknown) needs attention. */
function BaseLine({ behind }: { behind: number | null | undefined }) {
  if (behind === undefined) return null;
  if (behind === 0) return <span className={styles.rowMeta}>base = head</span>;
  return <span className={styles.behind}>{behind === null ? "behind head" : `behind by ${behind}`}</span>;
}
