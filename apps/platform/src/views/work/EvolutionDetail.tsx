import { useCallback, useMemo } from "react";
import { Link } from "react-router";
import type { Evolution, Realization } from "../../../shared/api";
import { useCandidates, useConflicts } from "@/api/queries";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import { CandidateReview } from "./panels/CandidateReview";
import { StartWorkPanel } from "./panels/StartWorkPanel";
import { PlanPanel } from "./plan/PlanPanel";
import { RealizationRow } from "./RealizationRow";
import { conflictsOf, mergeConflicts, useNow, useParam } from "./lib";
import styles from "./work.module.css";

const NO_CONFLICTS: never[] = [];

/** Right/lower pane for `?evolution=`: criteria, realizations, the task plan, start work and inline review. Promotion lives on Review. */
export function EvolutionDetail({ evolution: e, realizations }: { evolution: Evolution; realizations: readonly Realization[] }) {
  const m = useModel();
  const now = useNow(30_000);
  const href = useKeepParams();
  const [panel, setPanel] = useParam("panel");
  const [reviewId, setReview] = useParam("realization");
  const { data: cand } = useCandidates(e.id);
  const { data: global } = useConflicts();
  const conflicts = useMemo(() => mergeConflicts(cand?.conflicts, global), [cand?.conflicts, global]);
  const candidateOf = (r: Realization) => cand?.candidates.find((c) => c.realization === r.id || c.id === r.candidate);
  // Stable per-candidate arrays and callback so RealizationRow's memo holds across refetches.
  const conflictsByCandidate = useMemo(() => {
    const out = new Map<string, ReturnType<typeof conflictsOf>>();
    for (const c of cand?.candidates ?? []) out.set(c.id, conflictsOf(conflicts, c.id));
    return out;
  }, [cand?.candidates, conflicts]);
  const toggleReview = useCallback((id: string) => setReview(id === reviewId ? null : id), [setReview, reviewId]);
  const mine = realizations.filter((r) => r.evolution === e.id);
  const reviewing = mine.find((r) => r.id === reviewId);

  return (
    <section className={styles.detail} aria-labelledby="evolution-detail-title">
      <header className={styles.detailHead}>
        <div>
          <h2 id="evolution-detail-title">{e.title}</h2>
          <p className={styles.rmeta}>
            <NodeChip id={e.id} size="sm" showId /> · {e.state} · {e.kind} · risk {e.risk}
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={`u-brackets ${styles.btn}`} aria-pressed={panel === "plan"} onClick={() => setPanel(panel === "plan" ? null : "plan", { task: null })}>Plan</button>
          <button type="button" className={`u-brackets ${styles.btn}`} aria-pressed={panel === "start"} onClick={() => setPanel(panel === "start" ? null : "start")}>Start work</button>
          <Link className={`u-brackets ${styles.reviewLink}`} to={href("review", { evolution: e.id, realization: null, panel: "promote" })}>Promote in Review</Link>
        </div>
      </header>
      <p className={styles.intentFull}>{e.intent}</p>

      <h3>Acceptance criteria</h3>
      <ul className={styles.plain}>
        {e.acceptanceCriteria.map((c) => (
          <li key={c} className={styles.inlineRow}><NodeChip id={c} size="sm" /><VerdictBadge verdict={m.verdictOf(c)} /></li>
        ))}
      </ul>

      <h3>Realizations</h3>
      {mine.length ? (
        <ul className={styles.rlist}>
          {mine.map((r) => {
            const c = candidateOf(r);
            return (
              <RealizationRow
                key={r.id}
                realization={r}
                candidate={c}
                conflicts={(c && conflictsByCandidate.get(c.id)) || NO_CONFLICTS}
                now={now}
                reviewing={r.id === reviewId}
                onReview={toggleReview}
              />
            );
          })}
        </ul>
      ) : (
        <p className={styles.muted}>No one is working on this Evolution.</p>
      )}

      {panel === "plan" && <PlanPanel evolution={e} />}
      {panel === "start" && <StartWorkPanel evolution={e} />}
      {reviewing && <CandidateReview realization={reviewing} candidate={candidateOf(reviewing)} evolution={e} />}
    </section>
  );
}
