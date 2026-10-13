import { useId, useMemo, useState } from "react";
import type { StartWaveResponse, TaskPlan } from "../../../../shared/api";
import { CopyText, PacketViewer } from "../panels/PacketViewer";
import { normalizeStartWork } from "../panels/StartWorkPanel";
import { quote, titleOf } from "./lib";
import workStyles from "../work.module.css";
import styles from "./plan.module.css";

/**
 * What "Start wave n" returned: one Task Packet and one-time start command per started task (each copy-once with its own
 * token countdown), "Copy all commands" for a shell, and the tasks the server skipped with its reason.
 */
export function WaveStartPanel({ result, plan, onClose }: { result: StartWaveResponse; plan: Pick<TaskPlan, "tasks">; onClose(): void }) {
  const uid = useId();
  const started = useMemo(() => result.started.map((s) => ({ task: s.task, ...normalizeStartWork(s) })), [result]);
  // Copy-once holds for "Copy all" too: a command hidden in its own viewer is never copied again from here.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const all = started.filter((s) => !hidden.has(s.task)).map((s) => s.cli).filter((c): c is string => !!c).join("\n");
  const anyCli = started.some((s) => !!s.cli);
  return (
    <section className={workStyles.panel} aria-labelledby={`${uid}-h`}>
      <div className={workStyles.rhead}>
        <h3 id={`${uid}-h`}>Wave {result.wave} started · {started.length} {started.length === 1 ? "task" : "tasks"}</h3>
        {all ? (
          <CopyText value={all} label="Copy all commands" />
        ) : anyCli ? (
          <>
            <button type="button" className={`u-brackets ${workStyles.btn}`} disabled aria-describedby={`${uid}-none`}>Copy all commands</button>
            <span id={`${uid}-none`} className={workStyles.reason}>Every command is hidden; none is shown again.</span>
          </>
        ) : null}
        <button type="button" className={`u-brackets ${workStyles.btn}`} onClick={onClose}>Close</button>
      </div>
      <p className={workStyles.warn} role="note">Each command carries its task's write token and secret. They are shown once; copy them before you close this.</p>
      {result.skipped.length > 0 && (
        <ul className={workStyles.reasons} aria-label="Skipped tasks">
          {result.skipped.map((s) => <li key={s.task}>{quote(titleOf(plan, s.task))} skipped: {s.reason}</li>)}
        </ul>
      )}
      {started.map((s) => (
        <section key={s.task} className={styles.started} aria-label={`Task ${titleOf(plan, s.task)}`}>
          <h4>{titleOf(plan, s.task)} <span className={workStyles.muted}>· <code>{s.realization.id}</code> as {s.realization.agent.id}</span></h4>
          <PacketViewer markdown={s.markdown} cli={s.cli} expiresAt={s.expiresAt} remote={s.remote} onHide={() => setHidden((h) => new Set(h).add(s.task))} />
        </section>
      ))}
    </section>
  );
}
