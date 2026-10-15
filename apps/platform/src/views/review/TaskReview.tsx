import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { LineDiff } from '@/components/LineDiff/LineDiff';
import { lifecycleApi } from '@/api/lifecycle';
import { useAdminToken } from '@/api/adminToken';
import { useEvolutions } from '@/api/queries';
import type { CriterionLayer, RealizationPlan, TaskCandidateModelReview, TaskCandidateReview } from '../../../shared/lifecycle';
import type { DeltaReview, Evaluation } from '../../../shared/api';
import { planError } from '../work/plan/lib';
import { MetaLine } from '@/components/MetaLine/MetaLine';
import { KindGlyphs, NodeChip } from '@/components/NodeChip/NodeChip';
import { StatusText } from '@/components/StatusText/StatusText';
import { useModelOptional } from '@/model/useModel';
import { groupByLayer, layerFor } from '@/model/layers';
import { criterionEvidence } from './evidence';
import { DecisionHead } from '../work/panels/DecisionHead';
import styles from './review.module.css';

export function TaskReview({plan,taskId,writeReason,busy,run}:{plan:RealizationPlan;taskId:string;writeReason:string|null;busy:boolean;run:(fn:()=>Promise<unknown>)=>void}) {
 const {token}=useAdminToken();
 const review=useQuery({queryKey:['task-review',plan.systemId,plan.id,taskId,plan.updatedAt],queryFn:()=>lifecycleApi.taskReview(plan.systemId,plan.id,taskId,token),retry:false,refetchInterval:5000});
 if(review.isLoading)return <p role="status">Loading Task review…</p>;
 if(review.error)return <p role="alert">{planError('Reading Task review',review.error)}</p>;
 if(!review.data)return <p role="alert">Task review is unavailable.</p>;
 const {task,candidates,layers}=review.data;
 return <section aria-label={`Review ${task.title}`} className={styles.detailPane}>
 <DecisionHead title={task.title} meta={<MetaLine items={[{label:'plan',value:plan.title},{label:'state',value:task.status},{label:'pinned Genome',value:plan.genome.commit.slice(0,7),code:true,title:plan.genome.commit}]}/>}/>
 {candidates.length===0&&<p className={styles.muted}>No submitted candidate for this Task.</p>}
 {candidates.map(entry=><CandidateEvidence key={entry.candidate.id} entry={entry} plan={plan} taskId={taskId} token={token} layers={layers} writeNodes={task.writeNodes} writeReason={writeReason} busy={busy} selectable={task.status==='submitted'&&entry.candidate.id===candidates.find(e=>e.candidate.realization===task.attempts.at(-1)?.realizationId)?.candidate.id&&['submitted','evaluated','selected'].includes(entry.candidate.state)} onSelect={()=>run(()=>lifecycleApi.select(plan.systemId,plan.id,taskId,{candidateId:entry.candidate.id},token))}/>)}
 </section>;
}
function CandidateEvidence({entry,plan,taskId,token,layers,writeNodes,writeReason,busy,selectable,onSelect}:{entry:TaskCandidateReview;plan:RealizationPlan;taskId:string;token:string;layers:Record<string,CriterionLayer>|undefined;writeNodes:string[];writeReason:string|null;busy:boolean;selectable:boolean;onSelect:()=>void}){
 const [path,setPath]=useState<string>();const {candidate,manifest,evaluations}=entry;
 const diff=useQuery({queryKey:['task-review-file',plan.systemId,plan.id,taskId,candidate.id,path],queryFn:()=>lifecycleApi.taskReviewFile(plan.systemId,plan.id,taskId,candidate.id,path!,token),enabled:!!path,retry:false});
 const why=writeReason??(!selectable?'This Task result is no longer awaiting selection.':undefined);
 return <article className={styles.sub} aria-label={`Candidate ${candidate.id}`}><h3 className={styles.subTitle}>Candidate <code>{candidate.id}</code></h3>
 <MetaLine items={[{label:'manifest',value:manifest.manifestHash,code:true},{label:'source',value:`${manifest.repo}@${manifest.commit.slice(0,7)}`,code:true,title:`${manifest.repo}@${manifest.commit}`},{label:'base',value:`${manifest.baseRepo}@${manifest.baseCommit.slice(0,7)}`,code:true,title:`${manifest.baseRepo}@${manifest.baseCommit}`}]}/>
 <h4 className={styles.label}>Changed files</h4><ul className={styles.list}>{candidate.changedPaths.map(file=><li key={file}><Button variant="ghost" size="compact" onClick={()=>setPath(file)} aria-pressed={path===file}>{file}</Button></li>)}</ul>
 <h4 className={styles.label}>Changed Genome nodes</h4><ul className={styles.list}>{candidate.changedSubjects.map(id=><li key={id}><code>{id}</code></li>)}</ul>
 {entry.model&&<ModelChange model={entry.model} realizationId={candidate.realization} writeNodes={writeNodes} path={path} onOpen={setPath}/>}
 {diff.isLoading&&<p role="status">Loading reviewed file changes…</p>}{diff.error&&<p role="alert">{planError('Reading Task file',diff.error)}</p>}
 {diff.data&&<section aria-label={`Reviewed changes in ${path}`}><p className={styles.reason}>From <code>{diff.data.from.commit}</code> to <code>{diff.data.to.commit}</code></p>{diff.data.binary?<p>Binary file; inspect the artifact directly before selection.</p>:<LineDiff from={diff.data.from.text} to={diff.data.to.text} label={path!}/>} {diff.data.truncated&&<p className={styles.reason}>Only the bounded portion of this file is shown.</p>}</section>}
 <h4 className={styles.label}>Recorded evaluations</h4><LayeredEvaluations evaluations={evaluations} layers={layers} empty="No evaluations recorded for this candidate."/>
 <div><Button variant="primary" reason={why} disabled={busy} onClick={()=>{if(!why&&!busy)onSelect();}}>Select reviewed Task result</Button></div>
 </article>;
}

