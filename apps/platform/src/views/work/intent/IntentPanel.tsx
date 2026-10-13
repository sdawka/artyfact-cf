import { useId, useState } from "react";
import type { IntentAcceptResponse } from "../../../../shared/api";
import { useAdminToken } from "@/api/adminToken";
import { useCreateIntent, useIntent } from "@/api/queries";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useModel } from "@/model/useModel";
import { useParam } from "../lib";
import { intentError } from "./lib";
import { ProposalView } from "./ProposalView";
import { SAMPLE_PROPOSAL } from "./sample";
import workStyles from "../work.module.css";
import styles from "./intent.module.css";

const FIXTURE_REASON = "Describing a change needs the platform API. The UI is showing fixture data.";

/**
 * "Describe a change" (`?panel=intent&anchor=&proposal=`): a message, optionally anchored on a node, becomes a
 * proposal of node updates to review and accept. In fixture mode the form is disabled and a sample proposal shows read-only.
 */
export function IntentPanel({ onAccepted, onClose }: { onAccepted(res: IntentAcceptResponse): void; onClose(): void }) {
  const uid = useId();
  const m = useModel();
  const fixture = m.bundle.source === "fixture";
  const [anchor, setAnchor] = useParam("anchor");
  const [proposalId, setProposalId] = useParam("proposal");
  const { token } = useAdminToken();
  const create = useCreateIntent();
  const proposal = useIntent(fixture ? null : proposalId, token || undefined);
  const [message, setMessage] = useState("");

  const reason = fixture ? FIXTURE_REASON : !message.trim() ? "Describe the change first." : null;

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (reason) return;
    create.mutate(
      { body: { message: message.trim(), ...(anchor && { anchor }) }, ...(token && { adminToken: token }) },
      { onSuccess: (p) => { setMessage(""); setProposalId(p.id); } },
    );
  };

  const shown = fixture ? SAMPLE_PROPOSAL : proposalId ? proposal.data : undefined;

  return (
    <section className={workStyles.panel} aria-labelledby={`${uid}-h`}>
      <div className={workStyles.detailHead}>
        <h2 id={`${uid}-h`}>Describe a change</h2>
        <span className={workStyles.inlineRow}>
          {proposalId && !fixture && (
            <button type="button" className={`u-brackets ${workStyles.btn}`} onClick={() => setProposalId(null)}>Start over</button>
          )}
          <button type="button" className={`u-brackets ${workStyles.btn}`} onClick={onClose}>Back to board</button>
        </span>
      </div>

      {anchor && (
        <p className={workStyles.inlineRow}>
          <span className={workStyles.muted}>Starting from</span>
          <NodeChip id={anchor} size="sm" showId interactive={false} />
          <button type="button" className={`u-brackets ${workStyles.btn}`} onClick={() => setAnchor(null)}>Clear anchor</button>
        </p>
      )}

      {(!proposalId || fixture) && (
        <form onSubmit={submit} className={workStyles.form}>
          <div className={workStyles.field}>
            <label htmlFor={`${uid}-m`}>What should change?</label>
            <textarea id={`${uid}-m`} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} disabled={fixture} />
          </div>
          <div className={workStyles.actions}>
            <button
              type="submit"
              className={`u-brackets ${shown ? workStyles.btn : workStyles.primary}`}
              disabled={!!reason || create.isPending}
              aria-describedby={reason ? `${uid}-why` : undefined}
            >
              {create.isPending ? "Proposing…" : "Propose changes"}
            </button>
            {reason && <span id={`${uid}-why`} className={workStyles.reason}>{reason}</span>}
          </div>
          {create.isError && <p role="alert" className={workStyles.error}>{intentError(create.error)}</p>}
        </form>
      )}

      {fixture && <h3 className={styles.sampleHead}>Sample proposal (fixture data, read-only)</h3>}
      {proposalId && !fixture && proposal.isPending && <p className={workStyles.muted} role="status">Loading proposal {proposalId}…</p>}
      {proposalId && !fixture && proposal.isError && <p role="alert" className={workStyles.error}>{intentError(proposal.error)}</p>}
      {shown && (
        <ProposalView
          // A revised proposal (reply) resets the selection to every op.
          key={`${shown.id}:${shown.ops.map((o) => o.id).join(",")}`}
          proposal={shown}
          readOnly={fixture ? FIXTURE_REASON : null}
          onAccepted={onAccepted}
        />
      )}
    </section>
  );
}
