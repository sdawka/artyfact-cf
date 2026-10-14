import { Button } from "@/components/ui";
import { Link } from "react-router";
import type { Evolution, Realization } from "../../../shared/api";
import { useCandidates } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { useKeepParams, useSelection } from "@/model/useSelection";
import { useWorkData } from "../work/data";
import { useParam } from "../work/lib";
import { CandidateReview } from "../work/panels/CandidateReview";
import { GenomeReview } from "../work/panels/GenomeReview";
import { PromotionPanel } from "../work/panels/PromotionPanel";
import { PlanDecision } from "./PlanDecision";
import { QueueList } from "./QueueList";
import { useReviewQueue } from "./useReviewQueue";
import styles from "./review.module.css";

/**
 * The operator's inbox and promotion desk. Left: every decision waiting on a person, grouped by Evolution. Right: the
 * selected one: a candidate review (`?evolution=&realization=`), the promotion desk (`?panel=promote&evolution=`) or the
 * import review (`?panel=import`, the URL the platform's `import-unreviewed` refusal names).
 * `?candidates=a,b` (global) preselects candidates for composition.
 */
export default function ReviewView() {
  const { evolutions, realizations, isLoading: boardLoading } = useWorkData();
  const queue = useReviewQueue();
  const { candidates: selected } = useSelection();
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
  const groups = queue.groups.map((g) => ({ ...g, title: (g.evolution && evolutions.find((e) => e.id === g.evolution)?.title) || g.title }));
  const open = !!planId || importing || promoting || (!!realization && !!evolution) || selected.length > 0;
  const loading = boardLoading || queue.isLoading;
  // A deep link (`?panel=promote&evolution=` or `?realization=`) keeps the panes open while loading or when it names nothing.
  const linked = !!planId || !!taskId || importing || panel === "promote" || !!realizationId;
  const missing = loading
    ? null
    : realizationId && !realization
      ? `No realization ${realizationId} on this System.`
      : taskId && !planId ? "Task review needs a plan: pick one from the queue."
      : panel === "promote" && !evolution
        ? (evolutionParam ? `No Evolution ${evolutionParam} on this System.` : "Promotion needs an Evolution: pick one from the queue.")
        : null;

  return (
    <section aria-labelledby="view-title" className={styles.view}>
      <h1 id="view-title">Review</h1>
      <p className={styles.lede}>Imports, Task results, candidates, amendments and promotions that need a person.</p>
      {queue.error && <p role="alert">{queue.error}</p>}
      {queue.count === 0 && !open && !linked && !queue.error ? (
        <EmptyState surface title={loading ? "Loading the queue…" : "Nothing is waiting on you."} live={loading} />
      ) : (
        <div className={styles.panes}>
          <QueueList groups={groups} planId={planId} taskId={taskId} error={queue.error} evolutionId={evolutionId} realizationId={realizationId} promoting={promoting} importing={importing} loading={loading} />
          <div className={styles.detail}>
            {planId ? (<PlanDecision key={planId} planId={planId} taskId={taskId} />) : importing ? (
              <GenomeReview />
            ) : promoting ? (
              <PromotionPanel key={evolution!.id} evolution={evolution!} />
            ) : realization && evolution ? (
              // Keyed: a decision made on one row never carries over to the next.
              <Reviewing key={realization.id} realization={realization} evolution={evolution} />
            ) : loading && linked ? (
              <EmptyState title="Loading…" live />
            ) : missing ? (
              <EmptyState title={missing} />
            ) : selected.length ? (
              <Composition ids={selected} />
            ) : (
              <p className={styles.muted}>Select a decision from the queue.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Reviewing({ realization, evolution }: { realization: Realization; evolution: Evolution }) {
  const { data } = useCandidates(evolution.id);
  const candidate = data?.candidates.find((c) => c.realization === realization.id || c.id === realization.candidate);
  return (
    <>
      <p className={styles.context}>{evolution.title}</p>
      <CandidateReview realization={realization} candidate={candidate} evolution={evolution} />
    </>
  );
}

/** `?candidates=a,b` without a selected row: the preselection, each with its Evolution, and the way to promote it. */
function Composition({ ids }: { ids: readonly string[] }) {
  const href = useKeepParams();
  const { realizations, evolutions } = useWorkData();
  const queue = useReviewQueue();
  const evolutionOf = (id: string) =>
    queue.candidates.find((c) => c.id === id)?.evolution ?? realizations.find((r) => r.candidate === id)?.evolution;
  const owners = [...new Set(ids.map(evolutionOf).filter((e): e is string => !!e))];
  const title = (e: string) => evolutions.find((x) => x.id === e)?.title ?? e;
  return (
    <section className={styles.panel} aria-labelledby="composition-title">
      <h2 id="composition-title" className={styles.panelTitle}>Selected for composition</h2>
      <ul className={styles.plain}>
        {ids.map((id) => {
          const e = evolutionOf(id);
          const r = realizations.find((x) => x.candidate === id);
          return (
            <li key={id}>
              <code>{id}</code>{" "}
              {e && r ? (
                <Link className="u-marker" to={href("review", { evolution: e, realization: r.id, panel: null })}>{title(e)}</Link>
              ) : (
                <span className={styles.muted}>{e ? title(e) : "Evolution unknown"}</span>
              )}
            </li>
          );
        })}
      </ul>
      {owners.length === 1 ? (
        <Button asChild className={styles.action}><Link to={href("review", { evolution: owners[0]!, realization: null, panel: "promote" })}>
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
