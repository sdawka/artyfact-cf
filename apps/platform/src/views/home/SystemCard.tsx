import { Card } from "@/components/Card/Card";
import { StatusChip } from "@/components/StatusChip/StatusChip";
import { shortRev } from "@/model/revisions";
import { relTime } from "@/model/time";
import { DEFAULT_REV, viewPath } from "@/model/useSelection";
import { cardSignals, type CardSummary } from "./signifiers";
import styles from "./home.module.css";

/** One System on Home: the whole card links to its Overview. */
export function SystemCard({ system, now }: { system: CardSummary; now: number }) {
  const { state, chips } = cardSignals(system);
  return (
    <Card as="li" to={viewPath(system.systemId, DEFAULT_REV, "overview")} title={system.title || system.systemId} headingLevel={2} state={state}>
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
        <span>{system.updatedAt && relTime(system.updatedAt, now) !== "unknown" ? `updated ${relTime(system.updatedAt, now)}` : "updated unknown"}</span>
      </p>
    </Card>
  );
}
