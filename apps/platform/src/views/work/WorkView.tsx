import { Button } from "@/components/ui";
import { useEffect, useMemo, useRef } from "react";
import { Link, Navigate, useLocation, useNavigation, useParams, useSearchParams } from "react-router";
import { PlusIcon } from "@radix-ui/react-icons";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { ListDetail } from "@/components/ListDetail/ListDetail";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { StatusText } from "@/components/StatusText/StatusText";
import { useEvaluationFx } from "@/effects/fx";
import { useModel } from "@/model/useModel";
import { useKeepParams, useSystemRoute } from "@/model/useSelection";
import { useWorkCount } from "@/model/useWorkCount";
import { useWorkData } from "./data";
import { EvolutionDetail, evolutionPrimary } from "./EvolutionDetail";
import { EvolutionGroups, groupEvolutions, listOrder } from "./EvolutionGroups";
import { IntentPanel } from "./intent/IntentPanel";
import { NewEvolutionPanel } from "./panels/NewEvolutionPanel";
import { STARTABLE, useNow, useParam } from "./lib";
import { awaitingAgent, planPrimary } from "./plan/lib";
import { useApiMode, usePlan, usePlans } from "./plan/queries";
import { tasksAwaitText } from "./plan/signals";
import { PlanPane, PlansSection, usePlanWriteReason } from "./Plans";
import { useEvolutionSignals } from "./useEvolutionSignals";
import styles from "./work.module.css";

/** Params that pick what the detail pane shows; with none of them the view picks the first item waiting on you. */
const SELECTION = ["evolution", "plan", "task", "panel", "realization"] as const;

/** Two panes fit side by side (ListDetail's breakpoint). Below it, arriving selects nothing so the list shows first. */
const wide = () => typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 900px)").matches;

/**
 * Work: one list pane (Plans first, then Evolutions grouped by state) beside one detail pane (`?plan=` or
 * `?evolution=`). `?panel=intent` (Describe a change) and `?panel=new` (New Evolution) replace both panes;
 * `?panel=plan` (draft) replaces the detail. `?realization=` belongs to Review and redirects there.
 */
export default function WorkView() {
  const { search, hash } = useLocation();
  if (new URLSearchParams(search).has("realization")) {
    // Inline candidate review moved to Review, the one decision desk: keep the deep link working with every param.
    return <Navigate replace relative="path" to={{ pathname: "../review", search, hash }} />;
  }
  return <Workbench />;
}

