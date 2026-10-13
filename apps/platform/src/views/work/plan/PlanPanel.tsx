import { useCallback, useId, useState } from "react";
import type { Evolution, StartWaveResponse, Task } from "../../../../shared/api";
import { useAdminToken } from "@/api/adminToken";
import { ApiRequestError } from "@/api/client";
import { usePlan, usePlanEvolution, useStartWave, useUpdatePlan } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { useModel } from "@/model/useModel";
import { useParam } from "../lib";
import { canEdit, canMerge, canPlan, mergeTasks, planCounts, planError, planUpdate } from "./lib";
import { SAMPLE_PLAN } from "./sample";
import { TaskDetail } from "./TaskDetail";
import { WaveBoard } from "./WaveBoard";
import { WaveStartPanel } from "./WaveStartPanel";
import workStyles from "../work.module.css";
import styles from "./plan.module.css";

const EMPTY = new Set<string>();

/**
 * `?panel=plan`: the Evolution's Tasks in wave columns. No plan → "Plan tasks". Toolbar: counts, Re-plan (inline confirm),
 * Merge selected. `?task=` opens the task's detail; "Start wave n" shows each started task's packet and one-time command.
 * Fixture data shows a read-only sample for `evolution.1`.
 */
export function PlanPanel({ evolution: e }: { evolution: Evolution }) {
  const uid = useId();
  const m = useModel();
  const fixture = m.bundle.source === "fixture";
  const { token } = useAdminToken();
  const adminToken = token || undefined;
  const q = usePlan(e.id, { enabled: !fixture });
  const plan = fixture ? (e.id === SAMPLE_PLAN.evolutionId ? SAMPLE_PLAN : undefined) : q.data;
  const noPlan = fixture ? !plan : q.error instanceof ApiRequestError && q.error.status === 404;

  const [taskId, setTask] = useParam("task");
  const [, setRealization] = useParam("realization");
  const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY);
  const [confirmReplan, setConfirmReplan] = useState(false);
  const [started, setStarted] = useState<StartWaveResponse | null>(null);
  const create = usePlanEvolution();
  const update = useUpdatePlan();
  const start = useStartWave();

  const readOnly = canEdit({ fixture });
  const planReason = canPlan({ fixture, evolution: e });
  const openTask = useCallback((id: string) => setTask(id === taskId ? null : id), [setTask, taskId]);
  const onSelect = useCallback(
    (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; }),
    [],
  );

  const runPlan = (force: boolean) =>
    create.mutate({ evolutionId: e.id, body: force ? { force } : {}, ...(adminToken && { adminToken }) }, { onSuccess: () => { setConfirmReplan(false); setSelected(EMPTY); } });
  const save = (tasks: Task[]) => update.mutate({ evolutionId: e.id, body: planUpdate(tasks), ...(adminToken && { adminToken }) });
  const startWave = (wave: number) =>
    start.mutate({ evolutionId: e.id, wave, ...(adminToken && { adminToken }) }, { onSuccess: (res) => setStarted(res) });

  if (!fixture && q.isPending) return <section className={workStyles.panel} aria-label="Plan"><p className={workStyles.muted} role="status">Loading the plan…</p></section>;

  if (noPlan || !plan) {
    const failed = !noPlan && q.isError;
    return (
      <section className={workStyles.panel} aria-labelledby={`${uid}-h`}>
        <h3 id={`${uid}-h`}>Plan</h3>
        {failed ? (
          <p role="alert" className={workStyles.error}>{planError("Reading the plan", q.error)}</p>
        ) : (
          <EmptyState
            title="No plan yet."
            action={
              <span className={workStyles.actions}>
                <button type="button" className={`u-brackets ${workStyles.primary}`} disabled={!!planReason || create.isPending} aria-describedby={planReason ? `${uid}-why` : undefined} onClick={() => runPlan(false)}>
                  {create.isPending ? "Planning…" : "Plan tasks"}
                </button>
                {planReason && <span id={`${uid}-why`} className={workStyles.reason}>{planReason}</span>}
              </span>
            }
          >
            Split this Evolution into Tasks by the files its nodes bind. Tasks that share no files run side by side in one wave.
          </EmptyState>
        )}
        {create.isError && <p role="alert" className={workStyles.error}>{planError("Planning tasks", create.error)}</p>}
      </section>
    );
  }

  const task = taskId ? plan.tasks.find((t) => t.id === taskId) : undefined;
  const picked = [...selected].filter((id) => plan.tasks.some((t) => t.id === id));
  const mergeReason = readOnly ?? canMerge(plan.tasks, picked);
  const replanReason = readOnly ?? planReason ?? (plan.tasks.some((t) => t.status !== "planned") ? "Tasks have started; a re-plan would discard them." : null);
  // One visible reason per distinct cause: in fixture mode both buttons point at the same line.
  const reasonId = (r: string | null, own: string) => (!r ? undefined : r === readOnly ? `${uid}-ro` : own);
  const merge = () => {
    if (mergeReason) return;
    update.mutate({ evolutionId: e.id, body: planUpdate(mergeTasks(plan.tasks, picked)), ...(adminToken && { adminToken }) }, { onSuccess: () => setSelected(EMPTY) });
  };

  return (
    <section className={workStyles.panel} aria-labelledby={`${uid}-h`}>
      <h3 id={`${uid}-h`}>Plan</h3>
      {fixture && <p className={workStyles.muted}>Sample plan (fixture data, read-only).</p>}
      <div className={styles.toolbar} role="toolbar" aria-label="Plan actions">
        <strong data-testid="plan-counts">{planCounts(plan)}</strong>
        {confirmReplan ? (
          <span className={workStyles.actions} role="group" aria-label="Confirm re-plan">
            <span>Re-plan replaces every task and your edits.</span>
            <button type="button" className={`u-brackets ${workStyles.primary}`} disabled={create.isPending} onClick={() => runPlan(true)}>{create.isPending ? "Planning…" : "Confirm re-plan"}</button>
            <button type="button" className={`u-brackets ${workStyles.btn}`} onClick={() => setConfirmReplan(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className={`u-brackets ${workStyles.btn}`} disabled={!!replanReason} aria-describedby={reasonId(replanReason, `${uid}-rp`)} onClick={() => setConfirmReplan(true)}>Re-plan</button>
        )}
        <button type="button" className={`u-brackets ${workStyles.btn}`} disabled={!!mergeReason || update.isPending} aria-describedby={reasonId(mergeReason, `${uid}-mg`)} onClick={merge}>
          Merge selected{picked.length ? ` (${picked.length})` : ""}
        </button>
      </div>
      {readOnly && <span id={`${uid}-ro`} className={workStyles.reason}>{readOnly}</span>}
      {replanReason && replanReason !== readOnly && <span id={`${uid}-rp`} className={workStyles.reason}>Re-plan: {replanReason}</span>}
      {mergeReason && mergeReason !== readOnly && <span id={`${uid}-mg`} className={workStyles.reason}>{mergeReason}</span>}
      {(create.isError || (update.isError && !task)) && (
        <p role="alert" className={workStyles.error}>{create.isError ? planError("Planning tasks", create.error) : planError("Editing the plan", update.error!)}</p>
      )}
      {plan.problems.length > 0 && (
        <ul className={workStyles.reasons} aria-label="Plan problems">
          {plan.problems.map((p, i) => <li key={i} data-severity={p.severity}>{p.severity}: {p.message}</li>)}
        </ul>
      )}

      <WaveBoard
        plan={plan}
        evolution={e}
        fixture={fixture}
        openTask={taskId}
        onOpen={openTask}
        selected={selected}
        onSelect={readOnly ? undefined : onSelect}
        starting={start.isPending ? (start.variables?.wave ?? null) : null}
        onStart={startWave}
      />
      {start.isError && <p role="alert" className={workStyles.error}>{planError("Start wave", start.error)}</p>}
      {started && <WaveStartPanel result={started} plan={plan} onClose={() => setStarted(null)} />}

      {task && (
        <TaskDetail
          key={`${task.id}:${task.title}:${task.intent}`}
          task={task}
          plan={plan}
          readOnly={readOnly}
          saving={update.isPending}
          error={update.isError ? planError("Editing the plan", update.error) : null}
          onSave={save}
          onOpenTask={(id) => setTask(id)}
          onOpenRealization={(id) => setRealization(id)}
          onClose={() => setTask(null)}
        />
      )}
    </section>
  );
}
