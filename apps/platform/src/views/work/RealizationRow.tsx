import { memo } from "react";
import type { Candidate, ConflictReport, Realization } from "../../../shared/api";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { ConflictChips } from "./ConflictChips";
import { relTime, shortSha } from "./lib";
import styles from "./work.module.css";

interface Props {
  realization: Realization;
  candidate?: Candidate | undefined;
  conflicts: readonly ConflictReport[];
  /** Coarse clock; rows re-render when the minute changes, not on every refetch. */
  now: number;
  reviewing: boolean;
  onReview(realizationId: string): void;
}

/** One agent's attempt at an Evolution. Memoised so a refetch with equal data leaves the DOM untouched. */
export const RealizationRow = memo(function RealizationRow({ realization: r, candidate, conflicts, now, reviewing, onReview }: Props) {
  const last = r.checkpoints.at(-1);
  const subjects = (candidate?.changedSubjects ?? []).filter((s) => !s.startsWith("unmapped:"));
  return (
    <li className={styles.rrow} data-status={r.status} data-testid={`realization-${r.id}`}>
      <div className={styles.rhead}>
        <strong>{r.agent.id}</strong>
        <span className={styles.tag}>{r.agent.role}</span>
        <span className={styles.tag}>{r.target}</span>
        <span className={styles.status} data-status={r.status}>{r.status}</span>
      </div>
      <div className={styles.rmeta}>
        fork <code>{r.workspace.fork}</code> at <code>{shortSha(last?.commit ?? r.workspace.baseCommit)}</code>
      </div>
      <div className={styles.rmeta}>
        Last checkpoint: {last ? <>{last.summary} <span className={styles.muted}>· {relTime(last.at, now)}</span></> : "unknown"}
      </div>
      {subjects.length > 0 && (
        <ul className={styles.chips} aria-label="Changed subjects">
          {subjects.map((s) => <li key={s}><NodeChip id={s} size="sm" /></li>)}
        </ul>
      )}
      <ConflictChips conflicts={conflicts} />
      <div className={styles.actions}>
        <button type="button" className={`u-brackets ${styles.btn}`} aria-pressed={reviewing} onClick={() => onReview(r.id)}>
          {reviewing ? "Reviewing" : "Review"} <span className="sr-only">{r.id}</span>
        </button>
      </div>
    </li>
  );
});
