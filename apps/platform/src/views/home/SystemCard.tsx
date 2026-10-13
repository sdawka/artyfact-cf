import { Card } from "@/components/Card/Card";
import { StatusChip } from "@/components/StatusChip/StatusChip";
import { shortRev } from "@/model/revisions";
import { relTime } from "@/model/time";
import { cardSignals, type CardSummary } from "./signifiers";
import styles from "./home.module.css";

/** One System on Home: the System entry selects its sole Thing when there is one, else opens the System overview. */
export function SystemCard({ system, now }: { system: CardSummary; now: number }) {
  const { state, chips } = cardSignals(system);
  const updated = system.updatedAt ? relTime(system.updatedAt, now) : "unknown";
  return (
    <Card as="li" to={`/s/${encodeURIComponent(system.systemId)}`} title={system.title || system.systemId} headingLevel={2} state={state}>
      <p className={styles.meta}>
        <code>{system.systemId}</code>
        <span>Phase: {system.phase ?? "unknown"}</span>
      </p>
      {chips.length > 0 && (
        <p className={styles.chips}>
          {chips.map((c) => (
            <StatusChip key={c.key} status={c.status} label={c.label} tone={c.tone} glyph={c.glyph} title={c.title} />
          ))}
        </p>
      )}
      <p className={styles.footer}>
        <span>head <code>{system.head ? shortRev(system.head) : "unknown"}</code></span>
        <span>updated {updated}</span>
      </p>
    </Card>
  );
}
