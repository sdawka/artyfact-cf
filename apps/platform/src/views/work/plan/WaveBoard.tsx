import { useId } from "react";
import type { RealizationPlan, Task } from "../../../../shared/lifecycle";
import { taskById } from "./lib";
import { TaskCard } from "./TaskCard";
import { WaveCommands } from "./WaveCommands";
import workStyles from "../work.module.css";

interface Props {
  plan: RealizationPlan;
  openTask: string | null;
  now: number;
  hidden: ReadonlySet<string>;
  onHide(taskId: string): void;
  onOpen(id: string): void;
}

/** One column per wave of `analysis.waves` (tasks of a wave do not conflict), labelled from 1, with that wave's agent commands. */
export function WaveBoard({ plan, openTask, now, hidden, onHide, onOpen }: Props) {
  const uid = useId();
  const by = taskById(plan);
  return (
    <div className={workStyles.board} role="group" aria-label="Waves">
      {plan.analysis.waves.map((ids, i) => {
        const n = i + 1;
        const tasks = ids.map((id) => by.get(id)).filter((t): t is Task => !!t);
        return (
          <section key={n} className={workStyles.column} aria-labelledby={`${uid}-w${n}`} data-wave={n}>
            <h4 id={`${uid}-w${n}`} className={workStyles.colHead}>
              Wave {n} <span className={workStyles.count}>· {tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span>
            </h4>
            <ul className={workStyles.cards}>
              {tasks.map((t) => (
                <li key={t.id}>
                  <TaskCard task={t} plan={plan} open={t.id === openTask} now={now} onOpen={onOpen} />
                </li>
              ))}
            </ul>
            <WaveCommands plan={plan} wave={n} tasks={tasks} now={now} hidden={hidden} onHide={onHide} />
          </section>
        );
      })}
    </div>
  );
}
