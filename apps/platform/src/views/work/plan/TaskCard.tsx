import { memo, useId } from "react";
import type { RealizationPlan, Task } from "../../../../shared/lifecycle";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { TaskConflictChips } from "./ConflictChips";
import { blockedOn, conflictsOf, displayStatus, footprintLine, liveAttempt, taskCommand, titleOf } from "./lib";
import { TaskStatus } from "./TaskStatus";
import workStyles from "../work.module.css";
import styles from "./plan.module.css";

const MAX_CHIPS = 4;

interface Props {
  task: Task;
  plan: RealizationPlan;
  open: boolean;
  now: number;
  onOpen(id: string): void;
}

/** One task in a wave column: title (opens the detail), status, write nodes, footprint, dependencies and conflicts. */
export const TaskCard = memo(function TaskCard({ task: t, plan, open, now, onOpen }: Props) {
  const titleId = useId();
  const status = displayStatus(t, plan);
  const waits = blockedOn(t, plan).map((id) => titleOf(plan, id));
  const live = liveAttempt(t, now);
  const command = taskCommand(plan, t, now);
  const extra = t.writeNodes.length - MAX_CHIPS;
  return (
    <article className={styles.task} aria-labelledby={titleId} data-open={open} data-status={status} data-testid={`task-${t.id}`}>
      <div className={styles.taskTop}>
        <button id={titleId} type="button" className={styles.taskTitle} aria-pressed={open} onClick={() => onOpen(t.id)}>{t.title}</button>
        <TaskStatus status={status} />
      </div>
      <span className={workStyles.chips} aria-label="Writes">
        {t.writeNodes.slice(0, MAX_CHIPS).map((id) => <NodeChip key={id} id={id} size="sm" interactive={false} />)}
        {extra > 0 && <span className={workStyles.muted}>+{extra} more</span>}
      </span>
      <span className={workStyles.muted}><code>{t.artifactId}</code> · {footprintLine(t)}</span>
      {t.dependsOn.length > 0 && (
        <span className={workStyles.chips}>
          <span className={workStyles.muted}>depends on</span>
          {t.dependsOn.map((d) => <span key={d} className={workStyles.tag}>{titleOf(plan, d)}</span>)}
        </span>
      )}
      {status === "blocked" && <span className={workStyles.attention}>waits on {waits.join(", ")}</span>}
      <TaskConflictChips conflicts={conflictsOf(plan, t.id)} />
      {command.verb && <span className={workStyles.attention}>awaits an agent</span>}
      {live && <span className={workStyles.muted}>{live.agentLabel} · attempt {live.generation} · {live.status}</span>}
    </article>
  );
});
