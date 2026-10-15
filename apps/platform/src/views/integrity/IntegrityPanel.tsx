import { Button, Select, Textarea } from "@/components/ui";
import { CommandBlock } from "@/components/CommandBlock/CommandBlock";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { Facts } from "@/components/Facts/Facts";
import { Field, FormActions, Reason } from "@/components/Form/Form";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { Section } from "@/components/Section/Section";
import { StatusText } from "@/components/StatusText/StatusText";
import { agreementEligibility, type IntegrityFinding } from "@artyfact/model";
import type { IntegrityRun } from "../../../shared/integrity";
import { useEffect, useState } from "react";
import { useAdminToken } from "@/api/adminToken";
import { useAgreeIntegrity, useCancelIntegrity, useIntegrityRun, useStartIntegrity } from "@/api/queries";
import styles from "./integrity.module.css";

const active = (state: IntegrityRun["state"]) => state === "queued" || state === "running";
const items = (run: IntegrityRun): IntegrityFinding[] => run.report ? [...run.report.structural.findings, ...run.report.structural.limitations, ...run.report.semantic.findings, ...run.report.semantic.limitations] : [];
/** A rerun repeats the original caller-approved ceiling, never the provider's global maximum. */
export const retryRequest = (run: IntegrityRun) => ({ snapshotId:run.snapshotId, provider:run.provider, ...(run.model && {model:run.model}), thresholds:run.thresholds, budget:{maxCalls:run.requestedCalls}, rerun:true });

type Disposition = { decision: "accepted" | "rejected" | "repaired" | "deferred"; rationale: string };
const DECISIONS = [{ value: "accepted", label: "Accept" }, { value: "repaired", label: "Repaired" }, { value: "deferred", label: "Defer" }, { value: "rejected", label: "Reject" }] as const;
const tone = (status: string) => status === "passed" ? "pass" as const : status === "blocked" || status === "failed" ? "fail" as const : status === "needs-review" ? "attention" as const : "neutral" as const;

