import { Button } from "@/components/ui";
import { useCallback, useEffect, useId, useState } from "react";
import type { RealizationPlan } from "../../../../shared/lifecycle";
import { useAdminToken } from "@/api/adminToken";
import { lifecycleApi } from "@/api/lifecycle";
import { useParam } from "../lib";
import { integrateReason, planCountsLine } from "./lib";
import { Link } from "react-router";
import { useKeepParams } from "@/model/useSelection";
import { TaskDetail } from "./TaskDetail";
import { WaveBoard } from "./WaveBoard";
import workStyles from "../work.module.css";
import styles from "./plan.module.css";

/** The clock the lease rules read; ticks so a lapsed lease turns its task claimable without a write. */
function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

interface Props {
  plan: RealizationPlan;
  writeReason: string | null;
  busy: boolean;
  error: string;
  run(fn: () => Promise<unknown>): void;
}

/**
 * A stored RealizationPlan: its pinned Genome and status, the wave board with per-wave agent commands, `?task=` detail
 * with execution metadata and a Review link, and Integrate once every task is selected.
 */
export function PlanDetail({ plan, writeReason, busy, error, run }: Props) {
  const uid = useId();
  const href = useKeepParams();
  const { token } = useAdminToken();
  const now = useNow();
  const [taskId, setTask] = useParam("task");
  // Hidden commands stay hidden while the plan is open, and "Copy all" skips them.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const onHide = useCallback((id: string) => setHidden((h) => new Set(h).add(id)), []);
  const openTask = useCallback((id: string) => setTask(id === taskId ? null : id), [setTask, taskId]);
  const task = taskId ? plan.tasks.find((t) => t.id === taskId) : undefined;
  const integrate = writeReason ?? integrateReason(plan);

  return (
    <section className={workStyles.panel} aria-labelledby={`${uid}-h`}>
      <h3 id={`${uid}-h`}>{plan.title}</h3>
      <p>Pinned Genome <code>{plan.genome.commit}</code> · {plan.status}</p>
      <div className={styles.toolbar}>
        <strong data-testid="plan-counts">{planCountsLine(plan)}</strong>
        {plan.status !== "promoted" && plan.status !== "integrated" && (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={!!integrate || busy}
              aria-describedby={integrate ? `${uid}-i` : undefined}
              onClick={() => run(() => lifecycleApi.integrate(plan.systemId, plan.id, token))}
            >
              Integrate selected Task results
            </Button>
            {integrate && <span id={`${uid}-i`} className={workStyles.reason}>{integrate}</span>}
          </>
        )}
      </div>
      <WaveBoard plan={plan} openTask={taskId} now={now} hidden={hidden} onHide={onHide} onOpen={openTask} />
      {task && (
        <TaskDetail
          key={task.id}
          task={task}
          plan={plan}
          now={now}
          writeReason={writeReason}
          commandHidden={hidden.has(task.id)}
          error={null}
          onOpenTask={(id) => setTask(id)}
          onClose={() => setTask(null)}
        />
      )}
      {error && <p role="alert" className={workStyles.error}>{error}</p>}
      {(plan.status === "integrated" || plan.status === "promoted") && <Button asChild variant="primary"><Link to={href("review", {plan:plan.id, task:null, panel:null, evolution:null, realization:null})}>Review integrated implementation</Link></Button>}
    </section>
  );
}
