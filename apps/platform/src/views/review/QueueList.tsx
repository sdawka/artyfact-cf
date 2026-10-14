import { useId } from "react";
import { Link } from "react-router";
import { Count } from "@/components/Count/Count";
import { Kbd } from "@/components/Kbd/Kbd";
import { MetaLine, type MetaItem } from "@/components/MetaLine/MetaLine";
import { Row, RowList } from "@/components/RowList/RowList";
import { StatusText } from "@/components/StatusText/StatusText";
import { useKeepParams, useSelection } from "@/model/useSelection";
import { ConflictChips } from "../work/ConflictChips";
import { importLabel, waitingCount, type QueueGroup, type QueueKind, type QueueRow } from "./queue";
import styles from "./review.module.css";

interface Props {
  groups: readonly QueueGroup[];
  planId?: string | null;
  taskId?: string | null;
  error?: string | null;
  evolutionId: string | null;
  realizationId: string | null;
  promoting: boolean;
  /** The import review is open (`?panel=import`). */
  importing?: boolean;
  /** Board or candidates still loading: an empty queue is not yet "nothing waiting". */
  loading?: boolean;
}

/** The row's type: a small chip, glyph plus word. Never ✓ (that means pass). */
const KIND: Record<QueueKind, { glyph: string; word: string }> = {
  candidate: { glyph: "◇", word: "candidate" },
  stale: { glyph: "↻", word: "stale" },
  amendment: { glyph: "✎", word: "amendment" },
  promotion: { glyph: "↑", word: "promotion" },
  import: { glyph: "⤓", word: "import" },
  "task-selection": { glyph: "◇", word: "task" },
  "plan-promotion": { glyph: "↑", word: "plan" },
};

/** Marks a queue row target for j / k navigation. */
export const QUEUE_ROW = "data-queue-row";

/** The decision queue: one row per pending decision, grouped by Evolution. A row is a link that opens it in the detail pane. */
export function QueueList({ groups, evolutionId, realizationId, promoting, importing, planId, taskId, error, loading = false }: Props) {
  const count = waitingCount(groups);
  return (
    <section className={styles.queue} aria-labelledby="queue-title">
      <h2 id="queue-title" className={styles.queueTitle}>
        Waiting on you <Count n={count} tone="attention" />
      </h2>
      {groups.length ? (
        groups.map((g) => (
          <Group key={g.planId ?? g.evolution} group={g} planId={planId} taskId={taskId} evolutionId={evolutionId} realizationId={realizationId} promoting={promoting} importing={importing} />
        ))
      ) : (
        <p className={styles.muted} {...(loading && { role: "status" })}>{error ? "The decision queue could not be fully loaded." : loading ? "Loading the queue…" : "Nothing is waiting on you."}</p>
      )}
      {groups.length > 0 && (
        <p className={styles.keys}>
          <span><Kbd keys={["j"]} /> <Kbd keys={["k"]} /> move</span>
          <span><Kbd keys={["Enter"]} /> open</span>
        </p>
      )}
    </section>
  );
}

function Group({ group, evolutionId, realizationId, promoting, importing, planId, taskId }: { group: QueueGroup } & Omit<Props, "groups" | "loading">) {
  const id = useId();
  const href = useKeepParams();
  // The group head opens its Evolution (or plan) in Work; the import group belongs to no Evolution.
  const to = group.planId
    ? href("work", { plan: group.planId, task: null, evolution: null, realization: null, panel: null, candidates: null })
    : group.evolution
      ? href("work", { evolution: group.evolution, realization: null, panel: null, plan: null, task: null })
      : null;
  const ready = group.rows.filter((r) => r.kind === "candidate").length;
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h3 id={id} className={styles.groupTitle}>
        {to ? <Link to={to} className={styles.groupLink}>{group.title}</Link> : group.title}
      </h3>
      <RowList label={`${group.title} decisions`} className={styles.rows}>
        {group.rows.map((row) => {
          const current = row.plan ? row.plan.id === planId && (row.task?.id ?? null) === (taskId ?? null) : row.kind === "import"
            ? !!importing
            : row.kind === "promotion"
              ? promoting && evolutionId === group.evolution
              : !promoting && !importing && !!row.realization && row.realization.id === realizationId;
          return <QueueItem key={row.key} row={row} title={group.title} current={current} ready={ready} />;
        })}
      </RowList>
    </section>
  );
}

