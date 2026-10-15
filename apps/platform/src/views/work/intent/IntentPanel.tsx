import { Button, Textarea } from "@/components/ui";
import { useId, useState } from "react";
import type { IntentAcceptResponse } from "../../../../shared/api";
import { useAdminToken } from "@/api/adminToken";
import { useCreateIntent, useIntent } from "@/api/queries";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { Panel } from "@/components/Panel/Panel";
import { useModel } from "@/model/useModel";
import { useParam } from "../lib";
import { intentError } from "./lib";
import { ProposalView, type AcceptedCounts } from "./ProposalView";
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
  // An accept that deferred, dropped or failed to defer changes: the panel stays open on this status until the admin moves on.
  const [done, setDone] = useState<{ res: IntentAcceptResponse; counts: AcceptedCounts; from: string | null } | null>(null);
  const settled = done && done.from === proposalId ? done : null;
  // An empty message only says why after a submit attempt; beside an empty box the reason is noise.
  const [tried, setTried] = useState(false);
  const reason = fixture ? FIXTURE_REASON : tried && !message.trim() ? "Describe the change first." : null;

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!message.trim()) setTried(true);
    if (reason || !message.trim()) return;
    create.mutate(
      { body: { message: message.trim(), ...(anchor && { anchor }) }, ...(token && { adminToken: token }) },
      { onSuccess: (p) => { setMessage(""); setProposalId(p.id); } },
    );
  };

  const shown = fixture ? SAMPLE_PROPOSAL : proposalId ? proposal.data : undefined;
  const accepted = (res: IntentAcceptResponse, counts: AcceptedCounts) => {
    if (res.deferred || res.dropped?.length || res.deferralError) setDone({ res, counts, from: proposalId });
    else onAccepted(res);
  };
  const deferredCount = settled ? settled.counts.deferred : 0;

  return (
    <Panel
      title="Describe a change"
      onBack={onClose}
      backLabel="Back to Work"
      secondary={proposalId && !fixture ? <Button type="button" variant="secondary" onClick={() => setProposalId(null)}>Start over</Button> : undefined}
    >
      {anchor && (
        <p className={workStyles.inlineRow}>
          <span className={workStyles.muted}>Starting from</span>
          <NodeChip id={anchor} size="sm" showId interactive={false} />
          <Button type="button" variant="ghost" size="compact" onClick={() => setAnchor(null)}>Clear anchor</Button>
        </p>
      )}

      {(!proposalId || fixture) && (
        <form onSubmit={submit} className={workStyles.form}>
          <div className={workStyles.field}>
            <label htmlFor={`${uid}-m`}>What should change?</label>
            <Textarea
              id={`${uid}-m`}
              rows={4}
              value={message}
              onChange={(e) => { setMessage(e.target.value); if (e.target.value.trim()) setTried(false); }}
              placeholder="Owners can archive a contact without deleting it."
              disabled={fixture}
            />
          </div>
          <div className={workStyles.actions}>
            <Button type="submit" variant={shown ? "secondary" : "primary"} disabled={create.isPending} reason={reason ?? undefined}>
              {create.isPending ? "Proposing…" : "Propose changes"}
            </Button>
          </div>
          {create.isError && <p role="alert" className={workStyles.error}>{intentError(create.error)}</p>}
        </form>
      )}

      {settled && (
        <div className={styles.block} role="status">
          <p>
            Accepted {settled.counts.accepted} {settled.counts.accepted === 1 ? "change" : "changes"} into {settled.res.evolution.title} and
            committed {settled.counts.accepted === 1 ? "it" : "them"} to the Genome.
            {settled.res.deferred && <> {deferredCount} deferred {deferredCount === 1 ? "change waits" : "changes wait"} in a new proposal.</>}
          </p>
          {!!settled.res.dropped?.length && <p>Not accepted or deferred: {settled.res.dropped.join(", ")}.</p>}
          {settled.res.deferralError && <p className={workStyles.error}>The deferred changes were not kept: {settled.res.deferralError}.</p>}
          <span className={workStyles.inlineRow}>
            {settled.res.deferred && (
              <Button type="button" variant="primary" onClick={() => setProposalId(settled.res.deferred!.proposal)}>
                Continue with deferred
              </Button>
            )}
            <Button type="button" variant={settled.res.deferred ? "secondary" : "primary"} onClick={() => onAccepted(settled.res)}>
              Open the accepted change
            </Button>
          </span>
        </div>
      )}
      {fixture && <h3 className={styles.sampleHead}>Sample proposal (fixture data, read-only)</h3>}
      {proposalId && !fixture && proposal.isPending && <p className={workStyles.muted} role="status">Loading proposal {proposalId}…</p>}
      {proposalId && !fixture && proposal.isError && <p role="alert" className={workStyles.error}>{intentError(proposal.error)}</p>}
      {shown && !settled && (
        <ProposalView
          key={shown.id}
          proposal={shown}
          readOnly={fixture ? FIXTURE_REASON : null}
          onAccepted={accepted}
        />
      )}
    </Panel>
  );
}
