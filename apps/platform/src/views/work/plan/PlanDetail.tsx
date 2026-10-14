import { Button } from "@/components/ui";
import { useCallback, useId, useState } from "react";
import { Link } from "react-router";
import type { RealizationPlan, Task } from "../../../../shared/lifecycle";
import { useAdminToken } from "@/api/adminToken";
import { lifecycleApi } from "@/api/lifecycle";
import { CopyButton } from "@/components/CopyButton/CopyButton";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { StatusChip } from "@/components/StatusChip/StatusChip";
import { StatusText } from "@/components/StatusText/StatusText";
import { useKeepParams } from "@/model/useSelection";
import { CopyText } from "../CopyText";
import { shortSha, useNow, useParam } from "../lib";
import { tasksAwaitText } from "./signals";
import { awaitingAgent, firstCommandWave, integrateReason, planCountsLine, planPrimary, taskById, waveScript } from "./lib";
import { waveLines } from "./WaveCommands";
import { WaveList } from "./WaveList";
import styles from "./plan.module.css";

interface Props {
  plan: RealizationPlan;
  writeReason: string | null;
  busy: boolean;
  error: string;
  run(fn: () => Promise<unknown>): void;
}

/**
 * A stored RealizationPlan as the detail pane: title and status, pinned Genome, counts, one primary at a time (Copy all
 * → Integrate → Review integrated implementation), the ADMIN_TOKEN hint once, then the waves top to bottom with task rows
 * that expand in place (`?task=`) and each wave's agent commands.
 */
export function PlanDetail({ plan, writeReason, busy, error, run }: Props) {
  const uid = useId();
  const href = useKeepParams();
  const { token } = useAdminToken();
  // The clock the lease rules read; ticks so a lapsed lease turns its task claimable without a write.
  const now = useNow(15_000);
  const [taskId, setTask] = useParam("task");
  // Hidden commands stay hidden while the plan is open, and "Copy all" skips them.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const onHide = useCallback((id: string) => setHidden((h) => new Set(h).add(id)), []);
  const openTask = useCallback((id: string) => setTask(id === taskId ? null : id), [setTask, taskId]);
  const integrate = writeReason ?? integrateReason(plan);
  const primary = planPrimary(plan, now, writeReason);
  const waiting = awaitingAgent(plan, now);
  const wave = firstCommandWave(plan, now);
  const by = taskById(plan);
  const waveTasks = wave ? plan.analysis.waves[wave - 1]!.map((id) => by.get(id)).filter((t): t is Task => !!t) : [];
  const copyLines = waveLines(plan, waveTasks, now).filter((l) => !hidden.has(l.id));
  const done = plan.status === "integrated" || plan.status === "promoted";

  const integrateButton = !done && (
    <Button
      variant={primary === "integrate" ? "primary" : "secondary"}
      disabled={busy}
      reason={integrate ?? undefined}
      onClick={() => run(() => lifecycleApi.integrate(plan.systemId, plan.id, token))}
    >
      Integrate selected Task results
    </Button>
  );

  return (
    <article className={styles.plan} aria-labelledby={`${uid}-h`}>
      <header className={styles.planHead}>
        <div className={styles.titleRow}>
          <h2 id={`${uid}-h`}>{plan.title} <StatusChip status={plan.status} /></h2>
          <div className={styles.headActions}>
            {integrateButton}
            {primary === "copy" && wave !== null && (
              copyLines.length
                ? <CopyText value={waveScript(copyLines.map((l) => l.pair))} label={`Copy all, wave ${wave}`} variant="primary" />
                : <Button variant="secondary" reason="Every command is hidden.">Copy all, wave {wave}</Button>
            )}
            {done && (
              <Button asChild variant="primary"><Link to={href("review", { plan: plan.id, task: null, panel: null, evolution: null, realization: null })}>Review integrated implementation</Link></Button>
            )}
          </div>
        </div>
        <div className={styles.planFacts}>
          <MetaLine items={[{ label: "Genome", value: shortSha(plan.genome.commit), code: true, title: plan.genome.commit }]} />
          <CopyButton value={plan.genome.commit} label="Copy" />
          <span className={styles.counts} data-testid="plan-counts">{planCountsLine(plan)}</span>
          {waiting > 0 && <StatusText status="awaits-agent" tone="attention" label={tasksAwaitText(waiting)} />}
        </div>
        {wave !== null && (
          <p className={styles.quiet}>
            Set <code>ADMIN_TOKEN</code> in this shell without exporting it; each claim passes it to that command only, and the agent line
            unsets it. Copy all starts each agent once its claim succeeds, side by side.
          </p>
        )}
      </header>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <WaveList plan={plan} openTask={taskId} now={now} writeReason={writeReason} hidden={hidden} onHide={onHide} onOpen={openTask} primaryWave={primary === "copy" ? wave : null} />
    </article>
  );
}
