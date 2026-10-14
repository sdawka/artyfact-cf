import { Button } from "@/components/ui";
import { useId } from "react";
import type { RealizationPlan, Task } from "../../../../shared/lifecycle";
import { CopyText } from "../CopyText";
import { taskCommand, waveScript } from "./lib";
import styles from "./plan.module.css";

interface Props {
  plan: RealizationPlan;
  wave: number;
  tasks: Task[];
  now: number;
  /** Tasks whose command the person hid; "Copy all" never copies them again. */
  hidden: ReadonlySet<string>;
  onHide(taskId: string): void;
  /** False when the plan header's primary already copies this wave. */
  copyAll?: boolean;
}

/** The commands of a wave's tasks an agent can take now, shown and not hidden; `waveScript` input for "Copy all". */
export function waveLines(plan: RealizationPlan, tasks: readonly Task[], now: number) {
  return tasks.flatMap((t) => {
    const c = taskCommand(plan, t, now);
    return c.verb ? [{ id: t.id, title: t.title, line: c.line, pair: c.lines }] : [];
  });
}

/**
 * The commands an agent runs for a wave: the claim (or resume) line and the agent subshell for each task it can take now, each
 * with Copy and Hide, and "Copy all" (`waveScript`) over the tasks still shown. The lines carry no credential and every value is
 * shell-quoted: the CLI claims with the person's own admin token and keeps the write token in the task workspace.
 */
export function WaveCommands({ plan, wave, tasks, now, hidden, onHide, copyAll = true }: Props) {
  const uid = useId();
  const lines = waveLines(plan, tasks, now);
  const shown = lines.filter((l) => !hidden.has(l.id));
  if (!lines.length) return null;
  return (
    <section className={styles.commands} aria-labelledby={`${uid}-h`}>
      <div className={styles.commandsHead}>
        <h4 id={`${uid}-h`}>Agent commands, wave {wave}</h4>
        {!copyAll ? null : shown.length ? (
          <CopyText value={waveScript(shown.map((l) => l.pair))} label="Copy all" name={`Copy all, wave ${wave}`} variant="ghost" size="compact" />
        ) : (
          <Button variant="ghost" size="compact" reason="Every command is hidden.">Copy all</Button>
        )}
      </div>
      <ul className={styles.commandList}>
        {lines.map((l) =>
          hidden.has(l.id) ? (
            <li key={l.id} className={styles.hiddenLine}>{l.title}: command hidden.</li>
          ) : (
            <li key={l.id} aria-label={`Command for ${l.title}`}>
              <pre className={styles.commandLine}><code>{l.line}</code></pre>
              <span className={styles.lineActions}>
                <CopyText value={l.line} label="Copy" name={`Copy the command for ${l.title}`} variant="ghost" size="compact" />
                <Button variant="ghost" size="compact" onClick={() => onHide(l.id)} aria-label={`Hide the command for ${l.title}`}>Hide</Button>
              </span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
