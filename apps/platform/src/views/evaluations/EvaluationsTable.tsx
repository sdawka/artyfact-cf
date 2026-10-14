import { ChevronDownIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import { Button, Select, IconButton } from "@/components/ui";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { Evaluation } from "../../../shared/api";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { StatusText } from "@/components/StatusText/StatusText";
import { titleOf, useKindViews } from "@/model/kinds";
import { FAKE_PROVIDER_TITLE, isFakeProvider } from "@/model/provider";
import { useModelOptional } from "@/model/useModel";
import type { UiVerdict } from "@/model/status";
import { VerdictSummary } from "../work/panels/VerdictSummary";
import { EvaluationDetail } from "./EvaluationDetail";
import { EXECUTION_FILTERS, VERDICT_FILTERS, evaluationVerdict, newestFirst } from "./lib";
import styles from "./evaluations.module.css";

/** The four filters; `""` is "All". The view keeps them in the URL. */
export interface EvaluationFilters { candidate: string; criterion: string; verdict: string; execution: string }
export const NO_FILTERS: EvaluationFilters = { candidate: "", criterion: "", verdict: "", execution: "" };

interface Props {
  evaluations: readonly Evaluation[];
  /** Hides the filters, the candidate and hook columns (Inspector, candidate review). */
  compact?: boolean;
  /** Controlled expansion (the view keeps it in `?evaluation=`). Uncontrolled when omitted. */
  expandedId?: string | null;
  onExpand?(id: string | null): void;
  /** Controlled filters (the view keeps them in the URL). Uncontrolled when omitted. */
  filters?: EvaluationFilters;
  onFilters?(next: EvaluationFilters): void;
  /** Empty: "{Thing} yet." */
  emptyTitle?: string;
  /** Empty: how evaluations get recorded. */
  emptyHint?: ReactNode;
  /** Empty: the one next step. */
  emptyAction?: ReactNode;
}

const VERDICT_GLYPH: Record<UiVerdict, string> = { pass: "✓", fail: "×", unknown: "?", stale: "↻", "not-run": "–", waived: "⊘" };

/** Verdict in a row: glyph + word, no border; success only for pass, danger only for fail. */
export function VerdictText({ verdict }: { verdict: UiVerdict }) {
  return (
    <span className={styles.verdict} data-verdict={verdict}>
      <StatusText status={verdict} tone={verdict === "pass" ? "pass" : verdict === "fail" ? "fail" : "neutral"} glyph={VERDICT_GLYPH[verdict]} />
    </span>
  );
}

/**
 * Evidence table: filter by candidate / criterion / verdict / execution, grouped by candidate when there are two or
 * more; the whole row expands to the full evaluation (interpretation and limitations first).
 */
export function EvaluationsTable({ evaluations, compact, expandedId, onExpand, filters: controlled, onFilters, emptyTitle, emptyHint, emptyAction }: Props) {
  const uid = useId();
  const m = useModelOptional();
  const kinds = useKindViews();
  const [own, setOwn] = useState<EvaluationFilters>(NO_FILTERS);
  const filters = controlled ?? own;
  const setFilters = (next: EvaluationFilters) => (onFilters ? onFilters(next) : setOwn(next));
  const set = (key: keyof EvaluationFilters) => (v: string) => setFilters({ ...filters, [key]: v });
  const [local, setLocal] = useState<string | null>(null);
  const open = expandedId !== undefined ? expandedId : local;
  const toggle = (id: string) => {
    const next = open === id ? null : id;
    if (onExpand) onExpand(next);
    else setLocal(next);
  };

  const titleOfCriterion = (id: string) => {
    const entry = m?.byId(id);
    return entry ? titleOf(entry, kinds.of(entry.kind)) : id;
  };
  const sorted = useMemo(() => newestFirst(evaluations), [evaluations]);
  const candidates = useMemo(() => [...new Set(evaluations.map((e) => e.candidate))].sort(), [evaluations]);
  const criteria = useMemo(
    () => [...new Set([...evaluations.map((e) => e.criterion), ...(filters.criterion ? [filters.criterion] : [])])].sort(),
    [evaluations, filters.criterion],
  );
  const rows = sorted.filter(
    (e) =>
      (!filters.candidate || e.candidate === filters.candidate) &&
      (!filters.criterion || e.criterion === filters.criterion) &&
      (!filters.verdict || evaluationVerdict(e) === filters.verdict) &&
      (!filters.execution || e.execution === filters.execution),
  );
  const filtered = Object.values(filters).some(Boolean);
  // Two or more candidates: one group each (first seen first, so newest first), headed by its verdict summary.
  const grouped = !compact && new Set(rows.map((e) => e.candidate)).size >= 2;
  const groups: { candidate: string | null; rows: Evaluation[] }[] = [];
  if (grouped) {
    const by = new Map<string, Evaluation[]>();
    for (const e of rows) by.set(e.candidate, [...(by.get(e.candidate) ?? []), e]);
    for (const [candidate, rs] of by) groups.push({ candidate, rows: rs });
  } else {
    groups.push({ candidate: null, rows });
  }

  // `?evaluation=` on arrival: bring the row into view and focus its toggle, once.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || compact || !expandedId) return;
    const el = document.getElementById(`${uid}-toggle-${expandedId}`);
    if (!el) return;
    arrived.current = true;
    el.scrollIntoView?.({ block: "center" });
    el.focus({ preventScroll: true });
  }, [compact, expandedId, uid, rows.length]);

  if (!evaluations.length) {
    return (
      <EmptyState title={emptyTitle ?? "No evaluations yet."} action={emptyAction}>
        {emptyHint ?? "They are recorded when a candidate is submitted or checks are re-run."}
      </EmptyState>
    );
  }

  const cols = 3 + (compact ? 0 : (grouped ? 0 : 1) + 1);
  const criterionLabel = filters.criterion ? titleOfCriterion(filters.criterion) : null;
  const total = filtered ? evaluations.length : rows.length;
  return (
    <div className={styles.wrap}>
      {!compact && (
        <>
          <form className={styles.filters} aria-label="Filter evaluations" onSubmit={(e) => e.preventDefault()}>
            <EvaluationFilter id={`${uid}-c`} label="Candidate" value={filters.candidate} onChange={set("candidate")} options={candidates} />
            <EvaluationFilter id={`${uid}-k`} label="Criterion" value={filters.criterion} onChange={set("criterion")} options={criteria} />
            <EvaluationFilter id={`${uid}-v`} label="Verdict" value={filters.verdict} onChange={set("verdict")} options={VERDICT_FILTERS} />
            <EvaluationFilter id={`${uid}-x`} label="Execution" value={filters.execution} onChange={set("execution")} options={EXECUTION_FILTERS} />
            <div className={styles.tally}>
              <p className={styles.count} role="status">
                <span className="u-numeric">{filtered ? `${rows.length} of ${total}` : total}</span> result{total === 1 ? "" : "s"}
              </p>
              {filtered && <Button type="button" variant="ghost" size="compact" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>}
            </div>
          </form>
          {criterionLabel && (
            <p className={styles.showing}>
              <span>Showing evidence for <strong>{criterionLabel}</strong></span>
              <code className={styles.id}>{filters.criterion}</code>
              <Button type="button" variant="ghost" size="compact" onClick={() => set("criterion")("")}>Clear</Button>
            </p>
          )}
        </>
      )}
      {rows.length === 0 ? (
        <EmptyState
          title="No evaluations match these filters."
          action={!compact && <Button type="button" variant="secondary" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>}
        />
      ) : (
        <table className={styles.table} data-compact={compact ? "" : undefined}>
          <caption className="sr-only">Evaluations, {grouped ? "grouped by candidate, " : ""}newest first</caption>
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Expand</span></th>
              <th scope="col">Criterion</th>
              {!compact && !grouped && <th scope="col">Candidate</th>}
              <th scope="col">Verdict</th>
              <th scope="col">Execution</th>
              {!compact && <th scope="col" className={styles.hookCol}>Hook</th>}
            </tr>
          </thead>
          {groups.map((g) => {
            // Two hooks on one criterion give two rows with one title: the hook tells them apart.
            const titles = g.rows.map((e) => titleOfCriterion(e.criterion));
            const dup = new Set(titles.filter((t, i) => titles.indexOf(t) !== i));
            return (
              <tbody key={g.candidate ?? "all"} className={styles.group}>
                {g.candidate && (
                  <tr className={styles.groupHead}>
                    <th scope="rowgroup" colSpan={cols + 1}>
                      <span className={styles.groupLine}>
                        <code className={styles.id}>{g.candidate}</code>
                        <VerdictSummary verdicts={g.rows.map(evaluationVerdict)} variant="text" />
                      </span>
                    </th>
                  </tr>
                )}
                {g.rows.map((e, i) => {
                  const isOpen = open === e.id;
                  const verdict = evaluationVerdict(e);
                  const plainExecution = e.execution === "completed" || e.execution === verdict;
                  const title = titles[i]!;
                  return (
                    <Fragment key={e.id}>
                      <tr
                        data-open={isOpen || undefined}
                        className={styles.row}
                        onClick={(ev) => {
                          if ((ev.target as HTMLElement).closest("button, a, summary, code")) return;
                          toggle(e.id);
                        }}
                      >
                        <td className={styles.toggle}>
                          <IconButton variant="ghost"
                            id={`${uid}-toggle-${e.id}`}
                            type="button"
                            aria-expanded={isOpen}
                            aria-controls={isOpen ? `${uid}-${e.id}` : undefined}
                            label={`${isOpen ? "Collapse" : "Expand"} evaluation ${e.id}`}
                            onClick={() => toggle(e.id)}
                          >
                            {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                          </IconButton>
                        </td>
                        <td className={styles.criterion}>
                          <span className={styles.title}>{title}</span>
                          {(!compact || dup.has(title)) && (
                            <span className={styles.sub}>
                              {!compact && <code className={styles.id}>{e.criterion}</code>}
                              {dup.has(title) && <code className={styles.id} title={e.hook}>{e.hook}</code>}
                            </span>
                          )}
                        </td>
                        {!compact && !grouped && <td className={styles.candidate}><code className={styles.id} title={e.candidate}>{e.candidate}</code></td>}
                        <td className={styles.verdictCell}>
                          <VerdictText verdict={verdict} />
                          {isFakeProvider(e.provenance?.provider) && <span className={styles.fakeTag} title={FAKE_PROVIDER_TITLE}>fake</span>}
                        </td>
                        <td className={styles.execution} data-plain={plainExecution || undefined}>
                          {e.execution}
                          {e.execution === "error" && <span className={styles.rowError}>{e.error ?? "no message recorded"}</span>}
                        </td>
                        {!compact && <td className={styles.hookCol}><code className={styles.hook} title={e.hook}>{e.hook}</code></td>}
                      </tr>
                      {isOpen && (
                        <tr id={`${uid}-${e.id}`} className={styles.detailRow}>
                          <td className={styles.toggle} />
                          <td colSpan={cols}><EvaluationDetail evaluation={e} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      )}
    </div>
  );
}

function EvaluationFilter({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange(v: string): void; options: readonly string[] }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <Select id={id} value={value} onChange={onChange} options={[{ value: "", label: "All" }, ...options.map((option) => ({ value: option, label: option }))]} />
    </div>
  );
}
