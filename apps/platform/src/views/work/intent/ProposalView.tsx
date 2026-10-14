import { Button, Textarea } from "@/components/ui";
import { useId, useState } from "react";
import type { IntentAcceptResponse, Proposal } from "../../../../shared/api";
import { useAdminToken } from "@/api/adminToken";
import { useAcceptIntent, useReplyIntent } from "@/api/queries";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { StatusChip } from "@/components/StatusChip/StatusChip";
import { shortSha } from "../lib";
import { OpDiff, ProblemList } from "./OpDiff";
import { confidenceText, intentError, providerLabel, withDependencies, withDependents } from "./lib";
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

/**
 * A proposal: the routed path, provider, answer, problems, ops with an include toggle each, questions with inline
 * replies, and "Accept selected". `readOnly` (a reason) disables every write, e.g. the fixture sample.
 */
export function ProposalView({ proposal, readOnly, onAccepted }: {
  proposal: Proposal;
  readOnly: string | null;
  onAccepted(res: IntentAcceptResponse): void;
}) {
  const uid = useId();
  const accept = useAcceptIntent();
  const { token } = useAdminToken();
  const [included, setIncluded] = useState(() => new Set(proposal.ops.map((o) => o.id)));
  const provider = providerLabel(proposal);
  const { router, translator, genomeCommit } = proposal.provenance;
  const open = proposal.status === "open";
  const blocked = readOnly ?? (open ? null : `This proposal is ${proposal.status}.`);
  const selected = proposal.ops.filter((o) => included.has(o.id)).map((o) => o.id);
  const acceptReason = blocked ?? (selected.length ? null : "Select at least one change to accept.");
  const general = proposal.problems.filter((p) => !p.opId || !proposal.ops.some((o) => o.id === p.opId));

  const toggle = (id: string, on: boolean) =>
    setIncluded((prev) => {
      if (on) return new Set([...prev, ...withDependencies(proposal.ops, [id])]);
      const drop = withDependents(proposal.ops, [id]);
      return new Set([...prev].filter((x) => !drop.has(x)));
    });

  const submit = () => {
    if (acceptReason) return;
    accept.mutate({ proposalId: proposal.id, body: { opIds: selected }, ...(token && { adminToken: token }) }, { onSuccess: onAccepted });
  };

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
      <p className={workStyles.muted}>Review this Genome Evolution. Accepting selected changes commits only the reviewed Genome delta; implementation uses a separate Realization.</p>
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
          <p className={workStyles.muted}>{selected.length} of {proposal.ops.length} selected. Unchecked changes are rejected.</p>
          <ul className={styles.ops}>
            {proposal.ops.map((op) => (
              <OpDiff
                key={op.id}
                op={op}
                included={included.has(op.id)}
                onToggle={(on) => toggle(op.id, on)}
                problems={proposal.problems.filter((p) => p.opId === op.id)}
                disabled={!open}
              />
            ))}
          </ul>
        </section>
      )}

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
            {accept.isPending ? "Accepting…" : "Accept selected"}
          </Button>
          {acceptReason && <span id={`${uid}-why`} className={workStyles.reason}>{acceptReason}</span>}
        </div>
      )}
      {accept.isError && <p role="alert" className={workStyles.error}>{intentError(accept.error)}</p>}
    </div>
  );
}
