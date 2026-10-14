import { memo } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import type { RealizationPlan, Task } from "../../../../shared/lifecycle";
import { StatusText } from "@/components/StatusText/StatusText";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { TaskConflictChips } from "./ConflictChips";
import { blockedOn, conflictsOf, displayStatus, footprintLine, liveAttempt, taskCommand, titleOf } from "./lib";
import { TaskDetail } from "./TaskDetail";
import { TaskStatus } from "./TaskStatus";
import styles from "./plan.module.css";

interface Props {
  task: Task;
  plan: RealizationPlan;
  open: boolean;
  now: number;
  writeReason: string | null;
  commandHidden: boolean;
  onOpen(id: string): void;
}

/**
 * One task in its wave: the whole head toggles the expanded detail in place (`?task=`, one open at a time). Status,
 * "awaits an agent", dependency said once ("waits on" when blocked, else "after"), footprint and non-dependency conflicts.
 */
export const TaskRow = memo(function TaskRow({ task: t, plan, open, now, writeReason, commandHidden, onOpen }: Props) {
  const status = displayStatus(t, plan);
  const waits = blockedOn(t, plan).map((id) => titleOf(plan, id));
  const live = liveAttempt(t, now);
  const command = taskCommand(plan, t, now);
  const detailId = `task-detail-${t.id}`;
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <li className={styles.task} data-open={open || undefined} data-testid={`task-${t.id}`}>
      <button type="button" className={`u-selectable ${open ? "u-selected" : ""} ${styles.taskHead}`} aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => onOpen(t.id)}>
        <span className={styles.taskMain}>
          <span className={styles.taskTitle}>{t.title}</span>
          <MetaLine items={[
            { value: t.artifactId, code: true },
            { value: footprintLine(t) },
            ...(t.dependsOn.length && status !== "blocked" ? [{ label: "after", value: t.dependsOn.map((d) => titleOf(plan, d)).join(", ") }] : []),
            ...(live ? [{ label: live.agentLabel, value: `attempt ${live.generation} ${live.status}` }] : []),
          ]} />
        </span>
        <span className={styles.taskStatus}>
          <TaskStatus status={status} />
          {status === "blocked" && <StatusText status="waits" tone="attention" glyph="" label={`waits on ${waits.join(", ")}`} />}
          {command.verb && <StatusText status="awaits-agent" tone="attention" label="awaits an agent" />}
        </span>
        <Chevron aria-hidden="true" className={styles.chevron} />
      </button>
      <TaskConflictChips conflicts={conflictsOf(plan, t.id)} />
      {open && (
        <TaskDetail id={detailId} task={t} plan={plan} now={now} writeReason={writeReason} commandHidden={commandHidden} onOpenTask={onOpen} />
      )}
    </li>
  );
});
