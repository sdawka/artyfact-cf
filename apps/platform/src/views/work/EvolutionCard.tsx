import { useId } from "react";
import type { Evolution } from "../../../shared/api";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import { useModel } from "@/model/useModel";
import { aggregate } from "./lib";
import { planLine, taskSignals } from "./plan/signals";
import styles from "./work.module.css";

const MAX_CHIPS = 4;

interface Props {
  evolution: Evolution;
  selected: boolean;
  onSelect(id: string): void;
  /** Candidates or amendments of this Evolution waiting in Review. */
  awaiting?: number;
  /** Any of its candidates is in a conflict. */
  overlap?: boolean;
}

/**
 * Board card: intent, kind, affected nodes, acceptance rollup, dependencies, and the attention line (overlap, awaiting
 * review). Selecting sets `?evolution=`.
 */
export function EvolutionCard({ evolution: e, selected, onSelect, awaiting = 0, overlap = false }: Props) {
  const m = useModel();
  const titleId = useId();
  const verdicts = e.acceptanceCriteria.map((c) => m.verdictOf(c));
  const pass = verdicts.filter((v) => v === "pass").length;
  const plan = planLine(taskSignals(e));
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
      {plan && <span className={styles.attention} data-testid="plan-line">{plan}</span>}
      {(overlap || awaiting > 0) && (
        <span className={styles.criteria}>
          {overlap && <span className={styles.overlapChip}><span aria-hidden="true">≈</span> overlap</span>}
          {awaiting > 0 && <span className={styles.attention}>{awaiting} await{awaiting === 1 ? "s" : ""} review</span>}
        </span>
      )}
      {e.dependsOn.length > 0 && (
        <span className={styles.chips}>
          <span className={styles.muted}>depends on</span>
          {e.dependsOn.map((id) => <NodeChip key={id} id={id} size="sm" interactive={false} />)}
        </span>
      )}
    </button>
  );
}
