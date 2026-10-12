import { useId, useState, type ReactNode } from "react";
import { useAmendmentReview } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import type { Candidate, Realization } from "../../../../shared/api";
import styles from "./AmendmentReview.module.css";
import { Decision, type DecisionOutcome } from "./amendment/Decision";
import { afterText, shortSha } from "./amendment/helpers";
import { diffReadiness } from "./amendment/diffReadiness";
import { ReadinessDiff } from "./amendment/ReadinessDiff";
import { isHardFlag, Signals } from "./amendment/Signals";
import { SemanticDelta } from "./amendment/SemanticDelta";

export interface AmendmentReviewProps {
  systemId: string;
  evolutionId: string;
  realization: Realization;
  candidate: Candidate;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={styles.section}>
      <h3 id={id} className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

/**
 * Admin review of an agent's Genome change: rule findings (deterministic) and System One signals
 * (model judgments) shown in separate sections, then accept or reject.
 */
export default function AmendmentReview({ evolutionId, realization, candidate }: AmendmentReviewProps) {
  const q = useAmendmentReview(evolutionId, realization.id);
  const [outcome, setOutcome] = useState<DecisionOutcome | null>(null);

  if (q.isPending) return <EmptyState title="Loading the amendment review…" live />;
  if (q.isError || !q.data) {
    return (
      <EmptyState title="The amendment review is unavailable.">
        <code>{q.error?.message ?? "unknown error"}</code>
      </EmptyState>
    );
  }

  const r = q.data;
  const diff = diffReadiness(r.readinessBase, r.readinessCandidate);
  const first = r.delta.changes[0];
  const blocked = diff.hardAdded.length > 0 || r.review.some(isHardFlag);
  const state = outcome?.kind ?? (realization.status === "promoted" ? "accepted" : realization.status === "rejected" ? "rejected" : "awaiting admin");

  return (
    <article className={styles.panel} aria-label="Genome amendment review">
      <header className={styles.header}>
        <h2 className={styles.title}>Genome amendment</h2>
        <span className={styles.badge} data-state={state}>{state}</span>
        <dl className={styles.meta}>
          <div><dt>Realization</dt><dd>{realization.id}</dd></div>
          <div><dt>Agent</dt><dd>{realization.agent.id} ({realization.agent.role})</dd></div>
          <div><dt>Fork</dt><dd><code>{realization.workspace.fork}</code></dd></div>
          <div>
            <dt>Genome commit</dt>
            <dd><code>{shortSha(realization.workspace.baseCommit)}</code> → <code>{shortSha(r.commit ?? candidate.commit)}</code></dd>
          </div>
        </dl>
      </header>

      <Section title="Semantic delta">
        <SemanticDelta delta={r.delta} />
      </Section>
      <Section title="Readiness diff">
        <ReadinessDiff diff={diff} />
      </Section>
      <Section title="System One signals">
        <p className={styles.muted}>The model proposes; the admin decides. Only probabilities of 0.90 or more are treated as confident.</p>
        <Signals changes={r.delta.changes} review={r.review} hardAdded={diff.hardAdded.length} commitments={r.commitments} />
      </Section>
      <Section title="Decision">
        <Decision
          evolutionId={evolutionId}
          realization={realization}
          candidateId={r.candidate ?? candidate.id}
          commit={r.commit ?? candidate.commit}
          initialInterpretation={afterText(first)}
          focusId={first?.id}
          blocked={blocked}
          outcome={outcome}
          onOutcome={setOutcome}
        />
      </Section>
    </article>
  );
}