function Workbench() {
  const m = useModel();
  const { systemId } = useSystemRoute();
  const { thingId } = useParams();
  const href = useKeepParams();
  const api = useApiMode();
  const now = useNow(15_000);
  const { evolutions: all, realizations } = useWorkData();
  useEvaluationFx(m.evaluations);
  const [params, setParams] = useSearchParams();
  const [evolutionId, setEvolutionId] = useParam("evolution");
  const [planId] = useParam("plan");
  const [panel, setPanel] = useParam("panel");
  const [showAll, setShowAll] = useParam("all");
  const describeBtn = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const plansQ = usePlans(systemId, api);
  const plans = useMemo(() => plansQ.data?.plans ?? [], [plansQ.data]);
  const planQ = usePlan(systemId, planId, api);
  const writeReason = usePlanWriteReason();
  const { signals, isLoading: signalsLoading } = useEvolutionSignals();
  const railCount = useWorkCount();

  // Inside a Thing, Work shows the Evolutions that touch it (decision f); "Show all" keeps the whole System one click away.
  const thing = thingId ? m.index.byId(thingId) : undefined;
  const scoped = !!thingId && showAll !== "1";
  const evolutions = useMemo(
    () => (scoped ? all.filter((e) => e.affectedNodes.some((n) => n === thingId || m.index.path(n).some((p) => p.id === thingId))) : all),
    [all, scoped, thingId, m.index],
  );
  const groups = useMemo(() => groupEvolutions(evolutions, signals), [evolutions, signals]);
  const ordered = useMemo(() => listOrder(groups), [groups]);
  const titleOf = (id: string) => all.find((e) => e.id === id)?.title ?? id;

  const describing = panel === "intent";
  const creating = panel === "new";
  const drafting = panel === "plan";
  const selected = evolutionId ? evolutions.find((e) => e.id === evolutionId) ?? all.find((e) => e.id === evolutionId) : undefined;
  const awaitingReview = [...signals.values()].reduce((n, s) => n + s.awaiting, 0);
  const firstWaitingPlan = plans.find((p) => awaitingAgent(p, now) > 0);

  // Arriving with nothing selected opens the first item waiting on you (replace, so Back still leaves Work).
  const nothingPicked = SELECTION.every((k) => !params.get(k));
  // Never while a navigation is pending: a replace now would cancel the person's own click away from Work.
  const idle = useNavigation().state === "idle";
  const ready = idle && !signalsLoading && (!api || !plansQ.isLoading);
  useEffect(() => {
    if (!nothingPicked || !ready || !wide()) return;
    const evolution =
      ordered.find((e) => (signals.get(e.id)?.awaiting ?? 0) > 0 || signals.get(e.id)?.overlap) ??
      ordered.find((e) => STARTABLE.has(e.state)) ??
      ordered[0];
    const next = new URLSearchParams(params);
    if (firstWaitingPlan) next.set("plan", firstWaitingPlan.id);
    else if (evolution) next.set("evolution", evolution.id);
    else if (plans[0]) next.set("plan", plans[0].id);
    else return;
    setParams(next, { replace: true });
  }, [nothingPicked, ready, ordered, signals, firstWaitingPlan, plans, params, setParams]);

  // The header's primary turns secondary while a panel is open or the selection offers its own primary.
  const selectionPrimary = selected
    ? evolutionPrimary(selected, signals.get(selected.id)) !== null
    : planId && planQ.data
      ? planPrimary(planQ.data, now, writeReason) !== null
      : false;
  const headerPrimary = !panel && !selectionPrimary;

  const closeIntent = () => {
    setPanel(null, { anchor: null, proposal: null });
    describeBtn.current?.focus();
  };

  const status = (railCount > 0 || awaitingReview > 0) && (
    <span className={styles.headerStatus}>
      {railCount > 0 && (
        <Link to={firstWaitingPlan ? href("work", { plan: firstWaitingPlan.id }) : href("work")}>
          <StatusText status="awaits-agent" tone="attention" label={tasksAwaitText(railCount)} />
        </Link>
      )}
      {awaitingReview > 0 && (
        <Link to={href("review")}>
          <StatusText status="awaiting" tone="attention" label={`${awaitingReview} await${awaitingReview === 1 ? "s" : ""} review`} />
        </Link>
      )}
    </span>
  );

  const header = (
    <PageHeader
      title="Work"
      titleRef={titleRef}
      purpose="Genome Evolutions and the Task plans that realize them."
      status={status || undefined}
      secondary={
        <Button
          aria-pressed={creating}
          onClick={() => (creating ? setPanel(null) : setPanel("new", { evolution: null, realization: null, plan: null, task: null, anchor: null, proposal: null }))}
        >
          <PlusIcon aria-hidden="true" />Evolution
        </Button>
      }
      primary={
        <Button
          ref={describeBtn}
          variant={headerPrimary ? "primary" : "secondary"}
          aria-pressed={describing}
          onClick={() => (describing ? closeIntent() : setPanel("intent"))}
        >
          Describe a change
        </Button>
      }
    />
  );

  let body;
  if (describing) {
    body = (
      <IntentPanel
        onClose={closeIntent}
        // The accepted ops are a Genome realization with a candidate: select its Evolution (its review is on Review).
        onAccepted={(res) => {
          setEvolutionId(res.evolution.id, { panel: null, anchor: null, proposal: null, plan: null, task: null });
          titleRef.current?.focus();
        }}
      />
    );
  } else if (creating) {
    body = (
      <NewEvolutionPanel
        backLabel="Back to Work"
        onCreated={(e) => setEvolutionId(e.id, { panel: null, plan: null, task: null })}
        onCancel={() => setPanel(null)}
      />
    );
  } else if (all.length === 0 && plans.length === 0 && !planId && !drafting) {
    body = (
      <EmptyState surface title="No Genome Evolutions yet.">
        Describe a change to propose one. Accepted Evolutions are then implemented by a Task plan.
      </EmptyState>
    );
  } else {
    const hasSelection = !!evolutionId || !!planId || drafting;
    body = (
      <ListDetail
        listWidth="wide"
        listLabel="Plans and Evolutions"
        detailLabel={drafting ? "Plan implementation" : selected ? selected.title : planId ? "Plan" : "Detail"}
        hasSelection={hasSelection}
        backLabel="Back to Work"
        onBack={() => setParams((prev) => {
          const next = new URLSearchParams(prev);
          for (const k of SELECTION) next.delete(k);
          return next;
        })}
        list={
          <div className={styles.listPane}>
            {thingId && (
              <p className={styles.listNote}>
                {scoped ? <>Showing changes to {thing?.name ?? thingId}. </> : <>Showing all of this System. </>}
                <Button variant="ghost" size="compact" onClick={() => setShowAll(scoped ? "1" : null)}>
                  {scoped ? "Show all" : `Only ${thing?.name ?? thingId}`}
                </Button>
              </p>
            )}
            <PlansSection plans={plans} loading={api && plansQ.isLoading} error={plansQ.error} current={drafting ? null : planId} now={now} />
            <EvolutionGroups groups={groups} selectedId={selected?.id ?? null} signals={signals} total={evolutions.length} titleOf={titleOf} />
          </div>
        }
        detail={
          drafting || planId ? (
            <PlanPane key={drafting ? "draft" : planId} planId={planId} drafting={drafting} />
          ) : selected ? (
            <EvolutionDetail key={selected.id} evolution={selected} realizations={realizations} signal={signals.get(selected.id)} titleOf={titleOf} />
          ) : evolutionId ? (
            <EmptyState title={`No Evolution ${evolutionId} on this System.`} />
          ) : (
            <p className={styles.listNote}>Pick a plan or an Evolution from the list.</p>
          )
        }
      />
    );
  }

  return (
    <section aria-labelledby="view-title" className={styles.view}>
      {header}
      {body}
    </section>
  );
}
