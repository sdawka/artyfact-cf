import { Button } from "@/components/ui";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAdminToken } from "@/api/adminToken";
import { useSystemRoute } from "@/model/useSelection";
import { useWorkData } from "./data";
import { useParam } from "./lib";
import { DraftPanel } from "./plan/DraftPanel";
import { FIXTURE_REASON, planError, plural, TOKEN_REASON } from "./plan/lib";
import { PlanDetail } from "./plan/PlanDetail";
import { planKeys, useApiMode, usePlan, usePlans } from "./plan/queries";
import { TaskStatus } from "./plan/TaskStatus";
import styles from "./work.module.css";
import planStyles from "./plan/plan.module.css";

/**
 * Realizations: the System's RealizationPlans. "Plan implementation" opens the draft flow (`?panel=plan`); `?plan=`
 * opens a stored plan. Reads follow the System's visibility; every write needs the admin token.
 */
export function Plans() {
  const { systemId } = useSystemRoute();
  const { token } = useAdminToken();
  const api = useApiMode();
  const qc = useQueryClient();
  const { evolutions } = useWorkData();
  const [selected, setPlan] = useParam("plan");
  const [panel, setPanel] = useParam("panel");
  const drafting = panel === "plan";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const plans = usePlans(systemId, api);
  const detail = usePlan(systemId, selected, api);
  const writeReason = !api ? FIXTURE_REASON : !token ? TOKEN_REASON : null;

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    void fn()
      .catch((e: unknown) => setError(planError("This change", e)))
      .finally(async () => {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["plans", systemId] }),
          qc.invalidateQueries({ queryKey: ["plan", systemId] }),
          qc.invalidateQueries({ queryKey: ["implementation-review", systemId] }),
          qc.invalidateQueries({ queryKey: planKeys.system(systemId) }),
        ]);
        setBusy(false);
      });
  };

  return (
    <section aria-labelledby="realization-plans" className={styles.panel}>
      <div className={styles.detailHead}>
        <h2 id="realization-plans">Realizations</h2>
        <Button
          type="button"
          variant="secondary"
          aria-pressed={drafting}
          disabled={!api}
          aria-describedby={!api ? "realization-plans-fixture" : undefined}
          onClick={() => setPanel(drafting ? null : "plan", { evolution: null, realization: null })}
        >
          Plan implementation
        </Button>
      </div>
      <p>A Realization implements a pinned accepted Genome. Its Tasks run in isolated forks; Task Attempts preserve retry history.</p>
      {!api && <p id="realization-plans-fixture" className={styles.muted}>{FIXTURE_REASON}</p>}
      {api && !token && (
        <p className={styles.muted}>
          Set the admin token to draft, select, integrate or promote plans.
        </p>
      )}
      {plans.isLoading && <p role="status">Loading Realizations…</p>}
      {plans.error && <p role="alert">{planError("Reading plans", plans.error)}</p>}
      {plans.data && plans.data.plans.length === 0 && <p className={styles.muted}>No Realization plan yet. Plan implementation drafts one.</p>}
      {plans.data && plans.data.plans.length > 0 && (
        <ul className={planStyles.planList} aria-label="Realization plans">
          {plans.data.plans.map((p) => (
            <li key={p.id} className={styles.inlineRow}>
              <Button type="button" variant="ghost" aria-pressed={selected === p.id} onClick={() => setPlan(selected === p.id ? null : p.id, { task: null })}>{p.title}</Button>
              <span>{p.status}</span>
              <span className={styles.muted}>{plural(p.tasks.length, "task")}</span>
              {p.tasks.some((t) => t.status === "submitted") && <TaskStatus status="submitted" title="A task awaits selection" />}
            </li>
          ))}
        </ul>
      )}
      {drafting && (
        <DraftPanel
          evolutions={evolutions}
          writeReason={writeReason}
          onCancel={() => setPanel(null)}
          onCreated={(p) => {
            void qc.invalidateQueries({ queryKey: ["plans", systemId] });
            void qc.invalidateQueries({ queryKey: planKeys.system(systemId) });
            setPlan(p.id, { panel: null, task: null });
          }}
        />
      )}
      {detail.isLoading && <p role="status">Loading plan…</p>}
      {detail.error && <p role="alert">{planError("Reading the plan", detail.error)}</p>}
      {detail.data && <PlanDetail plan={detail.data} writeReason={writeReason} busy={busy} error={error} run={run} />}
      {!detail.data && error && <p role="alert" className={styles.error}>{error}</p>}
    </section>
  );
}
