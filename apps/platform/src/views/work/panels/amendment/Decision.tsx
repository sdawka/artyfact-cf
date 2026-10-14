import { Button, Input, Textarea } from "@/components/ui";
import { useId, useState } from "react";
import { Link } from "react-router";
import { useAdminTokenField } from "@/api/adminToken";
import { useAcceptAmendment, useRejectAmendment } from "@/api/queries";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import type { Realization } from "../../../../../shared/api";
import styles from "../AmendmentReview.module.css";
import { shortSha } from "./helpers";

export type DecisionOutcome = { kind: "accepted"; genomeCommit: string } | { kind: "rejected"; reason: string };

export interface DecisionProps {
  evolutionId: string;
  realization: Realization;
  /** The candidate whose review the admin is reading, and its commit: accept names exactly these. */
  candidateId: string;
  commit: string;
  /** Text the interpretation starts with (the changed node's after-text). */
  initialInterpretation: string;
  /** First changed node, for the Map link after accept. */
  focusId: string | undefined;
  /** Set when a hard violation (rule or model-flagged) blocks accept. */
  blocked: boolean;
  outcome: DecisionOutcome | null;
  onOutcome(o: DecisionOutcome): void;
  /** The interpretation starts from an editor commit's "why"; say so until it is edited. */
  prefilledFromWhy?: boolean;
}

/** Accept (interpretation required) or reject (reason required). Both need the platform API. */
export function Decision({ evolutionId, realization, candidateId, commit, initialInterpretation, focusId, blocked, outcome, onOutcome, prefilledFromWhy = false }: DecisionProps) {
  const m = useModel();
  const href = useKeepParams();
  const accept = useAcceptAmendment();
  const reject = useRejectAmendment();
  const [interpretation, setInterpretation] = useState(initialInterpretation);
  const [edited, setEdited] = useState(false);
  const [reason, setReason] = useState("");
  // Pre-filled from the header token; a typed value is a one-off.
  const [adminToken, setAdminToken, resetAdminToken] = useAdminTokenField();
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const ids = { interp: useId(), reason: useId(), why: useId(), token: useId() };

  const fixture = m.bundle.source === "fixture";
  const acceptDisabledReason = outcome
    ? "This amendment is already decided."
    : fixture
      ? "Fixture data: the platform API is not connected, so nothing can be accepted."
      : blocked
        ? "Accept is blocked: a hard violation is present. Reject it, or ask the agent to fix the Genome and resubmit."
        : null;

  const rejectDisabledReason = outcome
    ? "This amendment is already decided."
    : fixture
      ? "Fixture data: the platform API is not connected, so nothing can be rejected."
      : null;

  const doAccept = () => {
    if (!interpretation.trim()) return setAcceptError("Interpretation is required to accept.");
    setAcceptError(null);
    accept.mutate(
      { evolutionId, body: { realizationId: realization.id, candidateId, commit, interpretation: interpretation.trim() }, ...(adminToken && { adminToken }) },
      { onSuccess: (r) => onOutcome({ kind: "accepted", genomeCommit: r.genomeCommit }) },
    );
  };
  const doReject = () => {
    if (!reason.trim()) return setRejectError("A reason is required to reject.");
    setRejectError(null);
    reject.mutate(
      { realizationId: realization.id, body: { reason: reason.trim() }, ...(adminToken && { adminToken }) },
      { onSuccess: () => onOutcome({ kind: "rejected", reason: reason.trim() }) },
    );
  };

  return (
    <div className={styles.decision}>
      <div className={styles.fieldBlock}>
        <label htmlFor={ids.token}>Admin token</label>
        <Input id={ids.token} type="password" value={adminToken} disabled={!!outcome} autoComplete="off" onChange={(e) => setAdminToken(e.target.value)} />
      </div>
      <div className={styles.fieldBlock}>
        <label htmlFor={ids.interp}>Accepted interpretation</label>
        <p id={`${ids.interp}-hint`} className={styles.muted}>
          Recorded with the amendment. Say how the Genome should now be read.
        </p>
        <Textarea
          id={ids.interp}
          aria-describedby={`${ids.interp}-hint`}
          rows={4}
          value={interpretation}
          disabled={!!outcome}
          onChange={(e) => { setEdited(true); setInterpretation(e.target.value); }}
        />
        {prefilledFromWhy && !edited && !outcome && <p className={styles.muted}>Rationale pending: pre-filled from the editor commit's why. Edit it to confirm.</p>}
        {acceptError && <p className={styles.error} role="alert">{acceptError}</p>}
      </div>
      <div className={styles.actions}>
        <Button
          type="button"
          variant="primary"
          disabled={!!acceptDisabledReason || accept.isPending}
          aria-describedby={acceptDisabledReason ? ids.why : undefined}
          onClick={doAccept}
        >
          {accept.isPending ? "Accepting…" : "Accept amendment"}
        </Button>
        {acceptDisabledReason && !outcome && <p id={ids.why} className={styles.muted}>{acceptDisabledReason}</p>}
      </div>
      {accept.error && <p className={styles.error} role="alert">{accept.error.message}</p>}
      {reject.error && <p className={styles.error} role="alert">{reject.error.message}</p>}

      <div className={styles.fieldBlock}>
        <label htmlFor={ids.reason}>Rejection reason</label>
        <Textarea id={ids.reason} rows={2} value={reason} disabled={!!outcome} onChange={(e) => setReason(e.target.value)} />
        {rejectError && <p className={styles.error} role="alert">{rejectError}</p>}
      </div>
      <div className={styles.actions}>
        <Button variant="secondary"
          type="button"
          disabled={!!rejectDisabledReason || reject.isPending}
          aria-describedby={rejectDisabledReason ? `${ids.why}-reject` : undefined}
          onClick={doReject}
        >
          {reject.isPending ? "Rejecting…" : "Reject amendment"}
        </Button>
        {rejectDisabledReason && !outcome && <p id={`${ids.why}-reject`} className={styles.muted}>{rejectDisabledReason}</p>}
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
          <p>Rejected. Reason recorded: {outcome.reason}</p>
        </div>
      )}
    </div>
  );
}
