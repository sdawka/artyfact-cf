import { useMemo } from "react";
import type { Evolution, Realization } from "../../../shared/api";
import { useCandidates, useConflicts } from "@/api/queries";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import { useModel } from "@/model/useModel";
import { CandidateReview } from "./panels/CandidateReview";
import { PromotionPanel } from "./panels/PromotionPanel";
import { StartWorkPanel } from "./panels/StartWorkPanel";
import { RealizationRow } from "./RealizationRow";
import { conflictsOf, mergeConflicts, useNow, useParam } from "./lib";
import styles from "./work.module.css";

/** Right/lower pane for `?evolution=`: criteria, realizations, and the start / review / promote panels. */
export function EvolutionDetail({ evolution: e, realizations }: { evolution: Evolution; realizations: readonly Realization[] }) {
  const m = useModel();
  const now = useNow(30_000);
  const [panel, setPanel] = useParam("panel");
  const [reviewId, setReview] = useParam("realization");
  const { data: cand } = useCandidates(e.id);
  const { data: global } = useConflicts();
  const conflicts = useMemo(() => mergeConflicts(cand?.conflicts, global), [cand?.conflicts, global]);
  const candidateOf = (r: Realization) => cand?.candidates.find((c) => c.realization === r.id || c.id === r.candidate);
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
          <button type="button" className={`u-brackets ${styles.btn}`} aria-pressed={panel === "start"} onClick={() => setPanel(panel === "start" ? null : "start")}>Start work</button>
          <button type="button" className={`u-brackets ${styles.btn}`} aria-pressed={panel === "promote"} onClick={() => setPanel(panel === "promote" ? null : "promote")}>Promote</button>
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
                conflicts={conflictsOf(conflicts, c?.id)}
                now={now}
                reviewing={r.id === reviewId}
                onReview={(id) => setReview(id === reviewId ? null : id)}
              />
            );
          })}
        </ul>
      ) : (
        <p className={styles.muted}>No one is working on this Evolution.</p>
      )}

      {panel === "start" && <StartWorkPanel evolution={e} />}
      {reviewing && <CandidateReview realization={reviewing} candidate={candidateOf(reviewing)} evolution={e} />}
      {panel === "promote" && <PromotionPanel evolution={e} />}
    </section>
  );
}
