import { Button, Textarea } from "@/components/ui";
import type { IntegrityFinding } from "@artyfact/model";
import type { IntegrityRun } from "../../../shared/integrity";
import { useState } from "react";
import { useAdminToken } from "@/api/adminToken";
import { useAgreeIntegrity, useCancelIntegrity, useStartIntegrity } from "@/api/queries";
import styles from "../work/work.module.css";

const active = (state: IntegrityRun["state"]) => state === "queued" || state === "running";
const items = (run: IntegrityRun): IntegrityFinding[] => run.report ? [...run.report.structural.findings, ...run.report.structural.limitations, ...run.report.semantic.findings, ...run.report.semantic.limitations] : [];

/** Exact evidence report. Automated status and human agreement deliberately stay separate. */
export function IntegrityPanel({ run }: { run: IntegrityRun }) {
  const { token } = useAdminToken(); const cancel = useCancelIntegrity(); const restart = useStartIntegrity(); const agree = useAgreeIntegrity();
  const [rationale, setRationale] = useState<Record<string, string>>({});
  const report = run.report; const reviewItems = items(run).filter((f) => f.severity === "review" || f.severity === "warning");
  const canAgree = !!report && !!run.agreement?.eligibility.eligible && reviewItems.every((f) => rationale[f.id]?.trim());
  return <section className={styles.panel} aria-labelledby="integrity-title">
    <h2 id="integrity-title">Integrity review</h2>
    <p role="status">Run {run.state}. {report ? <>Automated result: {report.status}.</> : "No automated result yet."}</p>
    <p>Human agreement: {run.agreement?.status ?? "pending"}.</p>
    {run.error && <p role="alert" className={styles.error}>{run.error.message}</p>}
    {report && <>
      <p>Structural: {report.structural.status} {report.structural.complete ? "complete" : "incomplete"}. Semantic: {report.semantic.status} {report.semantic.complete ? "complete" : "partial"}.</p>
      {report.semantic.provenance?.fake && <p role="note">Hosted demo model results are simulated; they are not real-provider evidence.</p>}
      <FindingList title="Findings and coverage limits" findings={items(run)} rationale={rationale} setRationale={setRationale} allowDisposition={run.agreement?.eligibility.eligible === true} />
      {run.agreement?.eligibility.reason && <p className={styles.reason}>{run.agreement.eligibility.reason}</p>}
      {canAgree && <Button type="button" variant="primary" disabled={agree.isPending} onClick={()=>agree.mutate({runId:run.id,body:{dispositions:reviewItems.map(f=>({findingId:f.id,decision:"accepted",rationale:rationale[f.id]!.trim()}))},...(token&&{adminToken:token})})}>{agree.isPending ? "Recording…" : "Record agreement"}</Button>}
      {agree.isError && <p role="alert" className={styles.error}>{(agree.error as Error).message}</p>}
    </>}
    <div className={styles.actions}>
      {active(run.state) && <Button type="button" variant="secondary" disabled={cancel.isPending} onClick={()=>cancel.mutate({runId:run.id,...(token&&{adminToken:token})})}>Cancel check</Button>}
      {(run.state === "failed" || run.state === "cancelled") && <Button type="button" variant="secondary" disabled={restart.isPending} onClick={()=>restart.mutate({body:{snapshotId:run.snapshotId,provider:run.provider,rerun:true},...(token&&{adminToken:token})})}>Retry check</Button>}
    </div>
  </section>;
}
function FindingList({ title, findings, rationale, setRationale, allowDisposition }: { title:string; findings:IntegrityFinding[]; rationale:Record<string,string>; setRationale:(x:Record<string,string>)=>void; allowDisposition:boolean }) {
  return <section><h3>{title}</h3>{findings.length ? <ul>{findings.map(f=><li key={f.id}><strong>{f.severity}</strong> {f.message} {f.subjects.length ? `(${f.subjects.join(", ")})` : ""}{f.suggestion && <p>Suggested repair: {f.suggestion}</p>}{allowDisposition && (f.severity === "review" || f.severity === "warning") && <label className={styles.field}>Rationale for accepting this finding <Textarea rows={2} value={rationale[f.id]??""} onChange={e=>setRationale({...rationale,[f.id]:e.target.value})}/></label>}</li>)}</ul> : <p>No findings were returned. This alone does not create human agreement.</p>}</section>;
}
