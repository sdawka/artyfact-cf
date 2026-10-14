import { Button, Textarea } from "@/components/ui";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Candidate } from "../../../shared/api";
import type { RealizationPlan } from "../../../shared/lifecycle";
import { LineDiff } from "@/components/LineDiff/LineDiff";
import { useAdminToken } from "@/api/adminToken";
import { lifecycleApi } from "@/api/lifecycle";
import { planError } from "../work/plan/lib";
import { planKeys } from "../work/plan/queries";
import { formStyles as workStyles } from "@/components/Form/Form";
import { MetaLine } from "@/components/MetaLine/MetaLine";
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
  const review = useQuery({ queryKey: planKeys.review(plan.systemId, plan.id, plan.updatedAt), queryFn: () => lifecycleApi.review(plan.systemId, plan.id, token), retry: false });
  if (review.isLoading) return <p role="status">Loading implementation review…</p>;
  if (review.error) return <p role="alert">{planError("Reading the review", review.error)}</p>;
  const r = review.data;
  if (!r) return <p role="alert">Implementation review is unavailable.</p>;
  const promoteReason = writeReason ?? (r.ready ? null : "The review is not ready; see the blockers above.");
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
      {r.evaluations.length > 0 && (
        <div className={styles.sub}>
          <h3 className={styles.subTitle}>Evaluations</h3>
          <ul className={styles.list}>{r.evaluations.map((e) => <li key={e.id}>{e.criterion}: {e.verdict} ({e.execution})</li>)}</ul>
        </div>
      )}
      <form
        className={`${workStyles.form} ${styles.sub}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (promoteReason || busy || !rationale.trim()) return;
          run(() => lifecycleApi.promote(plan.systemId, plan.id, { expectedHead: r.expectedHead, rationale, candidateIds: r.bindings.map((b) => b.candidateId) }, token));
        }}
      >
        <div className={workStyles.field}>
          <label htmlFor="promotion-rationale">Promotion rationale</label>
          <Textarea id="promotion-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} required />
        </div>
        <div className={workStyles.actions}>
          <Button type="submit" variant="primary" reason={promoteReason ?? (rationale.trim() ? undefined : "Write a rationale.")} disabled={busy}>Promote reviewed implementation</Button>
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
