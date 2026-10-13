import type { Candidate } from "../../../shared/api";
import { LineDiff } from "@/components/LineDiff/LineDiff";
import { useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useAdminToken } from '@/api/adminToken';
import { lifecycleApi,lifecyclePaths,scopedRequest } from '@/api/lifecycle';
import { useSystemRoute } from '@/model/useSelection';
import { useModel } from '@/model/useModel';
import type { CreateRealizationPlanRequest,RealizationPlan } from '../../../shared/lifecycle';
import styles from './work.module.css';
const lines=(text:string)=>text.split(/[\n,]/).map(x=>x.trim()).filter(Boolean);
type Draft=CreateRealizationPlanRequest['tasks'][number];
const emptyTask=():Draft=>({id:'',title:'',artifactId:'',steps:[],dependsOn:[],readNodes:[],writeNodes:[],checks:[]});
export function Plans(){
 const {systemId}=useSystemRoute();const {token}=useAdminToken();const model=useModel();const qc=useQueryClient();const [params,setParams]=useSearchParams();const selected=params.get('plan');const [creating,setCreating]=useState(params.get("panel")==="plan");const [title,setTitle]=useState('');const [tasks,setTasks]=useState<Draft[]>([emptyTask()]);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [rationale,setRationale]=useState('');const [candidate,setCandidate]=useState<Record<string,string>>({});
 const enabled=!!token&&model.bundle.source==='api';
 const plans=useQuery({queryKey:['plans',systemId,token],queryFn:()=>lifecycleApi.plans(systemId,token),refetchInterval:5000,enabled});
 const detail=useQuery({queryKey:['plan',systemId,selected,token],queryFn:()=>lifecycleApi.plan(systemId,selected!,token),refetchInterval:5000,enabled:enabled&&!!selected});
 const plan=detail.data;const review=useQuery({queryKey:['implementation-review',systemId,selected,plan?.updatedAt,token],queryFn:()=>lifecycleApi.review(systemId,selected!,token),enabled:enabled&&!!selected&&plan?.status==='integrated'});
 const choose=(id:string)=>{const next=new URLSearchParams(params);next.set('plan',id);setParams(next);};
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();await qc.invalidateQueries({queryKey:['plans',systemId]});await qc.invalidateQueries({queryKey:['plan',systemId]});await qc.invalidateQueries({queryKey:['implementation-review',systemId]});}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const update=(i:number,key:keyof Draft,value:string)=>setTasks(prev=>prev.map((t,n)=>n===i?{...t,[key]:['id','title','artifactId'].includes(key)?value:lines(value)}:t));
 return <section aria-labelledby="realization-plans" className={styles.panel}><div className={styles.detailHead}><h2 id="realization-plans">Realizations</h2><button className={`u-brackets ${styles.btn}`} disabled={!enabled||busy} onClick={()=>setCreating(x=>!x)}>Plan implementation</button></div><p>A Realization implements a pinned accepted Genome. Its Tasks run in isolated forks; Task Attempts preserve retry history.</p>
 {!enabled&&<p className={styles.muted}>Set the admin token to load and manage Realization plans from the platform API.</p>}
 {plans.isLoading&&<p role="status">Loading Realizations…</p>}{plans.error&&<p role="alert">{(plans.error as Error).message}</p>}
 {plans.data&&<ul>{plans.data.plans.map(p=><li key={p.id}><button className={styles.textBtn} aria-pressed={selected===p.id} onClick={()=>choose(p.id)}>{p.title}</button> <span>{p.status}</span></li>)}</ul>}
 {creating&&<form className={styles.form} onSubmit={e=>{e.preventDefault();void run(async()=>{const p=await lifecycleApi.createPlan(systemId,{title,tasks},token);choose(p.id);setCreating(false);});}}><div className={styles.field}><label htmlFor="plan-title">Realization title</label><input id="plan-title" value={title} onChange={e=>setTitle(e.target.value)} required/></div>
 {tasks.map((t,i)=><fieldset className={styles.fieldset} key={i}><legend>Task {i+1}</legend>{(['id','title','artifactId','steps','dependsOn','readNodes','writeNodes','checks'] as const).map(key=><div className={styles.field} key={key}><label htmlFor={`task-${i}-${key}`}>{({id:'Task ID',title:'Task title',artifactId:'Artifact binding ID',steps:'Implementation steps',dependsOn:'Depends on Task IDs',readNodes:'Read scope (Genome node IDs)',writeNodes:'Write scope (Genome node IDs)',checks:'Checks to run'})[key]}</label>{Array.isArray(t[key])?<textarea id={`task-${i}-${key}`} rows={2} value={(t[key] as string[]).join('\n')} onChange={e=>update(i,key,e.target.value)} required={key==='steps'||key==='writeNodes'}/>:<input id={`task-${i}-${key}`} value={t[key] as string} onChange={e=>update(i,key,e.target.value)} required/>}</div>)}</fieldset>)}
 <p className={styles.muted}>Enter one ID, step or check per line. The platform resolves repository identity and inherited source scope before allowing parallel work.</p><div className={styles.actions}><button type="button" className={styles.btn} onClick={()=>setTasks([...tasks,emptyTask()])}>Add Task</button><button className={`u-brackets ${styles.primary}`} disabled={busy||!enabled}>Create pinned Realization</button></div></form>}
 {detail.isLoading&&<p role="status">Loading plan…</p>}{detail.error&&<p role="alert">{(detail.error as Error).message}</p>}
 {plan&&<><h3>{plan.title}</h3><p>Pinned Genome <code>{plan.genome.commit}</code> · {plan.status}</p><details><summary>Dependencies and parallel work</summary><ol>{plan.analysis.waves.map((wave,i)=><li key={i}>{wave.join(', ')}</li>)}</ol>{plan.analysis.conflicts.map((c,i)=><p key={i}>{c.message}</p>)}</details>
 <ul>{plan.tasks.map(task=><li key={task.id}><h4>{task.title}</h4><p>{task.status} · binding <code>{task.artifactId}</code> · depends on {task.dependsOn.join(', ')||'none'}</p><details><summary>Scope, steps, checks and Task Attempts</summary><p>Read: {task.readNodes.join(', ')||'none'}; write: {task.writeNodes.join(', ')}</p><p>Source: <code>{task.footprint.repo}</code> · {task.footprint.known?'known':'independence unknown'}</p><ol>{task.steps.map((step,i)=><li key={i}>{step}</li>)}</ol><ul>{task.checks.map((check,i)=><li key={i}>{check}</li>)}</ul><ul>{task.attempts.map(attempt=><li key={attempt.id}>{attempt.agentLabel} · {attempt.status} · generation {attempt.generation} · lease {attempt.leaseExpiresAt}</li>)}</ul></details><pre tabIndex={0} style={{overflow:'auto'}}>npx artyfact task {task.attempts.length?'resume':'start'} {plan.id} {task.id} --system {systemId} --json</pre>
 {task.status==='submitted'&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{await scopedRequest<RealizationPlan>(lifecyclePaths.action(systemId,plan.id,task.id,'select'),token,'POST',{candidateId:candidate[task.id]});});}}><label htmlFor={`candidate-${task.id}`}>Reviewed candidate ID for {task.title}</label><input id={`candidate-${task.id}`} value={candidate[task.id]??''} onChange={e=>setCandidate({...candidate,[task.id]:e.target.value})} required/><button disabled={busy||!enabled} className={styles.btn}>Select reviewed Task result</button></form>}
 </li>)}</ul>
 {plan.status!=='promoted'&&plan.status!=='integrated'&&<button className={`u-brackets ${styles.btn}`} disabled={busy||!enabled||!plan.tasks.every(t=>t.selectedCandidate)} onClick={()=>void run(async()=>{await lifecycleApi.integrate(systemId,plan.id,token);})}>Integrate selected Task results</button>}
 {review.isLoading&&<p role="status">Loading implementation review…</p>}{review.error&&<p role="alert">{(review.error as Error).message}</p>}
 {review.data&&<section aria-labelledby="integrated-review"><h3 id="integrated-review">Combined implementation review</h3><p>Review every changed artifact binding against the pinned Genome before promotion.</p><ul>{review.data.bindings.map(b=><li key={b.artifactId}><code>{b.artifactId}</code>: candidate <code>{b.candidateId}</code><details><summary>Source and Task candidate lineage</summary><p>{b.source.repo}@{b.source.commit}; realized Genome {b.realizedGenome}</p><p>{b.taskCandidates.join(', ')}</p></details><BindingChanges plan={plan} artifactId={b.artifactId} candidate={review.data!.candidates.find(c=>c.id===b.candidateId)} token={token}/></li>)}</ul><ul>{review.data.evaluations.map(e=><li key={e.id}>{e.criterion}: {e.verdict} ({e.execution})</li>)}</ul><ul>{review.data.blockers.map((b,i)=><li key={i}>{b}</li>)}</ul><form onSubmit={e=>{e.preventDefault();void run(async()=>{const r=review.data!;await lifecycleApi.promote(systemId,plan.id,{expectedHead:r.expectedHead,rationale,candidateIds:r.bindings.map(b=>b.candidateId)},token);});}}><div className={styles.field}><label htmlFor="promotion-rationale">Promotion rationale</label><textarea id="promotion-rationale" value={rationale} onChange={e=>setRationale(e.target.value)} required/></div><button className={`u-brackets ${styles.primary}`} disabled={!review.data.ready||!enabled||busy||!rationale.trim()}>Promote reviewed implementation</button></form></section>}
 </>}{error&&<p role="alert" className={styles.error}>{error}</p>}</section>;
}

