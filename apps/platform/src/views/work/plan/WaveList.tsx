import type { RealizationPlan, Task } from "../../../../shared/lifecycle";
import { Section } from "@/components/Section/Section";
import { plural, taskById } from "./lib";
import { TaskRow } from "./TaskRow";
import { WaveCommands } from "./WaveCommands";
import styles from "./plan.module.css";

interface Props {
  plan: RealizationPlan;
  openTask: string | null;
  now: number;
  writeReason: string | null;
  hidden: ReadonlySet<string>;
  onHide(taskId: string): void;
  onOpen(id: string): void;
  /** The wave whose "Copy all" is the plan's primary (shown in the plan header, not again in the wave). */
  primaryWave?: number | null;
}

/**
 * The plan's waves top to bottom (waves are an order; tasks of a wave do not conflict), labelled from 1: task rows,
 * then that wave's agent commands on a well. Nothing scrolls sideways.
 */
export function WaveList({ plan, openTask, now, writeReason, hidden, onHide, onOpen, primaryWave = null }: Props) {
  const by = taskById(plan);
  return (
    <div className={styles.waves}>
      {plan.analysis.waves.map((ids, i) => {
        const n = i + 1;
        const tasks = ids.map((id) => by.get(id)).filter((t): t is Task => !!t);
        return (
          <Section key={n} title={`Wave ${n} · ${plural(tasks.length, "task")}`} headingLevel={3} className={styles.wave}>
            <ul className={styles.taskList} aria-label={`Tasks of wave ${n}`}>
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} plan={plan} open={t.id === openTask} now={now} writeReason={writeReason} commandHidden={hidden.has(t.id)} onOpen={onOpen} />
              ))}
            </ul>
            <WaveCommands plan={plan} wave={n} tasks={tasks} now={now} hidden={hidden} onHide={onHide} copyAll={n !== primaryWave} />
          </Section>
        );
      })}
    </div>
  );
}
