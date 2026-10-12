import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { Journey } from "@/model/types";
import styles from "./JourneyCatalog.module.css";

export interface JourneyCatalogProps {
  journeys: readonly Journey[];
  activeId: string | undefined;
  onSelect(id: string): void;
}

/** Left rail: every journey with its goal and feature chips. Deferred journeys are marked. */
export function JourneyCatalog({ journeys, activeId, onSelect }: JourneyCatalogProps) {
  return (
    <nav aria-label="Journeys" className={styles.catalog}>
      <ul className={styles.list}>
        {journeys.map((j) => (
          <li key={j.id} className={styles.item} data-deferred={j.deferred || undefined}>
            <button
              type="button"
              className={`u-brackets ${j.id === activeId ? "u-brackets--on " : ""}${styles.select}`}
              aria-current={j.id === activeId ? "true" : undefined}
              onClick={() => onSelect(j.id)}
            >
              <span className={styles.name}>
                {j.name}
                {j.deferred && <span className={styles.deferred}>deferred</span>}
              </span>
              <span className={styles.goal}>{j.actorGoal}</span>
            </button>
            {j.features.length > 0 && (
              <span className={styles.features}>
                {j.features.map((f) => (
                  <NodeChip key={f} id={f} size="sm" />
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
