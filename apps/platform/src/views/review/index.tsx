import { Link } from "react-router";
import type { Evolution, Realization } from "../../../shared/api";
import { useCandidates } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { useKeepParams, useSelection } from "@/model/useSelection";
import { useWorkData } from "../work/data";
import { useParam } from "../work/lib";
import { CandidateReview } from "../work/panels/CandidateReview";
import { PromotionPanel } from "../work/panels/PromotionPanel";
import { QueueList } from "./QueueList";
import { useReviewQueue } from "./useReviewQueue";
import styles from "./review.module.css";

/**
 * The operator's inbox and promotion desk. Left: every decision waiting on a person, grouped by Evolution. Right: the
 * selected one, either a candidate review (`?evolution=&realization=`) or the promotion desk (`?panel=promote&evolution=`).
 * `?candidates=a,b` (global) preselects candidates for composition.
 */
export default function ReviewView() {
  const { evolutions, realizations, isLoading: boardLoading } = useWorkData();
  const queue = useReviewQueue();
  const { candidates: selected } = useSelection();
  const [panel] = useParam("panel");
  const [evolutionParam] = useParam("evolution");
  const [realizationId] = useParam("realization");
  const realization = realizationId ? realizations.find((r) => r.id === realizationId) : undefined;
  const evolutionId = evolutionParam ?? realization?.evolution ?? null;
  const evolution = evolutionId ? evolutions.find((e) => e.id === evolutionId) : undefined;
  const promoting = panel === "promote" && !!evolution;
  // Titles from the merged board (the API's, else the Genome's declared Evolutions).
  const groups = queue.groups.map((g) => ({ ...g, title: evolutions.find((e) => e.id === g.evolution)?.title ?? g.title }));
  const open = promoting || (!!realization && !!evolution) || selected.length > 0;
  const loading = boardLoading || queue.isLoading;
  // A deep link (`?panel=promote&evolution=` or `?realization=`) keeps the panes open while loading or when it names nothing.
  const linked = panel === "promote" || !!realizationId;
  const missing = loading
    ? null
    : realizationId && !realization
      ? `No realization ${realizationId} on this System.`
      : panel === "promote" && !evolution
        ? (evolutionParam ? `No Evolution ${evolutionParam} on this System.` : "Promotion needs an Evolution: pick one from the queue.")
        : null;

  return (
    <section aria-labelledby="view-title" className={styles.view}>
      <h1 id="view-title">Review</h1>
      <p className={styles.lede}>Candidates, amendments and promotions that need a person.</p>
      {queue.count === 0 && !open && !linked ? (
        <EmptyState surface title={loading ? "Loading the queue…" : "Nothing is waiting on you."} live={loading} />
      ) : (
        <div className={styles.panes}>
          <QueueList groups={groups} evolutionId={evolutionId} realizationId={realizationId} promoting={promoting} loading={loading} />
          <div className={styles.detail}>
            {promoting ? (
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
        <Link className={`u-brackets ${styles.action}`} to={href("review", { evolution: owners[0]!, realization: null, panel: "promote" })}>
          Promote {title(owners[0]!)}
        </Link>
      ) : (
        <p className={styles.muted}>
          {owners.length > 1 ? "These candidates belong to different Evolutions; each is promoted from its own Evolution." : "Open a candidate to review it."}
        </p>
      )}
    </section>
  );
}
