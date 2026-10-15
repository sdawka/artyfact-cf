import { StatusText } from "@/components/StatusText/StatusText";
import { useModel } from "@/model/useModel";
import { phenomeCounters } from "./overlayData";
import styles from "./overlays.module.css";

/** Verdict words over the node's subtree (within the verdict scope): only counts above zero, only pass is green. */
export function PhenomeBadge({ id }: { id: string }) {
  const counters = phenomeCounters(useModel().rollup(id));
  const summary = counters.map((c) => `${c.count} ${c.label}`).join(", ");
  const shown = counters.filter((c) => c.count > 0);
  return (
    <span className={styles.phenome} role="img" aria-label={`Evidence: ${summary}`} title={`Evidence: ${summary}`} data-map-phenome={id}>
      {shown.length === 0 && <span className={styles.none}>No evidence yet</span>}
      {shown.map((c) => (
        <span key={c.key} data-counter={c.key} data-tone={c.tone}>
          <StatusText status={c.key} label={`${c.count} ${c.label}`} tone={c.tone === "subtle" ? "neutral" : c.tone} glyph={c.glyph} />
        </span>
      ))}
    </span>
  );
}
