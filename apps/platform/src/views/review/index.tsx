import { Button } from "@/components/ui";
import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { Evolution, Realization } from "../../../shared/api";
import { useCandidates } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { ListDetail, twoPanes } from "@/components/ListDetail/ListDetail";
import { isGoKeyPending, isTyping } from "@/app/useShellShortcuts";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { ThingScopeNote } from "@/components/ThingScope/ThingScopeNote";
import { useKeepParams, useSelection } from "@/model/useSelection";
import { SHOW_ALL_PARAM, useThingFilter } from "@/model/useThingFilter";
import { useWorkData } from "../work/data";
import { useParam } from "../work/lib";
import { CandidateReview } from "../work/panels/CandidateReview";
import { GenomeReview, useHasImportReview } from "../work/panels/GenomeReview";
import { PromotionPanel } from "../work/panels/PromotionPanel";
import { PlanDecision } from "./PlanDecision";
import { QUEUE_ROW, QueueList, useRowHref } from "./QueueList";
import { isWaiting } from "./queue";
import { useReviewQueue } from "./useReviewQueue";
import styles from "./review.module.css";

/** Two panes side by side (the ListDetail breakpoint). Without `matchMedia` (tests) assume a wide screen. */

/** State on a navigation the view made by itself (the first decision opened by default): the detail does not take focus. */
export interface AutoOpened { autoOpened?: boolean }

/**
 * The operator's inbox and promotion desk. Left: every decision waiting on a person, grouped by Evolution. Right: the
 * open one: a candidate review (`?evolution=&realization=`), the promotion desk (`?panel=promote&evolution=`), the
 * import review (`?panel=import`, the URL the platform's `import-unreviewed` refusal names) or a plan / Task review
 * (`?plan=&task=`). With nothing open the first waiting decision opens (replace). Below 900px the panes are two
 * screens with "Back to queue". `?candidates=a,b` (global) preselects candidates for the promotion.
 */
