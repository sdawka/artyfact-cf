import { Button } from "@/components/ui";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealizationPlan } from "../../../shared/lifecycle";
import { useAdminToken } from "@/api/adminToken";
import { Row, RowList } from "@/components/RowList/RowList";
import { Section } from "@/components/Section/Section";
import { StatusText } from "@/components/StatusText/StatusText";
import { useSystemRoute } from "@/model/useSelection";
import { useStayHref } from "@/model/useThingFilter";
import { useWorkData } from "./data";
import { useParam } from "./lib";
import { DraftPanel } from "./plan/DraftPanel";
import { awaitingAgent, FIXTURE_REASON, planError, plural, TOKEN_REASON } from "./plan/lib";
import { PlanDetail } from "./plan/PlanDetail";
import { useApiMode, usePlan } from "./plan/queries";
import { selectionText, tasksAwaitText } from "./plan/signals";
import styles from "./work.module.css";

/** Why plan writes are refused (fixture data, no admin token), or null. */
export function usePlanWriteReason(): string | null {
  const { token } = useAdminToken();
  const api = useApiMode();
  return !api ? FIXTURE_REASON : !token ? TOKEN_REASON : null;
}

/**
 * The Plans group of the Work list pane: the System's RealizationPlans, each a row link (`?plan=`) with its status,
 * task count and the tasks that await an agent (the rail's count). "Plan implementation" opens the draft (`?panel=plan`).
 */
export function PlansSection({ plans, loading, error, current, now }: {
  plans: readonly RealizationPlan[];
  loading: boolean;
  error: unknown;
  current: string | null;
  now: number;
}) {
  const href = useStayHref();
  const api = useApiMode();
  const [panel, setPanel] = useParam("panel");
  const drafting = panel === "plan";
  return (
    <Section
      title="Plans"
      count={api ? plans.length : undefined}
      description="Task plans that implement an accepted Genome."
      actions={
        <Button
          size="compact"
          aria-pressed={drafting}
          reason={!api ? FIXTURE_REASON : undefined}
          onClick={() => setPanel(drafting ? null : "plan", { evolution: null, realization: null, plan: null, task: null })}
        >
          Plan implementation
        </Button>
      }
    >
      {loading && <p className={styles.listNote} role="status">Loading plans…</p>}
      {!!error && <p role="alert" className={styles.error}>{planError("Reading plans", error)}</p>}
      {api && !loading && !error && plans.length === 0 && <p className={styles.listNote}>No plan yet. Plan implementation drafts one from an accepted Genome Evolution.</p>}
      {plans.length > 0 && (
        <RowList label="Realization plans">
          {plans.map((p) => {
            const waiting = awaitingAgent(p, now);
            const submitted = p.tasks.filter((t) => t.status === "submitted").length;
            return (
              <Row
                key={p.id}
                to={href("work", { plan: p.id })}
                current={current === p.id}
                title={p.title}
                meta={<span className={styles.rowMeta}><StatusText status={p.status} glyph="" /><span>{plural(p.tasks.length, "task")}</span></span>}
                tone="attention"
                status={waiting || submitted ? (
                  <span className={styles.rowStatus}>
                    {waiting > 0 && <StatusText status="awaits-agent" tone="attention" label={tasksAwaitText(waiting)} />}
                    {submitted > 0 && <StatusText status="submitted" tone="attention" glyph="◕" label={selectionText(submitted)} />}
                  </span>
                ) : undefined}
              />
            );
          })}
        </RowList>
      )}
    </Section>
  );
}

/** The detail pane for plans: the draft Panel (`?panel=plan`) or the stored plan (`?plan=`). */
export function PlanPane({ planId, drafting }: { planId: string | null; drafting: boolean }) {
  const { systemId } = useSystemRoute();
  const api = useApiMode();
  const qc = useQueryClient();
  const { evolutions } = useWorkData();
  const [, setPlan] = useParam("plan");
  const [, setPanel] = useParam("panel");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const detail = usePlan(systemId, planId, api);
  const writeReason = usePlanWriteReason();

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
          qc.invalidateQueries({ queryKey: ["systems"] }),
        ]);
        setBusy(false);
      });
  };

  if (drafting) {
    return (
      <DraftPanel
        evolutions={evolutions}
        writeReason={writeReason}
        onCancel={() => setPanel(null)}
        onCreated={(p) => {
          void qc.invalidateQueries({ queryKey: ["plans", systemId] });
          void qc.invalidateQueries({ queryKey: ["systems"] });
          setPlan(p.id, { panel: null, task: null });
        }}
      />
    );
  }
  return (
    <>
      {detail.isLoading && <p className={styles.listNote} role="status">Loading plan…</p>}
      {detail.error && <p role="alert" className={styles.error}>{planError("Reading the plan", detail.error)}</p>}
      {detail.data && <PlanDetail plan={detail.data} writeReason={writeReason} busy={busy} error={error} run={run} />}
      {!detail.data && error && <p role="alert" className={styles.error}>{error}</p>}
    </>
  );
}