/** Evidence rows grouped by the criterion's layer: Model, Realization, Running thing (then rows with no layer). Only `pass` is green. */
export function LayeredEvaluations({evaluations,layers,empty}:{evaluations:Evaluation[];layers:Record<string,CriterionLayer>|undefined;empty:string}){
 const m=useModelOptional();
 if(!evaluations.length)return <p className={styles.muted}>{empty}</p>;
 // One row per criterion (and candidate): a criterion with several hooks, or a re-run, folds as the gate folds it.
 const rows=criterionEvidence(evaluations,m?.offTrigger),many=new Set(rows.map(r=>r.candidate)).size>1;
 const groups=groupByLayer(rows,r=>layerFor(layers,m,r.criterion));
 const tone=(v:string)=>v==='pass'?'pass' as const:v==='fail'?'fail' as const:'neutral' as const;
 return <div className={styles.layers}>{groups.map(g=><section key={g.layer} aria-label={g.label} data-layer={g.layer} className={styles.layer}>
  <h5 className={styles.layerTitle}>{g.label} <span className={styles.reason}>{g.says}</span></h5>
  <ul className={styles.list}>{g.items.map(r=><li key={r.key} data-criterion={r.criterion}>{r.criterion}{many&&<> on <code>{r.candidate}</code></>}: <StatusText status={r.verdict} tone={tone(r.verdict)} glyph=""/>{r.hooks.length===1
   ?(r.hooks[0]!.execution!==r.verdict&&<> ({r.hooks[0]!.execution})</>)
   :<span className={styles.reason}> · {r.hooks.map(h=>`${h.hook} ${h.verdict}`).join(', ')}</span>}</li>)}</ul>
 </section>)}</div>;
}

const providerReason=(r:DeltaReview)=>{const p=r.provenance;return p.provider==='off'?'System One off':p.provider==='error'?`System One call failed${p.error?` (${p.error.message})`:''}`:p.provider==='fake'?`fake provider (${p.model}): canned answers, not a real judgment`:`${p.provider} · ${p.model}`;};