export default function ReviewView() {
  const { evolutions, realizations, isLoading: boardLoading } = useWorkData();
  const queue = useReviewQueue();
  const { candidates: selected } = useSelection();
  const href = useKeepParams();
  const rowHref = useRowHref();
  const navigate = useNavigate();
  const location = useLocation();
  const [planId] = useParam("plan");
  const [taskId] = useParam("task");
  const [panel] = useParam("panel");
  const [evolutionParam] = useParam("evolution");
  const [realizationId] = useParam("realization");
  const realization = realizationId ? realizations.find((r) => r.id === realizationId) : undefined;
  const evolutionId = evolutionParam ?? realization?.evolution ?? null;
  const evolution = evolutionId ? evolutions.find((e) => e.id === evolutionId) : undefined;
  const importing = panel === "import";
  const promoting = panel === "promote" && !!evolution;
  // Titles from the merged board (the API's, else the Genome's declared Evolutions).
  // Inside a Thing the queue keeps the Evolutions that touch it (decision f); plan and import groups name no nodes and stay.
  const thingFilter = useThingFilter();
  const groups = queue.groups.flatMap((g) => {
    const evolution = g.planId ? undefined : evolutions.find((e) => e.id === g.evolution);
    if (evolution && !thingFilter.includesAny(evolution.affectedNodes)) return [];
    return [{ ...g, title: evolution?.title || g.title }];
  });
  const open = !!planId || importing || promoting || (!!realization && !!evolution) || selected.length > 0;
  const loading = boardLoading || queue.isLoading;
  // A deep link (`?panel=promote&evolution=` or `?realization=`) keeps the panes open while loading or when it names nothing.
  const linked = !!planId || !!taskId || importing || panel === "promote" || !!realizationId;
  const missing = loading
    ? null
    : realizationId && !realization
      ? `No realization ${realizationId} on this System.`
      : taskId && !planId ? "Task review needs a plan."
      : panel === "promote" && !evolution && evolutionId
        ? `No Evolution ${evolutionId} on this System.`
        : null;
  // The detail takes focus only when a person opened it here, not on arrival or when the view opened it by itself.
  const autoOpened = !!(location.state as AutoOpened | null)?.autoOpened || location.key === "default";

  // Nothing open: open the first waiting decision (two panes only; on one pane the queue is the first screen).
  const first = groups.flatMap((g) => g.rows).find(isWaiting);
  const firstHref = first ? rowHref(first) : null;
  useEffect(() => {
    if (loading || open || linked || !firstHref || !twoPanes()) return;
    void navigate(firstHref, { replace: true, state: { autoOpened: true } satisfies AutoOpened });
  }, [loading, open, linked, firstHref, navigate]);

  // `?panel=promote` without an Evolution: open the first promotable one, else the first waiting decision (replace, params kept).
  const promotable = groups.flatMap((g) => g.rows).find((r) => r.kind === "promotion");
  const promoteTarget = panel === "promote" && !evolutionId ? (promotable ? rowHref(promotable) : firstHref) : null;
  const nothingToPromote = !loading && panel === "promote" && !evolutionId && !promoteTarget;
  useEffect(() => {
    if (loading || !promoteTarget) return;
    void navigate(promoteTarget, { replace: true, state: { autoOpened: true } satisfies AutoOpened });
  }, [loading, promoteTarget, navigate]);

  // j / k move between queue rows (Enter follows the focused row's link). Typing in a field is left alone.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.key !== "j" && ev.key !== "k") || ev.metaKey || ev.ctrlKey || ev.altKey || ev.defaultPrevented) return;
      // `g` then `j`/`k` is a shell go-key: leave it to the shell.
      if (isGoKeyPending(ev.key) || isTyping(ev.target)) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='tree'], [role='tablist']"))) return;
      const rows = [...document.querySelectorAll<HTMLElement>(`[${QUEUE_ROW}]`)].filter((r) => r.offsetParent !== null || !twoPanes());
      if (!rows.length) return;
      const at = rows.indexOf(document.activeElement as HTMLElement);
      const from = at >= 0 ? at : rows.findIndex((r) => r.getAttribute("aria-current") === "true");
      const next = ev.key === "j" ? Math.min(rows.length - 1, from + 1) : from < 0 ? 0 : Math.max(0, from - 1);
      ev.preventDefault();
      rows[next]!.focus();
      rows[next]!.scrollIntoView?.({ block: "nearest" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const back = () => void navigate(href("review", { evolution: null, realization: null, panel: null, plan: null, task: null, [SHOW_ALL_PARAM]: thingFilter.showAll ? "1" : null }));
  const empty = queue.count === 0 && !open && !linked && !queue.error;
  // The import review's own empty state carries "Back to queue"; no second one above it.
  const hasImport = useHasImportReview();
  const noImport = importing && hasImport === false;

  return (
    <section aria-labelledby="view-title" className={styles.view}>
      <PageHeader title="Review" purpose="Decisions that need a person: imports, Task results, candidates, amendments and promotions." scopeNote={<ThingScopeNote filter={thingFilter} />} />
      {queue.error && <p role="alert" className={styles.error}>{queue.error}</p>}
      {empty ? (
        <EmptyState
          surface
          title={loading ? "Loading the queue…" : "Nothing is waiting on you."}
          live={loading}
          action={loading ? undefined : <Link className="u-marker" to={href("work", { panel: null, evolution: null, realization: null, plan: null, task: null })}>Open Work</Link>}
        >
          {loading ? undefined : "Candidates, amendments and imports appear here when an agent submits."}
        </EmptyState>
      ) : (
        <ListDetail
          listLabel="Decision queue"
          detailLabel="Decision"
          listWidth="wide"
          hasSelection={open || linked}
          {...(!noImport && { onBack: back })}
          backLabel="Back to queue"
          list={<QueueList groups={groups} planId={planId} taskId={taskId} error={queue.error} evolutionId={evolutionId} realizationId={realizationId} promoting={promoting} importing={importing} loading={loading} />}
          detail={
            planId ? (<PlanDecision key={planId} planId={planId} taskId={taskId} />) : importing ? (
              <GenomeReview onBack={back} />
            ) : promoting ? (
              <PromotionPanel key={evolution!.id} evolution={evolution!} autoFocus={!autoOpened} />
            ) : realization && evolution ? (
              // Keyed: a decision made on one row never carries over to the next.
              <Reviewing key={realization.id} realization={realization} evolution={evolution} autoFocus={!autoOpened} />
            ) : (loading && linked) || promoteTarget ? (
              <EmptyState title="Loading…" live />
            ) : nothingToPromote ? (
              <EmptyState
                title="Nothing is ready to promote."
                headingLevel={2}
                action={<Link className="u-marker" to={href("work", { panel: null, evolution: null, realization: null, plan: null, task: null })}>Open Work</Link>}
              >
                A promotion appears when a candidate is evaluated.
              </EmptyState>
            ) : missing ? (
              <EmptyState title={missing} headingLevel={2}>Open a decision from the queue.</EmptyState>
            ) : selected.length ? (
              <Composition ids={selected} />
            ) : loading ? (
              <EmptyState title="Loading the queue…" live />
            ) : null
          }
        />
      )}
    </section>
  );
}

function Reviewing({ realization, evolution, autoFocus }: { realization: Realization; evolution: Evolution; autoFocus: boolean }) {
  const { data } = useCandidates(evolution.id);
  const candidate = data?.candidates.find((c) => c.realization === realization.id || c.id === realization.candidate);
  return <CandidateReview realization={realization} candidate={candidate} evolution={evolution} autoFocus={autoFocus} />;
}

/** `?candidates=a,b` without an open row: the candidates added to a promotion, each with its Evolution, and the way to promote it. */
function Composition({ ids }: { ids: readonly string[] }) {
  const href = useKeepParams();
  const { realizations, evolutions } = useWorkData();
  const queue = useReviewQueue();
  const evolutionOf = (id: string) =>
    queue.candidates.find((c) => c.id === id)?.evolution ?? realizations.find((r) => r.candidate === id)?.evolution;
  const owners = [...new Set(ids.map(evolutionOf).filter((e): e is string => !!e))];
  const title = (e: string) => evolutions.find((x) => x.id === e)?.title ?? e;
  return (
    <section className={styles.detailPane} aria-labelledby="composition-title">
      <h2 id="composition-title" className={styles.detailTitle}>Added to promotion</h2>
      <ul className={styles.plain}>
        {ids.map((id) => {
          const e = evolutionOf(id);
          const r = realizations.find((x) => x.candidate === id);
          return (
            <li key={id} className={styles.compRow}>
              <code className={styles.id}>{id}</code>
              {e && r ? (
                <Link to={href("review", { evolution: e, realization: r.id, panel: null })}>{title(e)}</Link>
              ) : (
                <span className={styles.muted}>{e ? title(e) : "Evolution unknown"}</span>
              )}
            </li>
          );
        })}
      </ul>
      {owners.length === 1 ? (
        <Button asChild variant="primary" className={styles.action}><Link to={href("review", { evolution: owners[0]!, realization: null, panel: "promote" })}>
          Promote {title(owners[0]!)}
        </Link></Button>
      ) : (
        <p className={styles.muted}>
          {owners.length > 1 ? "These candidates belong to different Evolutions; each is promoted from its own Evolution." : "Open a candidate to review it."}
        </p>
      )}
    </section>
  );
}
