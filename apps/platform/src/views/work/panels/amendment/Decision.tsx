import { useId, useState } from "react";
import { Link } from "react-router";
import { useAcceptAmendment } from "@/api/queries";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import type { Realization } from "../../../../../shared/api";
import styles from "../AmendmentReview.module.css";
import { shortSha } from "./helpers";

export type DecisionOutcome = { kind: "accepted"; genomeCommit: string } | { kind: "rejected"; reason: string };

export interface DecisionProps {
  evolutionId: string;
  realization: Realization;
  /** Text the interpretation starts with (the changed node's after-text). */
  initialInterpretation: string;
  /** First changed node, for the Map link after accept. */
  focusId: string | undefined;
  /** Set when a hard violation (rule or model-flagged) blocks accept. */
  blocked: boolean;
  outcome: DecisionOutcome | null;
  onOutcome(o: DecisionOutcome): void;
}

/** Accept (interpretation required) or reject (reason required). Reject has no backend route yet, so it is recorded in this view only. */
export function Decision({ evolutionId, realization, initialInterpretation, focusId, blocked, outcome, onOutcome }: DecisionProps) {
  const m = useModel();
  const href = useKeepParams();
  const accept = useAcceptAmendment();
  const [interpretation, setInterpretation] = useState(initialInterpretation);
  const [reason, setReason] = useState("");
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const ids = { interp: useId(), reason: useId(), why: useId() };

  const fixture = m.bundle.source === "fixture";
  const acceptDisabledReason = outcome
    ? "This amendment is already decided."
    : fixture
      ? "Fixture data: the platform API is not connected, so nothing can be accepted."
      : blocked
        ? "Accept is blocked: a hard violation is present. Reject it, or ask the agent to fix the Genome and resubmit."
        : null;

  const doAccept = () => {
    if (!interpretation.trim()) return setAcceptError("Interpretation is required to accept.");
    setAcceptError(null);
    accept.mutate(
      { evolutionId, body: { realization: realization.id, rationale: interpretation.trim() } },
      { onSuccess: (r) => onOutcome({ kind: "accepted", genomeCommit: r.genomeCommit }) },
    );
  };
  const doReject = () => {
    if (!reason.trim()) return setRejectError("A reason is required to reject.");
    setRejectError(null);
    onOutcome({ kind: "rejected", reason: reason.trim() });
  };

  return (
    <div className={styles.decision}>
      <div className={styles.fieldBlock}>
        <label htmlFor={ids.interp}>Accepted interpretation</label>
        <p id={`${ids.interp}-hint`} className={styles.muted}>
          Recorded with the amendment. Say how the Genome should now be read.
        </p>
        <textarea
          id={ids.interp}
          aria-describedby={`${ids.interp}-hint`}
          rows={4}
          value={interpretation}
          disabled={!!outcome}
          onChange={(e) => setInterpretation(e.target.value)}
        />
        {acceptError && <p className={styles.error} role="alert">{acceptError}</p>}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={`u-brackets ${styles.primary}`}
          disabled={!!acceptDisabledReason || accept.isPending}
          aria-describedby={acceptDisabledReason ? ids.why : undefined}
          onClick={doAccept}
        >
          {accept.isPending ? "Accepting…" : "Accept amendment"}
        </button>
        {acceptDisabledReason && !outcome && <p id={ids.why} className={styles.muted}>{acceptDisabledReason}</p>}
      </div>
      {accept.error && <p className={styles.error} role="alert">{accept.error.message}</p>}

      <div className={styles.fieldBlock}>
        <label htmlFor={ids.reason}>Rejection reason</label>
        <textarea id={ids.reason} rows={2} value={reason} disabled={!!outcome} onChange={(e) => setReason(e.target.value)} />
        {rejectError && <p className={styles.error} role="alert">{rejectError}</p>}
      </div>
      <div className={styles.actions}>
        <button type="button" className="u-brackets" disabled={!!outcome} onClick={doReject}>
          Reject amendment
        </button>
      </div>

      {outcome?.kind === "accepted" && (
        <div className={styles.result} role="status">
          <p>
            Accepted. New Genome commit <code>{shortSha(outcome.genomeCommit)}</code>.
          </p>
          {focusId && (
            <Link className="u-marker" to={href("map", { focus: focusId })}>
              Open in Map
            </Link>
          )}
        </div>
      )}
      {outcome?.kind === "rejected" && (
        <div className={styles.result} role="status">
          <p>Reason recorded: {outcome.reason}</p>
          <p className={styles.muted}>There is no reject endpoint yet, so this is kept in this view only; the realization status is unchanged.</p>
        </div>
      )}
    </div>
  );
}
