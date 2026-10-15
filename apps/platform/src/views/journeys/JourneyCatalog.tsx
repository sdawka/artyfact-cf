import { Row, RowList } from "@/components/RowList/RowList";
import { StatusText } from "@/components/StatusText/StatusText";
import type { Journey } from "@/model/types";
import { useModel } from "@/model/useModel";
import styles from "./JourneyCatalog.module.css";

export interface JourneyCatalogProps {
  journeys: readonly Journey[];
  activeId: string | undefined;
  onSelect(id: string): void;
}

/** Journeys in catalog order, deferred ones last (stable within each group). */
export function orderedJourneys(journeys: readonly Journey[]): Journey[] {
  return [...journeys.filter((j) => !j.deferred), ...journeys.filter((j) => j.deferred)];
}

/** Left catalog with its own scroll: one row per journey (name, goal, what it uses); deferred journeys collapse last. */
export function JourneyCatalog({ journeys, activeId, onSelect }: JourneyCatalogProps) {
  const { index } = useModel();
  const active = journeys.filter((j) => !j.deferred);
  const deferred = journeys.filter((j) => j.deferred);
  const row = (j: Journey) => {
    const names = j.features.map((f) => index.byId(f)?.name ?? f);
    return (
      <Row
        key={j.id} current={j.id === activeId} onSelect={() => onSelect(j.id)}
        title={j.name}
        meta={<><span className={styles.goal}>{j.actorGoal}</span>{names.length > 0 && <span className={styles.uses}>Uses {names.slice(0, 2).join(", ")}{names.length > 2 ? ` +${names.length - 2}` : ""}</span>}</>}
        status={j.deferred ? <StatusText status="deferred" /> : undefined}
      />
    );
  };
  // A deferred journey that is selected keeps its group open so the current row stays visible.
  const open = deferred.some((j) => j.id === activeId);
  return (
    <nav aria-label="Journeys" className={styles.catalog}>
      <RowList label="Journeys in this System">{active.map(row)}</RowList>
      {deferred.length > 0 && (
        <details className={styles.deferred} open={open} key={open ? "open" : "closed"}>
          <summary>Deferred ({deferred.length})</summary>
          <RowList label="Deferred journeys">{deferred.map(row)}</RowList>
        </details>
      )}
    </nav>
  );
}
