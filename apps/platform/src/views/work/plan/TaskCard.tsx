import { memo, useId } from "react";
import type { Task, TaskPlan } from "../../../../shared/api";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { ConflictChips } from "../ConflictChips";
import { blockedOn, conflictReports, displayStatus, footprintLine, titleOf } from "./lib";
import { TaskStatus } from "./TaskStatus";
import workStyles from "../work.module.css";
import styles from "./plan.module.css";

const MAX_CHIPS = 4;

interface Props {
  task: Task;
  plan: TaskPlan;
  open: boolean;
  onOpen(id: string): void;
  /** Merge selection; absent when the plan is read-only. */
  selected?: boolean;
  onSelect?: ((id: string, on: boolean) => void) | undefined;
}

/** One task in a wave column: title (opens the detail), status, nodes, footprint size, dependencies and conflicts. */
export const TaskCard = memo(function TaskCard({ task: t, plan, open, onOpen, selected = false, onSelect }: Props) {
  const titleId = useId();
  const status = displayStatus(t, plan);
  const waits = blockedOn(t, plan).map((id) => titleOf(plan, id));
  const title = (id: string) => titleOf(plan, id);
  const extra = t.nodes.length - MAX_CHIPS;
  return (
    <article className={styles.task} aria-labelledby={titleId} data-open={open} data-status={status} data-testid={`task-${t.id}`}>
      <div className={styles.taskTop}>
        {onSelect && (
          <input type="checkbox" checked={selected} onChange={(e) => onSelect(t.id, e.target.checked)} aria-label={`Select ${t.title}`} disabled={t.status !== "planned"} />
        )}
        <button id={titleId} type="button" className={styles.taskTitle} aria-expanded={open} onClick={() => onOpen(t.id)}>{t.title}</button>
        <TaskStatus status={status} {...(waits.length > 0 && { title: `Waits on ${waits.join(", ")}` })} />
      </div>
      <span className={workStyles.chips}>
        {t.nodes.slice(0, MAX_CHIPS).map((id) => <NodeChip key={id} id={id} size="sm" interactive={false} />)}
        {extra > 0 && <span className={workStyles.muted}>+{extra} more</span>}
      </span>
      <span className={workStyles.muted}>{footprintLine(t)}</span>
      {t.dependsOn.length > 0 && (
        <span className={workStyles.chips}>
          <span className={workStyles.muted}>depends on</span>
          {t.dependsOn.map((d) => <span key={d} className={workStyles.tag}>{title(d)}</span>)}
        </span>
      )}
      <ConflictChips conflicts={conflictReports(plan.conflicts, t.id, title)} />
      {t.status === "claimed" && (
        <span className={workStyles.attention}>awaits an agent{t.claim ? ` · claimed by ${t.claim.agentLabel}` : ""}</span>
      )}
    </article>
  );
});