function BindingChanges({plan,artifactId,candidate,token}:{plan:RealizationPlan;artifactId:string;candidate:Candidate|undefined;token:string}) {
  const [path,setPath]=useState<string>();
  const diff=useQuery({queryKey:['implementation-file',plan.systemId,plan.id,artifactId,candidate?.id,path,token],queryFn:()=>lifecycleApi.reviewFile(plan.systemId,plan.id,artifactId,path!,token),enabled:!!path});
  return <details><summary>Changed files and Genome nodes for {artifactId}</summary>
    <ul>{candidate?.changedPaths.map(file=><li key={file}><button type="button" className={styles.textBtn} onClick={()=>setPath(file)} aria-pressed={file===path}>{file}</button></li>)}</ul>
    <ul>{candidate?.changedSubjects.map(node=><li key={node}><code>{node}</code></li>)}</ul>
    {diff.isLoading&&<p role="status">Loading reviewed file changes…</p>}
    {diff.error&&<p role="alert">{(diff.error as Error).message}</p>}
    {diff.data&&<section aria-label={`Reviewed changes in ${path}`}><p>Source <code>{diff.data.from.repo}@{diff.data.from.commit}</code> to <code>{diff.data.to.repo}@{diff.data.to.commit}</code></p>
      {diff.data.binary?<p>Binary file; inspect the artifact directly before promotion.</p>:<><LineDiff from={diff.data.from.text} to={diff.data.to.text} label={path!}/>{diff.data.truncated&&<p>Only the bounded portion of this file is shown.</p>}</>}
    </section>}
  </details>;
}
