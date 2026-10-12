import type { Evolution } from "../../../shared/api";
import { EvolutionCard } from "./EvolutionCard";
import { COLUMNS } from "./lib";
import styles from "./work.module.css";

/** Evolutions in columns by state. A `withdrawn` column appears only when something is withdrawn. */
export function EvolutionBoard({ evolutions, selectedId, onSelect }: { evolutions: readonly Evolution[]; selectedId: string | null; onSelect(id: string): void }) {
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
                  <li key={e.id}><EvolutionCard evolution={e} selected={e.id === selectedId} onSelect={onSelect} /></li>
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
