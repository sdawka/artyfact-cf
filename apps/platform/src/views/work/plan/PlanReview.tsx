import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Candidate } from "../../../../shared/api";
import type { RealizationPlan } from "../../../../shared/lifecycle";
import { LineDiff } from "@/components/LineDiff/LineDiff";
import { useAdminToken } from "@/api/adminToken";
import { lifecycleApi } from "@/api/lifecycle";
import { planKeys } from "./queries";
import workStyles from "../work.module.css";

interface Props {
  plan: RealizationPlan;
  writeReason: string | null;
  busy: boolean;
  run(fn: () => Promise<unknown>): void;
}

/** The integrated plan's combined review: every changed binding, its file diffs and evaluations, then promotion. */
export function PlanReview({ plan, writeReason, busy, run }: Props) {
  const uid = useId();
  const { token } = useAdminToken();
  const [rationale, setRationale] = useState("");
  const review = useQuery({ queryKey: planKeys.review(plan.systemId, plan.id, plan.updatedAt), queryFn: () => lifecycleApi.review(plan.systemId, plan.id, token), retry: false });
  if (review.isLoading) return <p role="status">Loading implementation review…</p>;
  if (review.error) return <p role="alert">{(review.error as Error).message}</p>;
  const r = review.data;
  if (!r) return null;
  const promoteReason = writeReason ?? (r.ready ? null : "The review is not ready; see the blockers above.");
  return (
    <section aria-labelledby="integrated-review">
      <h3 id="integrated-review">Combined implementation review</h3>
      <p>Review every changed artifact binding against the pinned Genome before promotion.</p>
      <ul>
        {r.bindings.map((b) => (
          <li key={b.artifactId}>
            <code>{b.artifactId}</code>: candidate <code>{b.candidateId}</code>
            <details>
              <summary>Source and Task candidate lineage</summary>
              <p>{b.source.repo}@{b.source.commit}; realized Genome {b.realizedGenome}</p>
              <p>{b.taskCandidates.join(", ")}</p>
            </details>
            <BindingChanges plan={plan} artifactId={b.artifactId} candidate={r.candidates.find((c) => c.id === b.candidateId)} token={token} />
          </li>
        ))}
      </ul>
      <ul>{r.evaluations.map((e) => <li key={e.id}>{e.criterion}: {e.verdict} ({e.execution})</li>)}</ul>
      {r.blockers.length > 0 && <ul aria-label="Promotion blockers">{r.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>}
      <form
        className={workStyles.form}
        onSubmit={(e) => {
          e.preventDefault();
          run(() => lifecycleApi.promote(plan.systemId, plan.id, { expectedHead: r.expectedHead, rationale, candidateIds: r.bindings.map((b) => b.candidateId) }, token));
        }}
      >
        <div className={workStyles.field}>
          <label htmlFor="promotion-rationale">Promotion rationale</label>
          <textarea id="promotion-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} required />
        </div>
        <div className={workStyles.actions}>
          <button className={`u-brackets ${workStyles.primary}`} disabled={!!promoteReason || busy || !rationale.trim()} aria-describedby={promoteReason ? `${uid}-p` : undefined}>Promote reviewed implementation</button>
          {promoteReason && <span id={`${uid}-p`} className={workStyles.reason}>{promoteReason}</span>}
        </div>
      </form>
    </section>
  );
}

export function BindingChanges({ plan, artifactId, candidate, token }: { plan: RealizationPlan; artifactId: string; candidate: Candidate | undefined; token: string }) {
  const [path, setPath] = useState<string>();
  const diff = useQuery({
    queryKey: ["implementation-file", plan.systemId, plan.id, artifactId, candidate?.id, path, token],
    queryFn: () => lifecycleApi.reviewFile(plan.systemId, plan.id, artifactId, path!, token),
    enabled: !!path,
  });
  return (
    <details>
      <summary>Changed files and Genome nodes for {artifactId}</summary>
      <ul>{candidate?.changedPaths.map((file) => <li key={file}><button type="button" className={workStyles.textBtn} onClick={() => setPath(file)} aria-pressed={file === path}>{file}</button></li>)}</ul>
      <ul>{candidate?.changedSubjects.map((node) => <li key={node}><code>{node}</code></li>)}</ul>
      {diff.isLoading && <p role="status">Loading reviewed file changes…</p>}
      {diff.error && <p role="alert">{(diff.error as Error).message}</p>}
      {diff.data && (
        <section aria-label={`Reviewed changes in ${path}`}>
          <p>Source <code>{diff.data.from.repo}@{diff.data.from.commit}</code> to <code>{diff.data.to.repo}@{diff.data.to.commit}</code></p>
          {diff.data.binary ? <p>Binary file; inspect the artifact directly before promotion.</p> : <><LineDiff from={diff.data.from.text} to={diff.data.to.text} label={path!} />{diff.data.truncated && <p>Only the bounded portion of this file is shown.</p>}</>}
        </section>
      )}
    </details>
  );
}
