import { useId, useMemo, useState, type ReactNode } from "react";
import { useAmendmentReview } from "@/api/queries";
import { useModel } from "@/model/useModel";
import { useSystemRoute } from "@/model/useSelection";
import { whyFor } from "../../code/why";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import type { Candidate, GenomeCandidateReview, ProposalPlanNode, Realization } from "../../../../shared/api";
import { AgreementTree, cascade, opDecisions, planFromDelta, walk } from "../intent/agreement";
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

/** Why accept is disabled while any node of an amendment's tree is rejected: the platform takes it whole or not at all. */
export const PARTIAL_AMENDMENT = "The platform cannot accept part of an amendment; reject it with the reasons or agree all.";

/**
 * The amendment's changes as an agreement tree (`genome` variant) built client-side from the semantic delta; each open
 * node shows its changes' field diffs. Decisions stay in the view: they only say whether accept can go ahead.
 */
function ChangeTree({ delta, readOnly, onRejected }: { delta: GenomeCandidateReview["delta"]; readOnly: string | null; onRejected(titles: string[]): void }) {
  const m = useModel();
  const built = useMemo(() => planFromDelta(delta, m.index), [delta, m.index]);
  const [plan, setPlan] = useState<ProposalPlanNode[]>(built.plan);
  const changeOf = useMemo(() => new Map(built.ops.map((o, i) => [o.id, delta.changes[i]!] as const)), [built.ops, delta.changes]);
  if (!delta.changes.length) return <p className={styles.muted}>No Genome subjects changed.</p>;
  const decide = (id: string, d: Parameters<typeof cascade>[2]) => {
    const next = cascade(plan, id, d);
    setPlan(next);
    const rejectedOps = new Set([...opDecisions(next)].filter(([, v]) => v.decision === "reject").map(([op]) => op));
    onRejected(walk(next).filter((n) => n.opIds.some((o) => rejectedOps.has(o))).map((n) => n.title));
  };
  return (
    <AgreementTree
      plan={plan}
      ops={built.ops}
      variant="genome"
      readOnly={readOnly}
      label="Amendment changes"
      onDecide={decide}
      renderOps={(n) => <SemanticDelta delta={{ changes: n.opIds.map((o) => changeOf.get(o)!).filter(Boolean) }} />}
    />
  );
}

/** Terminal realization statuses and how the badge names them; anything else still awaits an admin. */
const DECIDED: Partial<Record<Realization["status"], string>> = { promoted: "accepted", rejected: "rejected", abandoned: "abandoned" };

/**
 * Admin review of an agent's Genome change: its changes as an agreement tree, rule findings (deterministic) and System
 * One signals (model judgments) in separate sections, then accept (all or nothing) or reject.
 */
export default function AmendmentReview({ evolutionId, realization, candidate }: AmendmentReviewProps) {
  const q = useAmendmentReview(evolutionId, realization.id);
  const [outcome, setOutcome] = useState<DecisionOutcome | null>(null);
  // Rejected node titles from the tree, tied to the commit the tree was built for (a refetch with a new commit resets both).
  const [rejected, setRejected] = useState<{ commit: string; titles: string[] } | null>(null);
  const { systemId } = useSystemRoute();
  const m = useModel();
  // An editor commit's "why" starts the interpretation (shown as pending until edited).
  const editorWhy = whyFor(systemId, [realization.id]);

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
  const reviewed = r.commit ?? candidate.commit;
  const rejectedNodes = rejected?.commit === reviewed ? rejected.titles : [];
  const state = outcome?.kind ?? DECIDED[realization.status] ?? "awaiting admin";

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

      <Section title="Changes">
        {/* Keyed on the reviewed commit: a refetch with another delta starts the decisions afresh. */}
        <ChangeTree
          key={reviewed}
          delta={r.delta}
          readOnly={state !== "awaiting admin" ? "This amendment is already decided." : m.bundle.source === "fixture" ? "Deciding needs the platform API. The UI is showing fixture data." : null}
          onRejected={(titles) => setRejected({ commit: reviewed, titles })}
        />
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
          initialInterpretation={editorWhy ?? afterText(first)}
          prefilledFromWhy={!!editorWhy}
          focusId={first?.id}
          blocked={blocked}
          blockedReason={rejectedNodes.length ? `${PARTIAL_AMENDMENT} Rejected: ${rejectedNodes.join(", ")}.` : null}
          outcome={outcome}
          onOutcome={setOutcome}
        />
      </Section>
    </article>
  );
}
