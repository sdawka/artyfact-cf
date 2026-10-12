import { Fragment, useId, useMemo, useState } from "react";
import type { Evaluation } from "../../../shared/api";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import type { UiVerdict } from "@/model/status";
import { EvaluationDetail } from "./EvaluationDetail";
import { EXECUTION_FILTERS, VERDICT_FILTERS, evaluationVerdict, newestFirst } from "./lib";
import styles from "./evaluations.module.css";

interface Props {
  evaluations: readonly Evaluation[];
  /** Hides the filters (Inspector, candidate review). */
  compact?: boolean;
  /** Controlled expansion (the view keeps it in `?evaluation=`). Uncontrolled when omitted. */
  expandedId?: string | null;
  onExpand?(id: string | null): void;
  emptyTitle?: string;
}

const ALL = "";

/** Evidence table: filter by candidate / criterion / verdict / execution; expand a row for the full evaluation. */
export function EvaluationsTable({ evaluations, compact, expandedId, onExpand, emptyTitle }: Props) {
  const uid = useId();
  const [candidate, setCandidate] = useState(ALL);
  const [criterion, setCriterion] = useState(ALL);
  const [verdict, setVerdict] = useState<UiVerdict | typeof ALL>(ALL);
  const [execution, setExecution] = useState(ALL);
  const [local, setLocal] = useState<string | null>(null);
  const open = expandedId !== undefined ? expandedId : local;
  const toggle = (id: string) => {
    const next = open === id ? null : id;
    if (onExpand) onExpand(next);
    else setLocal(next);
  };

  const sorted = useMemo(() => newestFirst(evaluations), [evaluations]);
  const candidates = useMemo(() => [...new Set(evaluations.map((e) => e.candidate))].sort(), [evaluations]);
  const criteria = useMemo(() => [...new Set(evaluations.map((e) => e.criterion))].sort(), [evaluations]);
  const rows = sorted.filter(
    (e) =>
      (!candidate || e.candidate === candidate) &&
      (!criterion || e.criterion === criterion) &&
      (!verdict || evaluationVerdict(e) === verdict) &&
      (!execution || e.execution === execution),
  );

  if (!evaluations.length) {
    return <p className={styles.empty}>{emptyTitle ?? "No evaluations yet — nothing is known"}</p>;
  }

  return (
    <div className={styles.wrap}>
      {!compact && (
        <form className={styles.filters} aria-label="Filter evaluations" onSubmit={(e) => e.preventDefault()}>
          <Select id={`${uid}-c`} label="Candidate" value={candidate} onChange={setCandidate} options={candidates} />
          <Select id={`${uid}-k`} label="Criterion" value={criterion} onChange={setCriterion} options={criteria} />
          <Select id={`${uid}-v`} label="Verdict" value={verdict} onChange={(v) => setVerdict(v as UiVerdict | "")} options={VERDICT_FILTERS} />
          <Select id={`${uid}-x`} label="Execution" value={execution} onChange={setExecution} options={EXECUTION_FILTERS} />
        </form>
      )}
      {rows.length === 0 ? (
        <p className={styles.empty} role="status">No evaluations match these filters.</p>
      ) : (
        <table className={styles.table}>
          <caption className="sr-only">Evaluations, newest first</caption>
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Expand</span></th>
              <th scope="col">Criterion</th>
              {!compact && <th scope="col">Candidate</th>}
              <th scope="col">Verdict</th>
              <th scope="col">Execution</th>
              {!compact && <th scope="col">Hook</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const isOpen = open === e.id;
              return (
                <Fragment key={e.id}>
                  <tr data-open={isOpen || undefined}>
                    <td>
                      <button
                        type="button"
                        className={styles.expand}
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? `${uid}-${e.id}` : undefined}
                        aria-label={`${isOpen ? "Collapse" : "Expand"} evaluation ${e.id}`}
                        onClick={() => toggle(e.id)}
                      >
                        <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                      </button>
                    </td>
                    <td><NodeChip id={e.criterion} size="sm" showId={!compact} /></td>
                    {!compact && <td><code>{e.candidate}</code></td>}
                    <td><VerdictBadge verdict={evaluationVerdict(e)} /></td>
                    <td>
                      {e.execution}
                      {e.execution === "error" && <span className={styles.rowError}>{e.error ?? "no message recorded"}</span>}
                    </td>
                    {!compact && <td><code>{e.hook}</code></td>}
                  </tr>
                  {isOpen && (
                    <tr id={`${uid}-${e.id}`} className={styles.detailRow}>
                      <td />
                      <td colSpan={compact ? 3 : 5}><EvaluationDetail evaluation={e} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Select({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange(v: string): void; options: readonly string[] }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ALL}>All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
