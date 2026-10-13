import { useMemo } from "react";
import type { Evolution } from "../../../shared/api";
import { useEvolutions } from "@/api/queries";
import { awaitingReview } from "../review/queue";
import { useReviewQueue } from "../review/useReviewQueue";
import { EvolutionCard } from "./EvolutionCard";
import { COLUMNS } from "./lib";
import styles from "./work.module.css";

/** Evolutions in columns by state. A `withdrawn` column appears only when something is withdrawn. */
export function EvolutionBoard({ evolutions, selectedId, onSelect }: { evolutions: readonly Evolution[]; selectedId: string | null; onSelect(id: string): void }) {
  const signals = useCardSignals();
  const columns = evolutions.some((e) => e.state === "withdrawn") ? [...COLUMNS, { state: "withdrawn" as const, label: "Withdrawn" }] : COLUMNS;
  return (
    <div className={styles.board} role="group" aria-label="Evolution board">
      {columns.map((col) => {
        const items = evolutions.filter((e) => e.state === col.state);
        return (
          <section key={col.state} className={styles.column} aria-labelledby={`col-${col.state}`} data-state={col.state}>
            <h2 id={`col-${col.state}`} className={styles.colHead}>
              {col.label} <span className={styles.count}>{items.length}</span>
            </h2>
            {items.length ? (
              <ul className={styles.cards}>
                {items.map((e) => (
                  <li key={e.id}><EvolutionCard evolution={e} selected={e.id === selectedId} onSelect={onSelect} {...signals.get(e.id)} /></li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>none</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Per Evolution: how many candidates or amendments await review, and whether any of its candidates conflicts. */
function useCardSignals(): Map<string, { awaiting: number; overlap: boolean }> {
  const queue = useReviewQueue();
  const { data: board } = useEvolutions();
  return useMemo(() => {
    const out = new Map<string, { awaiting: number; overlap: boolean }>();
    const evolutionOf = new Map<string, string>();
    for (const r of board?.realizations ?? []) if (r.candidate) evolutionOf.set(r.candidate, r.evolution);
    for (const c of queue.candidates) evolutionOf.set(c.id, c.evolution);
    const conflicted = new Set(queue.conflicts.flatMap((c) => (c.candidates ?? []).map((id) => evolutionOf.get(id)).filter(Boolean)));
    for (const e of new Set([...queue.groups.map((g) => g.evolution), ...conflicted])) {
      if (!e) continue;
      out.set(e, { awaiting: awaitingReview(queue.groups.find((g) => g.evolution === e)), overlap: conflicted.has(e) });
    }
    return out;
  }, [queue, board]);
}
