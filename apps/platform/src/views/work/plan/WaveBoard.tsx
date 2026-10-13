import { useId } from "react";
import type { Evolution, TaskPlan } from "../../../../shared/api";
import { canStartWave, taskById } from "./lib";
import { TaskCard } from "./TaskCard";
import workStyles from "../work.module.css";
import styles from "./plan.module.css";

interface Props {
  plan: TaskPlan;
  evolution: Evolution;
  fixture: boolean;
  openTask: string | null;
  onOpen(id: string): void;
  selected: ReadonlySet<string>;
  onSelect?: ((id: string, on: boolean) => void) | undefined;
  starting: number | null;
  onStart(wave: number): void;
}

/** One column per wave (tasks of a wave share no files), each with its Start button and the reason when it cannot start. */
export function WaveBoard({ plan, evolution, fixture, openTask, onOpen, selected, onSelect, starting, onStart }: Props) {
  const uid = useId();
  const by = taskById(plan);
  return (
    <div className={workStyles.board} role="group" aria-label="Waves">
      {plan.waves.map((ids, i) => {
        const n = i + 1;
        const tasks = ids.map((id) => by.get(id)).filter((t) => !!t);
        const reason = canStartWave(plan, n, { fixture, evolution });
        const why = `${uid}-why-${n}`;
        return (
          <section key={n} className={workStyles.column} aria-labelledby={`${uid}-w${n}`} data-wave={n}>
            <div className={styles.colTop}>
              <h4 id={`${uid}-w${n}`} className={workStyles.colHead}>
                Wave {n} <span className={workStyles.count}>· {tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span>
              </h4>
              <button
                type="button"
                className={`u-brackets ${workStyles.primary}`}
                disabled={!!reason || starting !== null}
                aria-describedby={reason ? why : undefined}
                onClick={() => onStart(n)}
              >
                {starting === n ? `Starting wave ${n}…` : `Start wave ${n}`}
              </button>
              {reason && <span id={why} className={workStyles.reason}>{reason}</span>}
            </div>
            <ul className={workStyles.cards}>
              {tasks.map((t) => (
                <li key={t.id}>
                  <TaskCard task={t} plan={plan} open={t.id === openTask} onOpen={onOpen} selected={selected.has(t.id)} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
