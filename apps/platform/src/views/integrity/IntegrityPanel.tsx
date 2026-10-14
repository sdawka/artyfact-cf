import { Button, Textarea } from "@/components/ui";
import { agreementEligibility, type IntegrityFinding } from "@artyfact/model";
import type { IntegrityRun } from "../../../shared/integrity";
import { useEffect, useState } from "react";
import { useAdminToken } from "@/api/adminToken";
import { useAgreeIntegrity, useCancelIntegrity, useIntegrityRun, useStartIntegrity } from "@/api/queries";
import styles from "../work/work.module.css";

const active = (state: IntegrityRun["state"]) => state === "queued" || state === "running";
const items = (run: IntegrityRun): IntegrityFinding[] => run.report ? [...run.report.structural.findings, ...run.report.structural.limitations, ...run.report.semantic.findings, ...run.report.semantic.limitations] : [];

/** Exact evidence report. Automated status and human agreement deliberately stay separate. */
export function IntegrityPanel({ run, systemId }: { run: IntegrityRun; systemId?: string }) {
  const { token } = useAdminToken(); const cancel = useCancelIntegrity(systemId); const restart = useStartIntegrity(systemId); const agree = useAgreeIntegrity(systemId);
  const [dispositions, setDispositions] = useState<Record<string, { decision: "accepted" | "rejected" | "repaired" | "deferred"; rationale: string }>>({});
  const report = run.report; const reviewItems = items(run).filter((f) => f.severity === "review" || f.severity === "warning");
  useEffect(() => { setDispositions({}); }, [run.id, report?.id]);
  const proposed = report ? reviewItems.map(f => ({ findingId:f.id, decision:dispositions[f.id]?.decision ?? "accepted", rationale:dispositions[f.id]?.rationale ?? "", actor:"", at:"", reportId:report.id, snapshotHash:report.snapshotHash })) : [];
  const eligibility = report ? agreementEligibility(report, proposed) : undefined;
  const canAgree = !!report && eligibility?.eligible === true;
  return <section className={styles.panel} aria-labelledby="integrity-title">
    <h2 id="integrity-title">Integrity review</h2>
    <p role="status">Run {run.state}. {report ? <>Automated result: {report.status}.</> : "No automated result yet."}</p>
    <p>Human agreement: {run.agreement?.status ?? "pending"}.</p>
    {run.error && <p role="alert" className={styles.error}>{run.error.message}</p>}
    {report && <>
      <p>Structural: {report.structural.status} {report.structural.complete ? "complete" : "incomplete"}. Semantic: {report.semantic.status} {report.semantic.complete ? "complete" : "partial"}.</p>
      {report.semantic.provenance?.fake && <p role="note">Hosted demo model results are simulated; they are not real-provider evidence.</p>}
      <FindingList key={`${run.id}:${report.id}`} title="Findings and coverage limits" findings={items(run)} dispositions={dispositions} setDispositions={setDispositions} allowDisposition={report.status !== "blocked" && run.state === "completed"} />
      {eligibility?.reason && <p className={styles.reason}>{eligibility.reason}</p>}
      {canAgree && <Button type="button" variant="primary" disabled={agree.isPending} onClick={()=>agree.mutate({runId:run.id,body:{dispositions:proposed.map(({findingId,decision,rationale})=>({findingId,decision,rationale}))},...(token&&{adminToken:token})})}>{agree.isPending ? "Recording…" : "Record agreement"}</Button>}
      {agree.isError && <p role="alert" className={styles.error}>{(agree.error as Error).message}</p>}
    </>}
    <div className={styles.actions}>
      {active(run.state) && <Button type="button" variant="secondary" disabled={cancel.isPending} onClick={()=>cancel.mutate({runId:run.id,...(token&&{adminToken:token})})}>Cancel check</Button>}
      {(run.state === "failed" || run.state === "cancelled") && <Button type="button" variant="secondary" disabled={restart.isPending} onClick={()=>restart.mutate({body:{snapshotId:run.snapshotId,provider:run.provider,rerun:true},...(token&&{adminToken:token})})}>Retry check</Button>}
    </div>
  </section>;
}
export function IntegrityReview({ runId, systemId }: { runId: string; systemId?: string }) {
  const { token } = useAdminToken(); const query = useIntegrityRun(runId, token, systemId);
  if (!token) return <p role="note">Set an admin token to read this integrity review.</p>;
  if (query.isLoading) return <p role="status">Loading integrity run…</p>;
  if (query.isError) return <p role="alert" className={styles.error}>Integrity review could not be loaded: {(query.error as Error).message}</p>;
  return query.data?.run ? <IntegrityPanel run={query.data.run} systemId={systemId} /> : null;
}
function FindingList({ title, findings, dispositions, setDispositions, allowDisposition }: { title:string; findings:IntegrityFinding[]; dispositions:Record<string,{decision:"accepted"|"rejected"|"repaired"|"deferred";rationale:string}>; setDispositions:(x:Record<string,{decision:"accepted"|"rejected"|"repaired"|"deferred";rationale:string}>)=>void; allowDisposition:boolean }) {
  return <section><h3>{title}</h3>{findings.length ? <ul>{findings.map(f=>{ const review = f.severity === "review" || f.severity === "warning", d=dispositions[f.id] ?? {decision:"accepted" as const,rationale:""}; return <li key={f.id}><strong>{f.severity}</strong> {f.message} {f.subjects.length ? `(${f.subjects.join(", ")})` : ""}{f.suggestion && <p>Suggested repair: {f.suggestion}</p>}{allowDisposition && review && <><label className={styles.field}>Disposition <select aria-label={`Disposition for ${f.id}`} value={d.decision} onChange={e=>setDispositions({...dispositions,[f.id]:{...d,decision:e.target.value as typeof d.decision}})}><option value="accepted">Accept</option><option value="repaired">Repaired</option><option value="deferred">Defer</option><option value="rejected">Reject</option></select></label><label className={styles.field}>Rationale for {f.id}<Textarea rows={2} value={d.rationale} onChange={e=>setDispositions({...dispositions,[f.id]:{...d,rationale:e.target.value}})}/></label></>}</li>})}</ul> : <p>No findings were returned. This alone does not create human agreement.</p>}</section>;
}
