import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { useHistory } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { CommitView } from "./CommitCard";
import { Timeline } from "./Timeline";
import styles from "./history.module.css";

/** Vertical timeline of System commits, newest first, filterable by Evolution. `?commit=` highlights one. */
export default function HistoryView() {
  const { data, isLoading } = useHistory();
  const [params, setParams] = useSearchParams();
  const evolution = params.get("evolution") ?? "";
  const highlight = params.get("commit");

  const commits = useMemo(
    () => [...(data ?? [])].sort((a, b) => b.decision.at.localeCompare(a.decision.at)) as CommitView[],
    [data],
  );
  const evolutions = useMemo(() => [...new Set(commits.flatMap((c) => c.evolutions))].sort(), [commits]);
  const shown = evolution ? commits.filter((c) => c.evolutions.includes(evolution)) : commits;
  const setEvolution = (v: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set("evolution", v);
      else next.delete("evolution");
      return next;
    }, { replace: true });

  return (
    <section aria-labelledby="view-title" className={styles.view}>
      <h1 id="view-title">History</h1>
      {isLoading ? (
        <p role="status">Loading history…</p>
      ) : commits.length === 0 ? (
        <EmptyState title="No System commits yet — nothing has been promoted.">
          A System commit is created when candidates are promoted with a recorded rationale.
        </EmptyState>
      ) : (
        <>
          <div className={styles.filter}>
            <label htmlFor="history-evolution">Evolution</label>
            <select id="history-evolution" value={evolution} onChange={(e) => setEvolution(e.target.value)}>
              <option value="">All</option>
              {evolutions.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
            {evolution && <NodeChip id={evolution} size="sm" />}
          </div>
          {shown.length ? (
            <Timeline commits={shown} highlight={highlight} />
          ) : (
            <p role="status" className={styles.muted}>No commits include {evolution}.</p>
          )}
        </>
      )}
    </section>
  );
}
