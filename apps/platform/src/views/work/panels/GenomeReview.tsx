import { useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { Finding, SystemImportReview, SystemImportReviewAcceptResponse, ProposalPlanNode } from "../../../../shared/api";
import { useAdminTokenField } from "@/api/adminToken";
import { ApiRequestError } from "@/api/client";
import { useAcceptImportReview, useImportReview } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { LevelBadge } from "@/inspector/bodies/FindingBody";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import { acceptImportBlocker, decidedTree, importDecisions, importSummary } from "../../review/importReview";
import { AgreementTree, cascade, walk } from "../intent/agreement";
import styles from "./AmendmentReview.module.css";
import own from "./GenomeReview.module.css";

/** Findings shown before "Show all": errors and warnings first. */
const FIRST_FINDINGS = 12;
const LEVEL_ORDER: Record<Finding["level"], number> = { error: 0, missing: 1, warning: 2, info: 3 };

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
 * The import review (`?panel=import` in Review): the imported head Genome as an agreement tree (`genome` variant: agree
 * or reject, children inherit), its readiness findings and the app paths no node maps, then accept with an
 * interpretation. Rejected nodes become `remove` ops of a Genome amendment that the accept commits at once.
 */
export function GenomeReview() {
  const q = useImportReview();
  if (q.isPending) return <EmptyState title="Loading the import review…" live />;
  if (q.isError || !q.data) {
    const missing = q.error instanceof ApiRequestError && q.error.status === 404;
    return (
      <EmptyState title={missing ? "This System has no import review." : "The import review is unavailable."}>
        {!missing && <code>{q.error?.message ?? "unknown error"}</code>}
      </EmptyState>
    );
  }
  // Keyed: a new import (another Genome commit) starts its decisions afresh.
  return <ImportReviewPanel key={q.data.genomeCommit} review={q.data} />;
}

function ImportReviewPanel({ review }: { review: SystemImportReview }) {
  const m = useModel();
  const accepted = review.status === "accepted";
  const [plan, setPlan] = useState<ProposalPlanNode[]>(() => (accepted ? decidedTree(review) : review.tree));
  // The mutation lives here, not in the form: its success caches the accepted review, which must not unmount the outcome.
  const accept = useAcceptImportReview();
  const outcome = accept.data ?? null;
  const fixture = m.bundle.source === "fixture";
  const readOnly = accepted || outcome
    ? "The import review is accepted; its decisions are final."
    : fixture
      ? "Deciding needs the platform API. The UI is showing fixture data."
      : null;
  const decisions = useMemo(() => importDecisions(plan), [plan]);
  const titles = useMemo(() => new Map(walk(plan).map((n) => [n.id, n.title])), [plan]);

  return (
    <article className={styles.panel} aria-label="Import review">
      <header className={styles.header}>
        <h2 className={styles.title}>Import review</h2>
        <span className={styles.badge} data-state={review.status}>{outcome ? "accepted" : review.status === "pending" ? "awaiting admin" : "accepted"}</span>
        <dl className={styles.meta}>
          <div><dt>Genome commit</dt><dd><code>{review.genomeCommit.slice(0, 7)}</code></dd></div>
          {review.decidedAt && <div><dt>Decided</dt><dd>{review.decidedAt}</dd></div>}
        </dl>
        <p className={styles.muted}>
          Every node of the imported Genome is new. Agree with what it says, reject what should not be there: accepting
          removes the rejected nodes in the same step, as an accepted Genome amendment. New Evolutions, plans and intents
          wait until this review is accepted.
        </p>
      </header>

      <Section title="Imported Genome">
        <p className={styles.muted} data-testid="import-summary">{importSummary(decisions)}</p>
        <AgreementTree
          plan={plan}
          variant="genome"
          readOnly={readOnly}
          label="Imported Genome"
          onDecide={(id, d) => setPlan((p) => cascade(p, id, d))}
        />
      </Section>
      <Section title="Readiness findings">
        <Findings findings={review.findings} />
      </Section>
      <Section title="Unmapped app paths">
        {review.unmapped.length ? (
          <>
            <p className={styles.muted}>No node's <code>files</code> binding maps these app paths, so no change to them can be tied to the model.</p>
            <ul className={own.paths} aria-label="Unmapped app paths">
              {review.unmapped.map((p) => <li key={p}><code>{p}</code></li>)}
            </ul>
          </>
        ) : (
          <p className={styles.muted}>Every app path is mapped to a node.</p>
        )}
      </Section>
      <Section title="Decision">
        {accepted && !outcome ? (
          <AcceptedNote review={review} titleOf={(id) => titles.get(id) ?? id} />
        ) : (
          <ImportDecision
            accept={accept}
            fixture={fixture}
            blocker={acceptImportBlocker(decisions, (id) => titles.get(id) ?? id)}
            rejected={decisions.rejected}
            outcome={outcome}
          />
        )}
      </Section>
    </article>
  );
}

function Findings({ findings }: { findings: readonly Finding[] }) {
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => [...findings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]), [findings]);
  if (!sorted.length) return <p className={styles.muted}>No findings: the imported Genome passes every readiness rule.</p>;
  const shown = all ? sorted : sorted.slice(0, FIRST_FINDINGS);
  const count = (l: Finding["level"]) => sorted.filter((f) => f.level === l).length;
  return (
    <div className={styles.stack}>
      <p className={styles.muted}>{count("error")} errors · {count("missing")} missing · {count("warning")} warnings · {count("info")} info</p>
      <ul className={styles.findingList} aria-label="Readiness findings">
        {shown.map((f, i) => (
          <li key={`${f.rule}:${f.subject ?? ""}:${i}`} className={styles.finding}>
            <div className={styles.findingHead}>
              <LevelBadge level={f.level} />
              <code>{f.rule}</code>
              {f.subject && <NodeChip id={f.subject} size="sm" />}
            </div>
            <p className={styles.message}>{f.message}</p>
          </li>
        ))}
      </ul>
      {sorted.length > FIRST_FINDINGS && (
        <button type="button" className={`u-brackets ${own.more}`} aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  );
}

function AcceptedNote({ review, titleOf }: { review: SystemImportReview; titleOf(id: string): string }) {
  const rejected = review.rejectedNodes ?? [];
  return (
    <div className={styles.result}>
      <p>Accepted{review.interpretation ? `: ${review.interpretation}` : "."}</p>
      {rejected.length > 0 && <p className={styles.muted}>Rejected: {rejected.map(titleOf).join(", ")}. An accepted amendment removed them.</p>}
    </div>
  );
}

function ImportDecision({ accept, fixture, blocker, rejected, outcome }: {
  accept: ReturnType<typeof useAcceptImportReview>;
  fixture: boolean;
  /** Why the decisions cannot be accepted yet (undecided nodes, an agreed node under a rejected one). */
  blocker: string | null;
  rejected: string[];
  outcome: SystemImportReviewAcceptResponse | null;
}) {
  const href = useKeepParams();
  const [interpretation, setInterpretation] = useState("");
  const [adminToken, setAdminToken] = useAdminTokenField();
  const [error, setError] = useState<string | null>(null);
  const ids = { interp: useId(), why: useId(), reject: useId(), token: useId() };
  const acceptWhy = outcome ? null : fixture ? "Accepting needs the platform API. The UI is showing fixture data." : blocker;

  const doAccept = () => {
    if (!interpretation.trim()) return setError("Interpretation is required to accept.");
    setError(null);
    accept.mutate({ body: { interpretation: interpretation.trim(), ...(rejected.length && { rejectedNodes: rejected }) }, ...(adminToken && { adminToken }) });
  };

  return (
    <div className={styles.decision}>
      <div className={styles.fieldBlock}>
        <label htmlFor={ids.token}>Admin token</label>
        <input id={ids.token} type="password" value={adminToken} disabled={!!outcome} autoComplete="off" onChange={(e) => setAdminToken(e.target.value)} />
      </div>
      <div className={styles.fieldBlock}>
        <label htmlFor={ids.interp}>Accepted interpretation</label>
        <p id={`${ids.interp}-hint`} className={styles.muted}>Recorded with the import. Say how this Genome should be read.</p>
        <textarea
          id={ids.interp}
          aria-describedby={`${ids.interp}-hint`}
          rows={3}
          value={interpretation}
          disabled={!!outcome}
          onChange={(e) => setInterpretation(e.target.value)}
        />
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={`u-brackets ${styles.primary}`}
          disabled={!!outcome || !!acceptWhy || accept.isPending}
          aria-describedby={acceptWhy ? ids.why : undefined}
          onClick={doAccept}
        >
          {accept.isPending ? "Accepting…" : rejected.length ? `Accept import, remove ${rejected.length} rejected` : "Accept import"}
        </button>
        {acceptWhy && <p id={ids.why} className={styles.muted}>{acceptWhy}</p>}
      </div>
      {accept.error && <p className={styles.error} role="alert">{accept.error.message}</p>}
      {!outcome && (
        <div className={styles.actions}>
          {/* TODO(contract): no reject route for an import review (only `POST …/import-review/accept`); see the SPA-S4 report. */}
          <button type="button" className="u-brackets" disabled aria-describedby={ids.reject}>Reject import</button>
          <p id={ids.reject} className={styles.muted}>
            The platform cannot reject an import yet. Reject the nodes that should not be there and accept the rest, or
            import the System again.
          </p>
        </div>
      )}
      {outcome && (
        <div className={styles.result} role="status">
          <p>
            Accepted. {outcome.amendment
              ? `${rejected.length} rejected node${rejected.length === 1 ? " was" : "s were"} removed from the Genome${outcome.amendment.systemCommit ? ` (System commit ${outcome.amendment.systemCommit.slice(0, 7)})` : ""}.`
              : "Nothing was rejected; the Genome stands as imported."}
          </p>
          {outcome.amendment && (
            <Link className="u-marker" to={href("review", { panel: null, evolution: outcome.amendment.evolution, realization: outcome.amendment.realization })}>
              Open the removal amendment
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
