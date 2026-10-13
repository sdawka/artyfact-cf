import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useChangelog } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { useFxOnArrival } from "@/effects/fx";
import { useKeepParams } from "@/model/useSelection";
import { useNow } from "@/model/time";
import { NewEvolutionPanel } from "@/views/work/panels/NewEvolutionPanel";
import { CommitRow } from "./CommitRow";
import { evolutionOptions } from "./summary";
import styles from "./changelog.module.css";

/** System commits newest first; a row expands into its entry. `?commit=` expands and marks one; `?evolution=` filters. */
export default function ChangelogView() {
  const q = useChangelog();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const href = useKeepParams();
  const now = useNow(60_000);
  const evolution = params.get("evolution") ?? "";
  const current = params.get("commit");
  const creating = params.get("panel") === "new";
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(current ? [current] : []));

  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data]);
  useFxOnArrival(q.data ? rows : undefined, (r) => r.id, () => ({ kind: "commit" }));
  const evolutions = useMemo(() => evolutionOptions(rows), [rows]);
  const shown = evolution ? rows.filter((r) => r.evolutions.some((e) => e.id === evolution)) : rows;

  useEffect(() => {
    if (!current) return;
    setExpanded((prev) => (prev.has(current) ? prev : new Set([...prev, current])));
    document.getElementById(`commit-${current}`)?.scrollIntoView?.({ block: "nearest" });
  }, [current, rows.length]);

  const setParam = (key: string, v: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set(key, v);
      else next.delete(key);
      return next;
    }, { replace: true });
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section aria-labelledby="view-title" className={styles.view}>
      <h1 id="view-title">Changelog</h1>
      <div className={styles.toolbar}>
        <label htmlFor="changelog-evolution">Evolution</label>
        <select id="changelog-evolution" value={evolution} onChange={(e) => setParam("evolution", e.target.value || null)}>
          <option value="">All</option>
          {evolutions.map((e) => <option key={e.id} value={e.id}>{e.title ? `${e.title} (${e.id})` : e.id}</option>)}
          {evolution && !evolutions.some((e) => e.id === evolution) && <option value={evolution}>{evolution}</option>}
        </select>
        <button
          type="button"
          className={`u-brackets ${styles.btn} ${styles.push}`}
          aria-pressed={creating}
          onClick={() => setParam("panel", creating ? null : "new")}
        >
          + Evolution
        </button>
      </div>
      {creating && (
        <NewEvolutionPanel
          onCreated={(e) => void navigate(href("work", { evolution: e.id }))}
          onCancel={() => setParam("panel", null)}
        />
      )}
      {q.isLoading ? (
        <p role="status">Loading the changelog…</p>
      ) : q.isError ? (
        <EmptyState
          title="Could not load the changelog."
          action={<button type="button" className={`u-brackets ${styles.btn}`} onClick={() => void q.refetch()}>Retry</button>}
        >
          The System commits could not be fetched. This is not the same as having none.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState surface="dusk" title="No System commits yet: nothing has been promoted.">
          A System commit is created when a System is imported or candidates are promoted with a recorded rationale.
        </EmptyState>
      ) : shown.length === 0 ? (
        <p role="status" className={styles.muted}>No commits include {evolution}.</p>
      ) : (
        <>
          <ol aria-label="System commits, newest first" className={styles.list}>
            {shown.map((r) => (
              <CommitRow key={r.id} row={r} now={now} expanded={expanded.has(r.id)} current={r.id === current} onToggle={() => toggle(r.id)} />
            ))}
          </ol>
          {q.hasNextPage && (
            <button type="button" className={`u-brackets ${styles.btn}`} disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {q.isFetchingNextPage ? "Loading…" : "Load older commits"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
