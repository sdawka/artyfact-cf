import { useModel } from "@/model/useModel";
import { phenomeCounters } from "./overlayData";
import styles from "./overlays.module.css";

/** Five verdict counters over the node's subtree (within the verdict scope). Only pass is green. */
export function PhenomeBadge({ id }: { id: string }) {
  const counters = phenomeCounters(useModel().rollup(id));
  const summary = counters.map((c) => `${c.count} ${c.label}`).join(", ");
  return (
    <span className={styles.phenome} role="img" aria-label={`Evidence: ${summary}`} title={`Evidence: ${summary}`} data-map-phenome={id}>
      {counters.map((c) => (
        <span key={c.key} className={styles.counter} data-counter={c.key} data-tone={c.tone} {...(c.count === 0 && { "data-zero": "" })}>
          <span aria-hidden="true">{c.glyph}</span>
          {c.count}
        </span>
      ))}
    </span>
  );
}
