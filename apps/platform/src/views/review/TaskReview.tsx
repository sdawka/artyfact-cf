import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { LineDiff } from '@/components/LineDiff/LineDiff';
import { lifecycleApi } from '@/api/lifecycle';
import { useAdminToken } from '@/api/adminToken';
import type { RealizationPlan, TaskCandidateReview } from '../../../shared/lifecycle';
import { planError } from '../work/plan/lib';

export function TaskReview({plan,taskId,writeReason,busy,run}:{plan:RealizationPlan;taskId:string;writeReason:string|null;busy:boolean;run:(fn:()=>Promise<unknown>)=>void}) {
 const {token}=useAdminToken();
 const review=useQuery({queryKey:['task-review',plan.systemId,plan.id,taskId,plan.updatedAt],queryFn:()=>lifecycleApi.taskReview(plan.systemId,plan.id,taskId,token),retry:false,refetchInterval:5000});
 if(review.isLoading)return <p role="status">Loading Task review…</p>;
 if(review.error)return <p role="alert">{planError('Reading Task review',review.error)}</p>;
 if(!review.data)return <p role="alert">Task review is unavailable.</p>;
 const {task,candidates}=review.data;
 return <section aria-label={`Review ${task.title}`}><h2>{task.title}</h2><p>Pinned Genome <code>{plan.genome.commit}</code> · {task.status}</p>
 {candidates.length===0&&<p>No submitted candidate for this Task.</p>}
 {candidates.map(entry=><CandidateEvidence key={entry.candidate.id} entry={entry} plan={plan} taskId={taskId} token={token} writeReason={writeReason} busy={busy} selectable={task.status==='submitted'&&entry.candidate.id===candidates.find(e=>e.candidate.realization===task.attempts.at(-1)?.realizationId)?.candidate.id&&['submitted','evaluated','selected'].includes(entry.candidate.state)} onSelect={()=>run(()=>lifecycleApi.select(plan.systemId,plan.id,taskId,{candidateId:entry.candidate.id},token))}/>)}
 </section>;
}
function CandidateEvidence({entry,plan,taskId,token,writeReason,busy,selectable,onSelect}:{entry:TaskCandidateReview;plan:RealizationPlan;taskId:string;token:string;writeReason:string|null;busy:boolean;selectable:boolean;onSelect:()=>void}){
 const [path,setPath]=useState<string>();const {candidate,manifest,evaluations}=entry;
 const diff=useQuery({queryKey:['task-review-file',plan.systemId,plan.id,taskId,candidate.id,path],queryFn:()=>lifecycleApi.taskReviewFile(plan.systemId,plan.id,taskId,candidate.id,path!,token),enabled:!!path,retry:false});
 return <article><h3>Candidate <code>{candidate.id}</code></h3><p>Manifest <code>{manifest.manifestHash}</code> · source <code>{manifest.repo}@{manifest.commit}</code></p><p>Base <code>{manifest.baseRepo}@{manifest.baseCommit}</code></p>
 <h4>Changed files</h4><ul>{candidate.changedPaths.map(file=><li key={file}><Button variant="ghost" onClick={()=>setPath(file)} aria-pressed={path===file}>{file}</Button></li>)}</ul>
 <h4>Changed Genome nodes</h4><ul>{candidate.changedSubjects.map(id=><li key={id}><code>{id}</code></li>)}</ul>
 {diff.isLoading&&<p role="status">Loading reviewed file changes…</p>}{diff.error&&<p role="alert">{planError('Reading Task file',diff.error)}</p>}
 {diff.data&&<section aria-label={`Reviewed changes in ${path}`}><p>From <code>{diff.data.from.commit}</code> to <code>{diff.data.to.commit}</code></p>{diff.data.binary?<p>Binary file; inspect the artifact directly before selection.</p>:<LineDiff from={diff.data.from.text} to={diff.data.to.text} label={path!}/>} {diff.data.truncated&&<p>Only the bounded portion of this file is shown.</p>}</section>}
 <h4>Recorded evaluations</h4>{evaluations.length?<ul>{evaluations.map(e=><li key={e.id}>{e.criterion}: {e.verdict} ({e.execution})</li>)}</ul>:<p>No evaluations recorded for this candidate.</p>}
 <Button variant="primary" disabled={!!writeReason||busy||!selectable} onClick={()=>{if(!writeReason&&!busy&&selectable)onSelect();}}>Select reviewed Task result</Button>
 {writeReason&&<p>{writeReason}</p>}{!selectable&&<p>This Task result is no longer awaiting selection.</p>}
 </article>;
}
