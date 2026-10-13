import { useId, useState } from "react";
import type { Task, TaskPlan } from "../../../../shared/api";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import { useModel } from "@/model/useModel";
import { canSplit, displayStatus, splitTask, titleOf, waveOf, whyWave } from "./lib";
import { TaskStatus } from "./TaskStatus";
import workStyles from "../work.module.css";
import styles from "./plan.module.css";

interface Props {
  task: Task;
  plan: TaskPlan;
  /** Why the plan cannot be edited (fixture), or null. */
  readOnly: string | null;
  saving: boolean;
  error: string | null;
  /** Sends the whole new task list (`PUT …/plan`). */
  onSave(tasks: Task[]): void;
  onOpenTask(id: string): void;
  onOpenRealization(id: string): void;
  onClose(): void;
}

/** `?task=`: rename and re-intent a task, its footprint and criteria, why it is in its wave, its realization, and Split. */
export function TaskDetail({ task: t, plan, readOnly, saving, error, onSave, onOpenTask, onOpenRealization, onClose }: Props) {
  const uid = useId();
  const m = useModel();
  const [title, setTitle] = useState(t.title);
  const [intent, setIntent] = useState(t.intent);
  const [moving, setMoving] = useState<string[]>([]);
  const [splitTitle, setSplitTitle] = useState("");
  const dirty = title.trim() !== t.title || intent.trim() !== t.intent;
  const splitReason = readOnly ?? canSplit(t, moving);
  const n = waveOf(plan, t.id);
  const fp = t.footprint;

  const save = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (readOnly || !dirty || !title.trim()) return;
    onSave(plan.tasks.map((x) => (x.id === t.id ? { ...x, title: title.trim(), intent: intent.trim(), origin: "user" } : x)));
  };
  const split = () => {
    if (splitReason) return;
    onSave(splitTask(plan.tasks, t.id, moving, splitTitle));
    setMoving([]);
    setSplitTitle("");
  };

  return (
    <section className={workStyles.panel} aria-labelledby={`${uid}-h`} data-testid="task-detail">
      <div className={workStyles.rhead}>
        <h3 id={`${uid}-h`}>{t.title}</h3>
        <TaskStatus status={displayStatus(t, plan)} />
        <button type="button" className={`u-brackets ${workStyles.btn}`} onClick={onClose}>Close task</button>
      </div>

      <form onSubmit={save} className={workStyles.form}>
        <div className={workStyles.field}>
          <label htmlFor={`${uid}-t`}>Task title</label>
          <input id={`${uid}-t`} value={title} onChange={(e) => setTitle(e.target.value)} disabled={!!readOnly} autoComplete="off" />
        </div>
        <div className={workStyles.field}>
          <label htmlFor={`${uid}-i`}>Task intent</label>
          <textarea id={`${uid}-i`} value={intent} onChange={(e) => setIntent(e.target.value)} disabled={!!readOnly} rows={3} />
        </div>
        <div className={workStyles.actions}>
          <button type="submit" className={`u-brackets ${workStyles.primary}`} disabled={!!readOnly || !dirty || !title.trim() || saving} aria-describedby={readOnly ? `${uid}-ro` : undefined}>
            {saving ? "Saving…" : "Save task"}
          </button>
          {readOnly && <span id={`${uid}-ro`} className={workStyles.reason}>{readOnly}</span>}
        </div>
        {error && <p role="alert" className={workStyles.error}>{error}</p>}
      </form>

      <h4>Why wave {n ?? "?"}</h4>
      <p>{whyWave(plan, t.id)}</p>

      <h4>Footprint</h4>
      <p className={workStyles.muted}>Computed from the nodes' files bindings{fp.appCommit ? ` at ${fp.appCommit.slice(0, 7)}` : ""}.</p>
      <div className={workStyles.group}>
        <h4>Nodes</h4>
        <span className={workStyles.chips}>{t.nodes.map((id) => <NodeChip key={id} id={id} size="sm" />)}</span>
      </div>
      <div className={workStyles.group}>
        <h4>Globs</h4>
        {fp.globs.length ? <ul className={styles.paths}>{fp.globs.map((g) => <li key={g}>{g}</li>)}</ul> : <p className={workStyles.muted}>none</p>}
      </div>
      <div className={workStyles.group}>
        <h4>Paths</h4>
        {fp.paths.length ? <ul className={styles.paths}>{fp.paths.map((p) => <li key={p}>{p}</li>)}</ul> : <p className={workStyles.muted}>No file matches yet.</p>}
        {fp.unmatched.length > 0 && <p className={workStyles.muted}>Match nothing yet (files the task may create): {fp.unmatched.join(", ")}</p>}
      </div>
      <div className={workStyles.group}>
        <h4>Entry files</h4>
        {fp.entryFiles.length ? (
          <ul className={styles.paths}>{fp.entryFiles.map((f) => <li key={f.path}>{f.path} <span className={workStyles.muted}>({f.certainty})</span></li>)}</ul>
        ) : <p className={workStyles.muted}>none</p>}
      </div>

      <h4>Acceptance criteria</h4>
      {t.acceptanceCriteria.length ? (
        <ul className={workStyles.plain}>
          {t.acceptanceCriteria.map((c) => <li key={c} className={workStyles.inlineRow}><NodeChip id={c} size="sm" /><VerdictBadge verdict={m.verdictOf(c)} /></li>)}
        </ul>
      ) : <p className={workStyles.muted}>none</p>}

      <h4>Depends on</h4>
      {t.dependsOn.length ? (
        <ul className={workStyles.chips}>
          {t.dependsOn.map((d) => (
            <li key={d}><button type="button" className={workStyles.textBtn} onClick={() => onOpenTask(d)}>{titleOf(plan, d)}</button></li>
          ))}
        </ul>
      ) : <p className={workStyles.muted}>Nothing; it can start in its wave.</p>}

      <h4>Status</h4>
      <p>
        {t.status}
        {t.claim && <> · claimed by {t.claim.agentLabel}</>}
        {t.realizationId && (
          <> · <button type="button" className={workStyles.textBtn} onClick={() => onOpenRealization(t.realizationId!)}>Open {t.realizationId}</button></>
        )}
      </p>

      {t.nodes.length > 1 && (
        <fieldset className={workStyles.fieldset}>
          <legend>Split</legend>
          <p className={workStyles.muted}>Move the checked nodes to a new task; tasks that depend on this one will depend on both.</p>
          {t.nodes.map((id) => (
            <label key={id} className={workStyles.check}>
              <input
                type="checkbox"
                checked={moving.includes(id)}
                disabled={!!readOnly || t.status !== "planned"}
                onChange={(e) => setMoving((xs) => (e.target.checked ? [...xs, id] : xs.filter((x) => x !== id)))}
              />
              {m.byId(id)?.name ?? id}
            </label>
          ))}
          <div className={workStyles.field}>
            <label htmlFor={`${uid}-s`}>New task title</label>
            <input id={`${uid}-s`} value={splitTitle} onChange={(e) => setSplitTitle(e.target.value)} placeholder={`${t.title} (split)`} disabled={!!readOnly} autoComplete="off" />
          </div>
          <div className={workStyles.actions}>
            <button type="button" className={`u-brackets ${workStyles.btn}`} disabled={!!splitReason || saving} aria-describedby={splitReason ? `${uid}-sr` : undefined} onClick={split}>Split</button>
            {splitReason && <span id={`${uid}-sr`} className={workStyles.reason}>{splitReason}</span>}
          </div>
        </fieldset>
      )}
    </section>
  );
}