/** One System One judgment of a changed node. Only `pass` is green; `unknown` reads "not judged" with the provider's reason. */
function Judgment({id,kind,review}:{id:string;kind:string|undefined;review:DeltaReview|undefined}){
 const chip=<NodeChip id={id} {...(kind&&{kind})} size="sm" showId/>;
 if(!review)return <li className={styles.judgment} data-verdict="unknown">{chip}<StatusText status="unknown" label="not judged"/><span className={styles.reason}>no System One judgment for this node</span></li>;
 const v=review.verdict;
 return <li className={styles.judgment} data-verdict={v}>{chip}
  {v==='pass'?<StatusText status="pass" tone="pass"/>:v==='fail'?<StatusText status="fail" tone="fail"/>:<StatusText status="unknown" label="not judged"/>}
  <MetaLine items={[{label:'level',value:review.level},{label:'subject',value:id,code:true},{value:providerReason(review)}]}/>
 </li>;
}

/**
 * The candidate's model delta (its `system/` vs the pinned Genome): changed model files (the same compare route as the
 * code files), the changed node ids against the Task's write nodes, System One's judgments and the agent's checkpoint
 * reason (from the board's realization; the review DTO carries none).
 */
function ModelChange({model,realizationId,writeNodes,path,onOpen}:{model:TaskCandidateModelReview;realizationId:string;writeNodes:string[];path:string|undefined;onOpen:(p:string)=>void}){
 const board=useEvolutions();
 const checkpoint=board.data?.realizations?.find(r=>r.id===realizationId)?.checkpoints?.at(-1)?.summary;
 const kindOf=(id:string)=>model.review?.delta.changes.find(c=>c.id===id)?.kind;
 const rows:{id:string;op:string}[]=[...model.delta.added.map(id=>({id,op:'added'})),...model.delta.changed.map(c=>({id:c.id,op:c.fields.length?`changed: ${c.fields.join(', ')}`:'changed'})),...model.delta.removed.map(id=>({id,op:'removed'}))];
 const ids=rows.length?rows:model.changedNodes.map(id=>({id,op:'changed'}));
 return <section aria-label="Model change proposed by the agent" className={styles.modelChange} data-testid="model-change">
  <h4 className={styles.label}>Model change proposed by the agent</h4>
  <MetaLine items={[{label:'pinned Genome',value:model.genomeCommit.slice(0,7),code:true,title:model.genomeCommit},{label:'in the fork',value:`${model.prefix}/`,code:true}]}/>
  {model.loadError&&<p role="alert" className={styles.error}>The candidate's model does not load: {model.loadError}. The delta is empty because nothing could be diffed, not because nothing changed.</p>}
  <h5 className={styles.layerTitle}>Changed model files</h5>
  {model.changedPaths.length?<ul className={styles.list}>{model.changedPaths.map(file=><li key={file}><Button variant="ghost" size="compact" onClick={()=>onOpen(file)} aria-pressed={path===file}>{file}</Button></li>)}</ul>:<p className={styles.muted}>None.</p>}
  <h5 className={styles.layerTitle}>Changed nodes <span className={styles.reason}>against this Task's write nodes</span></h5>
  {ids.length?<ul className={styles.list}>{ids.map(({id,op})=><li key={id} className={styles.judgment}><NodeChip id={id} {...(kindOf(id)&&{kind:kindOf(id)})} size="sm" showId/><span className={styles.reason}>{op}</span>{!writeNodes.includes(id)&&<StatusText status="outside-scope" tone="attention" label="outside this Task's write nodes"/>}</li>)}</ul>:<p className={styles.muted}>No node changed.</p>}
  <h5 className={styles.layerTitle}>System One judgments</h5>
  {model.review===null?<p className={styles.muted}>Not judged: System One did not review this change.</p>:ids.length?<KindGlyphs hidden><ul className={styles.list}>{ids.map(({id})=><Judgment key={id} id={id} kind={kindOf(id)} review={model.review!.review.find(r=>r.id===id)}/>)}</ul></KindGlyphs>:<p className={styles.muted}>Nothing to judge.</p>}
  <h5 className={styles.layerTitle}>Why, from the agent's last checkpoint</h5>
  {checkpoint?<p className={styles.checkpoint}>{checkpoint}</p>:<p className={styles.muted}>No checkpoint reason recorded.</p>}
 </section>;
}
