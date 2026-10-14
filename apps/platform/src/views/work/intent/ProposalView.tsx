import { Button, Textarea } from "@/components/ui";
import { useId, useMemo, useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import type { IntentAcceptResponse, Proposal, ProposalPlanNode } from "../../../../shared/api";
import { useAdminToken } from "@/api/adminToken";
import { decideIntentKey, useAcceptIntent, useDecideIntent, useReplyIntent, useRecoverIntent, useIntegrityRun } from "@/api/queries";
import { IntegrityPanel } from "@/views/integrity/IntegrityPanel";
import { useSystemRoute } from "@/model/useSelection";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { StatusChip } from "@/components/StatusChip/StatusChip";
import { shortSha } from "../lib";
import { useModel } from "@/model/useModel";
import { AgreementTree, acceptSet, cascade, planFromOps, uncoveredOps, type Decision } from "./agreement";
import { OpDiff, ProblemList } from "./OpDiff";
import { confidenceText, intentError, providerLabel } from "./lib";
import workStyles from "../work.module.css";
import styles from "./intent.module.css";

/** One reply box: to a question (`questionId`) or a free follow-up. */
function ReplyForm({ proposalId, questionId, label, blocked }: { proposalId: string; questionId?: string; label: string; blocked: string | null }) {
  const uid = useId();
  const reply = useReplyIntent();
  const { token } = useAdminToken();
  const [answer, setAnswer] = useState("");
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (blocked || !answer.trim()) return;
    reply.mutate(
      { proposalId, body: { answer: answer.trim(), ...(questionId && { questionId }) }, ...(token && { adminToken: token }) },
      { onSuccess: () => setAnswer("") },
    );
  };
  return (
    <form onSubmit={submit} className={styles.reply}>
      <div className={workStyles.field}>
        <label htmlFor={`${uid}-a`}>{label}</label>
        <Textarea id={`${uid}-a`} rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={!!blocked} />
      </div>
      <span className={workStyles.inlineRow}>
        <Button type="submit" variant="secondary" disabled={!!blocked || !answer.trim() || reply.isPending}>
          {reply.isPending ? "Sending…" : "Reply"}
        </Button>
      </span>
      {reply.isError && <p role="alert" className={workStyles.error}>{intentError(reply.error)}</p>}
    </form>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What an accept did, for the panel's status line. */
export interface AcceptedCounts {
  accepted: number;
  deferred: number;
}

/**
 * A proposal: the routed path, provider, answer, problems, the agreement tree over its ops (decided per node),
 * questions with inline replies, and "Accept agreed". `readOnly` (a reason) disables every write, e.g. the fixture
 * sample. Decisions persist on the proposal; a proposal without a stored plan (an older platform) gets one built
 * from the model index and keeps its decisions in this view.
 */
export function ProposalView({ proposal, readOnly, onAccepted }: {
  proposal: Proposal;
  readOnly: string | null;
  onAccepted(res: IntentAcceptResponse, counts: AcceptedCounts): void;
}) {
  const uid = useId();
  const { index } = useModel();
  const accept = useAcceptIntent();
  const revise = useRecoverIntent("revise");
  const abandon = useRecoverIntent("abandon");
  const decideM = useDecideIntent();
  const { systemId } = useSystemRoute();
  // Any decision save still in flight (this view's or another's, queued one at a time) holds accept.
  const saving = useIsMutating({ mutationKey: decideIntentKey(systemId) }) > 0;
  const { token } = useAdminToken();
  const integrity = useIntegrityRun(proposal.stagedApproval?.integrity?.runId, token);
  const provider = providerLabel(proposal);
  const { router, translator, genomeCommit } = proposal.provenance;
  const open = proposal.status === "open";
  const blocked = readOnly ?? (open ? null : `This proposal is ${proposal.status}.`);
  const general = proposal.problems.filter((p) => !p.opId || !proposal.ops.some((o) => o.id === p.opId));

  const stored = proposal.plan?.length ? proposal.plan : null;
  const sig = proposal.ops.map((o) => o.id).join("\n");
  const built = useMemo(() => planFromOps(proposal.ops, index), [proposal.ops, index]);
  const [local, setLocal] = useState<{ sig: string; plan: ProposalPlanNode[] } | null>(null);
  const [recovery, setRecovery] = useState("");
  const plan = stored ?? (local?.sig === sig ? local.plan : built);
  const set = acceptSet(plan, proposal.ops);
  const uncovered = uncoveredOps(plan, proposal.ops);
  const total = proposal.ops.length - uncovered.length;
  const acceptReason =
    blocked ??
    (saving
      ? "Saving decisions…"
      : set.undecided.length
        ? `Decide every change first: ${set.undecided.length} undecided.`
        : set.opIds.length
          ? null
          : "Agree at least one change to accept.");
  const summary = [
    `${set.agreed.length} of ${plural(total, "change")} agreed`,
    set.deferred.length && `${set.deferred.length} deferred`,
    set.rejected.length && `${set.rejected.length} rejected`,
    set.undecided.length && `${set.undecided.length} undecided`,
    set.blocked.size && `${set.blocked.size} blocked by what they need`,
  ].filter(Boolean).join(" · ");

  const decide = (nodeId: string, decision: Decision | null) => {
    if (blocked) return;
    if (stored) {
      decideM.mutate({
        proposalId: proposal.id,
        body: { decisions: [{ nodeId, decision }] },
        apply: (p) => ({ ...p, plan: cascade(p.plan, nodeId, decision) }),
        ...(token && { adminToken: token }),
      });
    } else {
      setLocal({ sig, plan: cascade(plan, nodeId, decision) });
    }
  };

  const submit = () => {
    if (acceptReason) return;
    const counts = { accepted: set.opIds.length, deferred: set.deferred.length };
    accept.mutate(
      { proposalId: proposal.id, body: { opIds: set.opIds }, ...(token && { adminToken: token }) },
      { onSuccess: (res) => onAccepted(res, counts) },
    );
  };

  const opsOf = (node: ProposalPlanNode) => (
    <ul className={styles.ops} aria-label={`Changes to ${node.title}`}>
      {proposal.ops.filter((o) => node.opIds.includes(o.id)).map((op) => (
        <OpDiff key={op.id} op={op} problems={proposal.problems.filter((p) => p.opId === op.id)} />
      ))}
    </ul>
  );

  return (
    <div className={styles.proposal}>
      <div className={workStyles.inlineRow}>
        <StatusChip status={proposal.status} label={`proposal ${proposal.status}`} />
        <StatusChip
          status={`provider-${provider}`}
          label={`provider ${provider}`}
          tone={provider === "real" ? "neutral" : "attention"}
          title={`router ${router.provider} ${router.model} (${router.calls} calls), translator ${translator.provider} ${translator.model}`}
        />
        <span className={workStyles.muted}>Genome <code>{shortSha(genomeCommit)}</code></span>
        {proposal.anchor && <span className={workStyles.muted}>from <NodeChip id={proposal.anchor} size="sm" interactive={false} /></span>}
      </div>
      <p className={workStyles.muted}>Review this Genome Evolution. Accepting the agreed changes commits exactly them to the Genome at once; implementation follows in a separate Realization plan.</p>
      <blockquote className={styles.message}>{proposal.message}</blockquote>

      <section aria-labelledby={`${uid}-route`} className={styles.block}>
        <h3 id={`${uid}-route`}>Routed path</h3>
        {proposal.route.length === 0 ? (
          <p className={workStyles.muted}>unknown</p>
        ) : (
          <ol className={styles.route}>
            {proposal.route.map((s, i) => (
              <li key={`${s.level}-${i}`}>
                <span className={workStyles.muted}>{s.level}</span>
                <code>{s.choice}</code>
                <StatusChip
                  status="confidence"
                  label={`confidence ${confidenceText(s.confidence)}`}
                  tone={s.choice === "unclear" || !(s.confidence > 0) ? "attention" : "neutral"}
                />
              </li>
            ))}
          </ol>
        )}
      </section>

      {proposal.answer && (
        <section aria-labelledby={`${uid}-ans`} className={styles.block}>
          <h3 id={`${uid}-ans`}>Answer</h3>
          <p className={styles.answer}>{proposal.answer}</p>
        </section>
      )}

      <ProblemList problems={general} label="Problems with the proposal" />

      {proposal.ops.length > 0 && (
        <section aria-labelledby={`${uid}-ops`} className={styles.block}>
          <h3 id={`${uid}-ops`}>Proposed changes</h3>
          <p className={workStyles.muted} role="status">{summary}</p>
          <AgreementTree
            plan={plan}
            ops={proposal.ops}
            problems={proposal.problems}
            // Without a stored plan the platform keeps no decisions, so a deferral would be dropped on accept: agree or reject only.
            variant={stored ? "intent" : "genome"}
            readOnly={blocked}
            onDecide={decide}
            renderOps={opsOf}
            label="Proposed changes"
          />
          {uncovered.length > 0 && (
            <>
              <p className={workStyles.muted}>Not in the tree, so not accepted: {uncovered.map((o) => o.id).join(", ")}</p>
              <ul className={styles.ops}>
                {uncovered.map((op) => (
                  <OpDiff key={op.id} op={op} problems={proposal.problems.filter((p) => p.opId === op.id)} />
                ))}
              </ul>
            </>
          )}
          {decideM.isError && <p role="alert" className={workStyles.error}>{intentError(decideM.error)}</p>}
        </section>
      )}
      {proposal.stagedApproval && (
        <section aria-labelledby={`${uid}-recovery`} className={styles.block}>
          <h3 id={`${uid}-recovery`}>Staged candidate recovery</h3>
          <p className={workStyles.muted}>This exact candidate is staged. Revise it or abandon it before changing the agreed changes. Earlier attempts remain visible.</p>
          <Textarea aria-label="Recovery reason or revision" rows={2} value={recovery} onChange={e=>setRecovery(e.target.value)} />
          <div className={workStyles.actions}>
            <Button type="button" variant="secondary" disabled={!recovery.trim() || revise.isPending} onClick={()=>revise.mutate({proposalId:proposal.id,body:{candidateId:proposal.stagedApproval!.candidateId,commit:proposal.stagedApproval!.commit,answer:recovery.trim()},...(token&&{adminToken:token})})}>Revise staged candidate</Button>
            <Button type="button" variant="secondary" disabled={!recovery.trim() || abandon.isPending} onClick={()=>abandon.mutate({proposalId:proposal.id,body:{candidateId:proposal.stagedApproval!.candidateId,commit:proposal.stagedApproval!.commit,reason:recovery.trim()},...(token&&{adminToken:token})})}>Abandon staged candidate</Button>
          </div>
          {proposal.attempts?.length ? <p className={workStyles.muted}>{proposal.attempts.length} prior recovery attempt{proposal.attempts.length === 1 ? "" : "s"} retained.</p> : null}
          {(revise.isError || abandon.isError) && <p role="alert" className={workStyles.error}>{intentError((revise.error ?? abandon.error)!)}</p>}
        </section>
      )}
      {integrity.data?.run && <IntegrityPanel run={integrity.data.run} />}
      {integrity.isError && <p role="alert" className={workStyles.error}>Integrity review could not be loaded: {(integrity.error as Error).message}</p>}

      {open && (
        <section aria-labelledby={`${uid}-q`} className={styles.block}>
          <h3 id={`${uid}-q`}>{proposal.questions.length ? "Questions" : "Follow up"}</h3>
          {proposal.questions.map((q) => (
            <ReplyForm key={q.id} proposalId={proposal.id} questionId={q.id} label={q.text} blocked={blocked} />
          ))}
          {proposal.questions.length === 0 && <ReplyForm proposalId={proposal.id} label="Refine the request" blocked={blocked} />}
        </section>
      )}

      {proposal.ops.length > 0 && (
        <div className={workStyles.actions}>
          <Button
            type="button"
            variant="primary"
            onClick={submit}
            disabled={!!acceptReason || accept.isPending}
            aria-describedby={acceptReason ? `${uid}-why` : undefined}
          >
            {accept.isPending ? "Accepting…" : "Accept agreed"}
          </Button>
          {acceptReason && <span id={`${uid}-why`} className={workStyles.reason}>{acceptReason}</span>}
        </div>
      )}
      {accept.isError && <p role="alert" className={workStyles.error}>{intentError(accept.error)}</p>}
    </div>
  );
}
