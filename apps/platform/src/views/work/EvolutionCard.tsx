import { useId } from "react";
import type { Evolution } from "../../../shared/api";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import { useModel } from "@/model/useModel";
import { aggregate } from "./lib";
import styles from "./work.module.css";

const MAX_CHIPS = 4;

/** Board card: intent, kind, affected nodes, acceptance rollup and dependencies. Selecting sets `?evolution=`. */
export function EvolutionCard({ evolution: e, selected, onSelect }: { evolution: Evolution; selected: boolean; onSelect(id: string): void }) {
  const m = useModel();
  const titleId = useId();
  const verdicts = e.acceptanceCriteria.map((c) => m.verdictOf(c));
  const pass = verdicts.filter((v) => v === "pass").length;
  const extra = e.affectedNodes.length - MAX_CHIPS;
  return (
    <button
      type="button"
      className={`u-brackets ${styles.card}`}
      aria-pressed={selected}
      aria-labelledby={titleId}
      onClick={() => onSelect(e.id)}
    >
      <span className={styles.cardTop}>
        <span id={titleId} className={styles.cardTitle}>{e.title}</span>
        <span className={styles.kind} data-kind={e.kind}>{e.kind}</span>
      </span>
      <span className={styles.intent}>{e.intent}</span>
      <span className={styles.chips}>
        {e.affectedNodes.slice(0, MAX_CHIPS).map((id) => <NodeChip key={id} id={id} size="sm" interactive={false} />)}
        {extra > 0 && <span className={styles.muted}>+{extra} more</span>}
      </span>
      <span className={styles.criteria}>
        <span>{e.acceptanceCriteria.length} acceptance criteri{e.acceptanceCriteria.length === 1 ? "on" : "a"}</span>
        <VerdictBadge verdict={aggregate(verdicts)} label={`${pass}/${e.acceptanceCriteria.length} pass`} />
      </span>
      {e.dependsOn.length > 0 && (
        <span className={styles.chips}>
          <span className={styles.muted}>depends on</span>
          {e.dependsOn.map((id) => <NodeChip key={id} id={id} size="sm" interactive={false} />)}
        </span>
      )}
    </button>
  );
}
