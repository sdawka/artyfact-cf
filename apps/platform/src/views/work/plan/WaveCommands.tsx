import { useId } from "react";
import type { RealizationPlan, Task } from "../../../../shared/lifecycle";
import { CopyButton } from "@/components/CopyButton/CopyButton";
import { taskCommand, waveScript } from "./lib";
import workStyles from "../work.module.css";
import styles from "./plan.module.css";

interface Props {
  plan: RealizationPlan;
  wave: number;
  tasks: Task[];
  now: number;
  /** Tasks whose command the person hid; "Copy all" never copies them again. */
  hidden: ReadonlySet<string>;
  onHide(taskId: string): void;
}

/**
 * The commands an agent runs for a wave: the claim (or resume) line and the agent subshell for each task it can take now, each
 * with a copy button and Hide, and "Copy all" (`waveScript`) over the tasks still shown. The lines carry no credential and every value is
 * shell-quoted: the CLI claims with the person's own admin token and keeps the write token in the task workspace.
 */
export function WaveCommands({ plan, wave, tasks, now, hidden, onHide }: Props) {
  const uid = useId();
  const rows = tasks.map((t) => ({ t, c: taskCommand(plan, t, now) }));
  const lines = rows.flatMap(({ t, c }) => (c.verb ? [{ id: t.id, title: t.title, line: c.line, pair: c.lines }] : []));
  const shown = lines.filter((l) => !hidden.has(l.id));
  if (!lines.length) return null;
  return (
    <section className={styles.commands} aria-labelledby={`${uid}-h`}>
      <div className={styles.commandsHead}>
        <h5 id={`${uid}-h`}>Agent commands · wave {wave}</h5>
        {shown.length ? (
          <CopyButton value={waveScript(shown.map((l) => l.pair))} label="Copy all" />
        ) : (
          <>
            <button type="button" className={`u-brackets ${workStyles.btn}`} disabled aria-describedby={`${uid}-none`}>Copy all</button>
            <span id={`${uid}-none`} className={workStyles.reason}>Every command is hidden.</span>
          </>
        )}
      </div>
      <p className={workStyles.muted}>Run with ARTYFACT_ADMIN_TOKEN set in your shell; the agent line unsets it. Copy all starts each agent once its claim succeeds, side by side.</p>
      <ul className={styles.commandList}>
        {lines.map((l) =>
          hidden.has(l.id) ? (
            <li key={l.id} className={workStyles.muted}>{l.title}: command hidden.</li>
          ) : (
            <li key={l.id} aria-label={`Command for ${l.title}`}>
              <code className={styles.commandLine}>{l.line}</code>
              <span className={workStyles.inlineRow}>
                <CopyButton value={l.line} />
                <button type="button" className={`u-brackets ${workStyles.btn}`} onClick={() => onHide(l.id)} aria-label={`Hide the command for ${l.title}`}>Hide</button>
              </span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