/** Where a row opens: the plan or Task review, the import review, the promotion desk or the candidate review. */
export function useRowHref() {
  const href = useKeepParams();
  return (row: QueueRow) => row.plan ? href("review", { plan: row.plan.id, task: row.task?.id ?? null, evolution: null, realization: null, panel: null }) : row.kind === "import"
    ? href("review", { evolution: null, realization: null, panel: "import", plan: null, task: null })
    : row.kind === "promotion"
      ? href("review", { evolution: row.evolution, realization: null, panel: "promote", plan: null, task: null })
      : href("review", { evolution: row.evolution, realization: row.realization?.id ?? null, panel: null, plan: null, task: null });
}

function Chip({ kind }: { kind: QueueKind }) {
  const k = KIND[kind];
  return <span className={styles.kind} data-kind={kind}><span className="u-glyph" aria-hidden="true">{k.glyph}</span>{k.word}</span>;
}

/** The outcome sentence: what deciding this row is about. */
function outcome(row: QueueRow, ready: number): string {
  if (row.plan) return row.task ? `${row.task.title}: result awaits selection` : "Plan awaits promotion";
  switch (row.kind) {
    case "import": return `${importLabel(row.importReview!.nodes)} awaits an admin`;
    case "amendment": return "Genome amendment awaits an admin";
    case "promotion": return `Ready to promote, ${ready} candidate${ready === 1 ? "" : "s"} evaluated`;
    case "stale": return "Built on an earlier head";
    default:
      return row.realization?.status === "submitted" ? "Submitted, checks pending" : "Evaluated candidate to review";
  }
}

function QueueItem({ row, title, current, ready }: { row: QueueRow; title: string; current: boolean; ready: number }) {
  const rowHref = useRowHref();
  const { candidates: selected } = useSelection();
  const r = row.realization;
  const testId = row.plan ? `queue-${row.key}` : row.importReview ? "queue-import" : r ? `queue-${r.id}` : `queue-promotion-${row.evolution}`;
  const meta: MetaItem[] = [];
  // A base behind head is the 409 precondition: it leads the meta line, in attention.
  if (row.behind !== undefined && row.behind !== 0) {
    meta.push({ value: <StatusText status="behind" tone="attention" glyph="↻" label={row.behind === null ? "behind head" : `behind by ${row.behind}`} /> });
  }
  if (row.importReview) {
    meta.push({ label: "Genome", value: row.importReview.genomeCommit.slice(0, 7), code: true, title: row.importReview.genomeCommit });
    meta.push({ value: "new work waits until it is accepted" });
  }
  if (r) meta.push({ value: <span className={styles.agent}>{r.agent.id}</span> }, { value: r.agent.role });
  if (row.candidateId) meta.push({ value: <code className={styles.id} title={row.candidateId}>{row.candidateId}</code> });
  if (row.behind === 0) meta.push({ value: "base = head" });
  if (row.candidateId && selected.includes(row.candidateId)) meta.push({ value: <StatusText status="selected" tone="attention" glyph="●" label="in promotion" /> });
  return (
    <Row
      to={rowHref(row)}
      current={current}
      targetProps={{ "data-kind": row.kind, "data-testid": testId, [QUEUE_ROW]: "" }}
      className={styles.row}
      title={
        <span className={styles.rowTop}>
          <Chip kind={row.kind} />
          <span className={styles.outcome}>{outcome(row, ready)}</span>
          {row.kind === "promotion" && <span className="sr-only">{title} ({row.evolution})</span>}
        </span>
      }
      meta={(meta.length > 0 || row.conflicts.length > 0) && (
        <>
          {meta.length > 0 && <MetaLine items={meta} className={styles.rowMeta} />}
          <ConflictChips conflicts={row.conflicts} compact />
        </>
      )}
      status={row.kind === "promotion" ? <span className={styles.trail}>Promote</span> : undefined}
    />
  );
}