/** Exact evidence report. Automated status and human agreement deliberately stay separate. */
export function IntegrityPanel({ run, systemId, headingLevel = 2 }: { run: IntegrityRun; systemId?: string; headingLevel?: 2 | 3 }) {
  const { token } = useAdminToken(); const cancel = useCancelIntegrity(systemId); const restart = useStartIntegrity(systemId); const agree = useAgreeIntegrity(systemId);
  const [dispositions, setDispositions] = useState<Record<string, Disposition>>({});
  const report = run.report; const reviewItems = items(run).filter((f) => f.severity === "review" || f.severity === "warning");
  useEffect(() => { setDispositions({}); }, [run.id, report?.id]);
  const proposed = report ? reviewItems.map(f => ({ findingId:f.id, decision:dispositions[f.id]?.decision ?? "accepted", rationale:dispositions[f.id]?.rationale ?? "", actor:"", at:"", reportId:report.id, snapshotHash:report.snapshotHash })) : [];
  const eligibility = report ? agreementEligibility(report, proposed) : undefined;
  const canAgree = !!report && !run.agreement && eligibility?.eligible === true;
  const retry = run.state === "failed" || run.state === "cancelled" || (run.state === "completed" && !run.agreement);
  return (
    <Section title="Integrity review" headingLevel={headingLevel} surface="panel" className={styles.panel}>
      <p role="status" className={styles.status}>
        <StatusText status={run.state} tone={active(run.state) ? "attention" : run.state === "failed" ? "fail" : "neutral"} label={`Run ${run.state}`} />
        {report ? <span>Automated result: {report.status}.</span> : <span>No automated result yet.</span>}
      </p>
      <p className={styles.status}>Human agreement: {run.agreement?.status ?? "pending"}.</p>
      {run.error && <Reason role="alert" tone="error">{run.error.message}</Reason>}
      {report && <>
        <MetaLine items={[
          { label: "Structural", value: <StatusText status={report.structural.status} tone={tone(report.structural.status)} label={`${report.structural.status}, ${report.structural.complete ? "complete" : "incomplete"}`} /> },
          { label: "Semantic", value: <StatusText status={report.semantic.status} tone={tone(report.semantic.status)} label={`${report.semantic.status}, ${report.semantic.complete ? "complete" : "partial"}`} /> },
        ]} />
        {report.semantic.provenance?.fake && <p role="note" className={styles.note}>Hosted demo model results are simulated; they are not real-provider evidence.</p>}
        <details className={styles.disclosure}>
          <summary>Evidence and coverage</summary>
          <Facts className={styles.facts} items={[
            { term: "Snapshot", value: <><code>{run.snapshotId}</code> · <code>{run.snapshotHash}</code></> },
            { term: "Structural", value: `Subjects: ${report.structural.checkedSubjects.join(", ") || "none"}. Relationships: ${report.structural.checkedRelationships.join(", ") || "none"}.` },
            { term: "Semantic", value: `Subjects: ${report.semantic.checkedSubjects.join(", ") || "none"}. Relationships: ${report.semantic.checkedRelationships.join(", ") || "none"}.` },
            ...(report.semantic.provenance ? [{ term: "Provider", value: `${report.semantic.provenance.provider} · model ${report.semantic.provenance.model || "unknown"} · calls ${report.semantic.provenance.budget.usedCalls}/${run.requestedCalls} requested · questions ${report.semantic.provenance.questions.join(", ") || "none"}` }] : []),
          ]} />
        </details>
        <FindingList key={`${run.id}:${report.id}`} title="Findings and coverage limits" findings={items(run)} dispositions={dispositions} setDispositions={setDispositions} allowDisposition={!run.agreement && report.status !== "blocked" && run.state === "completed"} />
        {eligibility?.reason && <Reason>{eligibility.reason}</Reason>}
        {run.agreement?.eligibility.eligible && (
          <CommandBlock title="Materialize this agreed snapshot" commands={[`ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact init --dir ./project --integrity-run ${run.id} --platform ${window.location.origin}`]}>
            <p>Use the exact agreed run when importing prepared files; accepted vocabulary is separate from this Genome agreement.</p>
          </CommandBlock>
        )}
        {agree.isError && <Reason role="alert" tone="error">{(agree.error as Error).message}</Reason>}
      </>}
      {(canAgree || active(run.state) || retry) && (
        <FormActions>
          {canAgree && <Button type="button" variant="primary" disabled={agree.isPending} onClick={()=>agree.mutate({runId:run.id,body:{dispositions:proposed.map(({findingId,decision,rationale})=>({findingId,decision,rationale}))},...(token&&{adminToken:token})})}>{agree.isPending ? "Recording…" : "Record agreement"}</Button>}
          {active(run.state) && <Button type="button" variant="secondary" disabled={cancel.isPending} onClick={()=>cancel.mutate({runId:run.id,...(token&&{adminToken:token})})}>Cancel check</Button>}
          {retry && <Button type="button" variant="secondary" disabled={restart.isPending} onClick={()=>restart.mutate({body:retryRequest(run),...(token&&{adminToken:token})})}>{run.state === "completed" ? "Run check again" : "Retry check"}</Button>}
        </FormActions>
      )}
    </Section>
  );
}
export function IntegrityReview({ runId, systemId }: { runId: string; systemId?: string }) {
  const { token } = useAdminToken(); const query = useIntegrityRun(runId, token, systemId);
  if (!token) return <Reason role="note">Set an admin token to read this integrity review.</Reason>;
  if (query.isLoading) return <EmptyState title="Loading integrity run…" headingLevel={2} live />;
  if (query.isError) return <Reason role="alert" tone="error">Integrity review could not be loaded: {(query.error as Error).message}</Reason>;
  return query.data?.run ? <IntegrityPanel run={query.data.run} systemId={systemId} /> : null;
}
function FindingList({ title, findings, dispositions, setDispositions, allowDisposition }: { title:string; findings:IntegrityFinding[]; dispositions:Record<string,Disposition>; setDispositions:(x:Record<string,Disposition>)=>void; allowDisposition:boolean }) {
  return (
    <Section title={title} headingLevel={3} count={findings.length}>
      {findings.length ? (
        <ul className={styles.findings}>
          {findings.map(f => {
            const review = f.severity === "review" || f.severity === "warning", d = dispositions[f.id] ?? { decision: "accepted" as const, rationale: "" };
            return (
              <li key={f.id} className={styles.finding}>
                <p className={styles.findingHead}>
                  <StatusText status={f.severity} tone={f.severity === "blocked" ? "fail" : review ? "attention" : "neutral"} />
                  <span>{f.message}</span>
                  {f.subjects.length > 0 && <span className={styles.subjects}>{f.subjects.join(", ")}</span>}
                </p>
                {f.suggestion && <p className={styles.hint}>Suggested repair: {f.suggestion}</p>}
                {allowDisposition && review && (
                  <div className={styles.disposition}>
                    <Field label="Disposition"><Select aria-label={`Disposition for ${f.id}`} value={d.decision} options={DECISIONS} onChange={(v)=>setDispositions({...dispositions,[f.id]:{...d,decision:v as Disposition["decision"]}})} /></Field>
                    <Field label={`Rationale for ${f.id}`}><Textarea rows={2} value={d.rationale} onChange={e=>setDispositions({...dispositions,[f.id]:{...d,rationale:e.target.value}})}/></Field>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p className={styles.hint}>No findings were returned. This alone does not create human agreement.</p>}
    </Section>
  );
}
