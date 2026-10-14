import { useId } from "react";
import { Link } from "react-router";
import { useKeepParams, useSelection } from "@/model/useSelection";
import { ConflictChips } from "../work/ConflictChips";
import { importLabel, waitingCount, type QueueGroup, type QueueRow } from "./queue";
import styles from "./review.module.css";

interface Props {
  groups: readonly QueueGroup[];
  planId?: string | null;
  taskId?: string | null;
  integrityId?: string | null;
  error?: string | null;
  evolutionId: string | null;
  realizationId: string | null;
  promoting: boolean;
  /** The import review is open (`?panel=import`). */
  importing?: boolean;
  /** Board or candidates still loading: an empty queue is not yet "nothing waiting". */
  loading?: boolean;
}

/** The decision queue: one row per pending decision, grouped by Evolution. A row is a link that opens it on the right. */
export function QueueList({ groups, evolutionId, realizationId, promoting, importing, planId, taskId, integrityId, error, loading = false }: Props) {
  const count = waitingCount(groups);
  return (
    <section className={styles.queue} aria-labelledby="queue-title">
      <h2 id="queue-title" className={styles.queueTitle}>
        Waiting on you <span className={styles.count}>{count}</span>
      </h2>
      {groups.length ? (
        groups.map((g) => (
          <Group key={g.planId ?? g.evolution} group={g} planId={planId} taskId={taskId} integrityId={integrityId} evolutionId={evolutionId} realizationId={realizationId} promoting={promoting} importing={importing} />
        ))
      ) : (
        <p className={styles.muted} {...(loading && { role: "status" })}>{error ? "The decision queue could not be fully loaded." : loading ? "Loading the queue…" : "Nothing is waiting on you."}</p>
      )}
    </section>
  );
}

function Group({ group, evolutionId, realizationId, promoting, importing, planId, taskId, integrityId }: { group: QueueGroup } & Omit<Props, "groups" | "loading">) {
  const id = useId();
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h3 id={id} className={styles.groupTitle}>{group.title}</h3>
      <ul className={styles.rows}>
        {group.rows.map((row) => {
          const current = row.kind === "integrity" ? row.integrity?.id === integrityId : row.plan ? row.plan.id === planId && (row.task?.id ?? null) === (taskId ?? null) : row.kind === "import"
            ? !!importing
            : row.kind === "promotion"
              ? promoting && evolutionId === group.evolution
              : !promoting && !importing && !!row.realization && row.realization.id === realizationId;
          return <li key={row.key}><Row row={row} title={group.title} current={current} /></li>;
        })}
      </ul>
    </section>
  );
}

function Row({ row, title, current }: { row: QueueRow; title: string; current: boolean }) {
  const href = useKeepParams();
  const { candidates: selected } = useSelection();
  const to = row.kind === "integrity" ? href("review", {integrity:row.integrity!.id, plan:null,task:null,evolution:null,realization:null,panel:null}) : row.plan ? href("review", {plan: row.plan.id, task: row.task?.id ?? null, evolution:null, realization:null, panel:null}) : row.kind === "import"
    ? href("review", { evolution: null, realization: null, panel: "import", plan:null, task:null })
    : row.kind === "promotion"
      ? href("review", { evolution: row.evolution, realization: null, panel: "promote", plan:null, task:null })
      : href("review", { evolution: row.evolution, realization: row.realization?.id ?? null, panel: null, plan:null, task:null });
  if (row.plan) return <Link to={to} className={styles.row} data-kind={row.kind} data-testid={`queue-${row.key}`} aria-current={current ? "true" : undefined}><strong>{row.task?.title ?? "Promote implementation"}</strong><span>{row.task ? "Task result awaits selection" : "Plan awaits promotion"}</span></Link>;
  if (row.integrity) return <Link to={to} className={styles.row} data-kind="integrity" data-testid={`queue-${row.key}`} aria-current={current ? "true" : undefined}><strong>Integrity review</strong><span>{row.integrity.state === "completed" ? `automated ${row.integrity.report?.status ?? "result"}; human agreement pending` : `${row.integrity.state} check`}</span></Link>;
  const r = row.realization;
  const ready = row.kind === "promotion";
  if (row.importReview) {
    return (
      <Link to={to} className={styles.row} data-kind={row.kind} data-testid="queue-import" aria-current={current ? "true" : undefined}>
        <span className={styles.rowTop}>
          <span className={styles.kind} data-kind={row.kind}>{importLabel(row.importReview.nodes)}</span>
          <span className={styles.muted}>awaits an admin</span>
        </span>
        <span className={styles.rowMeta}>
          Genome <code>{row.importReview.genomeCommit.slice(0, 7)}</code> · new work waits until it is accepted
        </span>
      </Link>
    );
  }
  return (
    <Link
      to={to}
      className={styles.row}
      data-kind={row.kind}
      data-testid={r ? `queue-${r.id}` : `queue-promotion-${row.evolution}`}
      aria-current={current ? "true" : undefined}
    >
      <span className={styles.rowTop}>
        <span className={styles.kind} data-kind={row.kind}>{row.kind}</span>
        {r && <strong className={styles.agent}>{r.agent.id}</strong>}
        {r && <span className={styles.muted}>{r.agent.role}</span>}
        {ready && <span className={styles.muted}>ready to promote</span>}
        {ready && <span className="sr-only">{title} ({row.evolution})</span>}
      </span>
      {row.candidateId && (
        <span className={styles.rowMeta}>
          <code>{row.candidateId}</code>
          {selected.includes(row.candidateId) && <span className={styles.selected}>selected for composition</span>}
        </span>
      )}
      <ConflictChips conflicts={row.conflicts} compact />
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
