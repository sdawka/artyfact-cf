import { CloudVerification } from "./CloudVerification";
import { Button, Checkbox, Textarea } from "@/components/ui";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Candidate } from "../../../shared/api";
import type { ImplementationReview, RealizationPlan } from "../../../shared/lifecycle";
import { LineDiff } from "@/components/LineDiff/LineDiff";
import { useAdminToken } from "@/api/adminToken";
import { lifecycleApi } from "@/api/lifecycle";
import { planError } from "../work/plan/lib";
import { planKeys } from "../work/plan/queries";
import { formStyles as workStyles } from "@/components/Form/Form";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { LayeredEvaluations } from "./TaskReview";
import styles from "./review.module.css";

interface Props {
  plan: RealizationPlan;
  writeReason: string | null;
  busy: boolean;
  run(fn: () => Promise<unknown>): void;
}

/** The integrated plan's combined review: every changed binding, its file diffs and evaluations, then promotion. */
export function PlanReview({ plan, writeReason, busy, run }: Props) {
  const { token } = useAdminToken();
  const [rationale, setRationale] = useState("");
  const [acceptModel, setAcceptModel] = useState(false);
  const review = useQuery({ queryKey: planKeys.review(plan.systemId, plan.id, plan.updatedAt), queryFn: () => lifecycleApi.review(plan.systemId, plan.id, token), retry: false });
  if (review.isLoading) return <p role="status">Loading implementation review…</p>;
  if (review.error) return <p role="alert">{planError("Reading the review", review.error)}</p>;
  const r = review.data;
  if (!r) return <p role="alert">Implementation review is unavailable.</p>;
  // A model delta is promoted only when the admin accepts it explicitly (409 `model-delta-unreviewed` otherwise).
  const modelDelta = r.modelDelta;
  const promoteReason = writeReason ?? (r.ready ? null : "The review is not ready; see the blockers above.") ?? (modelDelta && !acceptModel ? "Accept the model change to promote it." : null);
  return (
    <section aria-labelledby="integrated-review" className={styles.detailPane}>
      <header className={styles.detailPane}>
        <h2 id="integrated-review" className={styles.detailTitle} tabIndex={-1}>Combined implementation review</h2>
        <MetaLine items={[{ label: "plan", value: plan.title }, { label: "expected head", value: r.expectedHead ?? "none", code: true }, { label: "bindings", value: String(r.bindings.length) }]} />
        <p className={styles.reason}>Review every changed artifact binding against the pinned Genome before promotion.</p>
      </header>
      {r.blockers.length > 0 && <ul aria-label="Promotion blockers" className={styles.blockers}>{r.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>}
      <ul className={styles.list}>
        {r.bindings.map((b) => (
          <li key={b.artifactId} className={styles.sub}>
            <h3 className={styles.subTitle}><code>{b.artifactId}</code></h3>
            <MetaLine items={[{ label: "candidate", value: b.candidateId, code: true }, { label: "realized Genome", value: b.realizedGenome.slice(0, 7), code: true, title: b.realizedGenome }]} />
            <details>
              <summary>Source and Task candidate lineage</summary>
              <p className={styles.reason}>{b.source.repo}@{b.source.commit}; realized Genome {b.realizedGenome}</p>
              <p className={styles.reason}>{b.taskCandidates.join(", ")}</p>
            </details>
            <BindingChanges plan={plan} artifactId={b.artifactId} candidate={r.candidates.find((c) => c.id === b.candidateId)} token={token} />
          </li>
        ))}
      </ul>
      {modelDelta && <IntegratedModelDelta plan={plan} delta={modelDelta} artifactId={r.bindings.find((b) => b.model)?.artifactId ?? r.bindings[0]?.artifactId} token={token} />}
      {(r.verificationRequired || r.verifications?.length) ? <CloudVerification systemId={plan.systemId} planId={plan.id} bindings={r.bindings} results={r.verifications ?? []} token={token} busy={busy} writeReason={writeReason} run={run} /> : null}
      {r.evaluations.length > 0 && (
        <div className={styles.sub}>
          <h3 className={styles.subTitle}>Evaluations</h3>
          <LayeredEvaluations evaluations={r.evaluations} layers={r.layers} empty="No evaluations recorded." />
        </div>
      )}
      <form
        className={`${workStyles.form} ${styles.sub}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (promoteReason || busy || !rationale.trim()) return;
          run(() => lifecycleApi.promote(plan.systemId, plan.id, { expectedHead: r.expectedHead, rationale, candidateIds: r.bindings.map((b) => b.candidateId), ...(modelDelta && { acceptModelDelta: true }) }, token));
        }}
      >
        <div className={workStyles.field}>
          <label htmlFor="promotion-rationale">Promotion rationale</label>
          <Textarea id="promotion-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} required />
        </div>
        {modelDelta && (
          <label className={styles.check}>
            <Checkbox checked={acceptModel} onChange={(e) => setAcceptModel(e.target.checked)} /> Accept the model change
            <span className={styles.reason}>Promotion then moves the accepted Genome to <code title={modelDelta.source.commit}>{modelDelta.source.commit.slice(0, 7)}</code>.</span>
          </label>
        )}
        <div className={workStyles.actions}>
          <Button type="submit" variant="primary" reason={promoteReason ?? (rationale.trim() ? undefined : "Write a rationale.")} disabled={busy}>Promote reviewed implementation</Button>
        </div>
      </form>
    </section>
  );
}

/** The integrated commit's `system/` vs the pinned Genome: the model files (compare route) and node ids promotion would accept. */
function IntegratedModelDelta({ plan, delta, artifactId, token }: { plan: RealizationPlan; delta: NonNullable<ImplementationReview["modelDelta"]>; artifactId: string | undefined; token: string }) {
  const [path, setPath] = useState<string>();
  const { model, source } = delta;
  const diff = useQuery({
    queryKey: ["implementation-file", plan.systemId, plan.id, artifactId, source.commit, path, token],
    queryFn: () => lifecycleApi.reviewFile(plan.systemId, plan.id, artifactId!, path!, token),
    enabled: !!path && !!artifactId,
  });
  return (
    <section aria-label="Model change in the integrated result" className={`${styles.sub} ${styles.modelChange}`} data-testid="integrated-model-delta">
      <h3 className={styles.subTitle}>Model change in the integrated result</h3>
      <p className={styles.reason}>A Task changed the model under <code>{model.prefix}/</code>. Promotion accepts it and moves the Genome with the app head; the model is judged on the Model layer.</p>
      <MetaLine items={[{ label: "pinned Genome", value: model.genomeCommit.slice(0, 7), code: true, title: model.genomeCommit }, { label: "integrated", value: `${source.repo}@${source.commit.slice(0, 7)}`, code: true, title: `${source.repo}@${source.commit}` }]} />
      {model.loadError && <p role="alert" className={styles.error}>The integrated model does not load: {model.loadError}. The delta is empty because nothing could be diffed, not because nothing changed.</p>}
      <h4 className={styles.label}>Changed model files</h4>
      {model.changedPaths.length ? (
        <ul className={styles.list}>{model.changedPaths.map((file) => <li key={file}><Button type="button" variant="ghost" size="compact" onClick={() => setPath(file)} aria-pressed={file === path}>{file}</Button></li>)}</ul>
      ) : <p className={styles.muted}>None.</p>}
      <h4 className={styles.label}>Changed nodes</h4>
      {model.changedNodes.length ? (
        <ul className={styles.list}>{model.changedNodes.map((id) => <li key={id} className={styles.judgment}><NodeChip id={id} size="sm" showId /><span className={styles.reason}>{model.delta.added.includes(id) ? "added" : model.delta.removed.includes(id) ? "removed" : "changed"}</span></li>)}</ul>
      ) : <p className={styles.muted}>No node changed.</p>}
      {diff.isLoading && <p role="status">Loading reviewed file changes…</p>}
      {diff.error && <p role="alert">{(diff.error as Error).message}</p>}
      {diff.data && (
        <section aria-label={`Reviewed changes in ${path}`}>
          <p className={styles.reason}>Source <code>{diff.data.from.repo}@{diff.data.from.commit}</code> to <code>{diff.data.to.repo}@{diff.data.to.commit}</code></p>
          {diff.data.binary ? <p>Binary file; inspect the artifact directly before promotion.</p> : <><LineDiff from={diff.data.from.text} to={diff.data.to.text} label={path!} />{diff.data.truncated && <p className={styles.reason}>Only the bounded portion of this file is shown.</p>}</>}
        </section>
      )}
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
      <ul>{candidate?.changedPaths.map((file) => <li key={file}><Button type="button" variant="ghost" size="compact" onClick={() => setPath(file)} aria-pressed={file === path}>{file}</Button></li>)}</ul>
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
