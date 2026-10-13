import { analyzeTasks, type TaskDefinition } from '@artyfact/model';
import type { RealizationPlan, Task, TaskAttempt, TaskClaimRequest, IntegratedBinding } from '../../shared/lifecycle';
import type { SystemManifest, ArtifactBinding } from '../../shared/api';
import { nowIso } from '../util';

export interface LifecycleHead {systemId:string; head:string|null; genomeCommit:string; genomeSource:string; manifest:SystemManifest|null}
export interface ClaimReservation {plan:RealizationPlan; task:Task; attempt:TaskAttempt; previous:{realizationId:string;forkRepo:string;tokenId:string|null}|null; createFork:boolean}
export class LifecycleStore {
 constructor(private sql:SqlStorage) { sql.exec('CREATE TABLE IF NOT EXISTS realization_plans (id TEXT PRIMARY KEY, json TEXT NOT NULL)'); }
 get(id:string):RealizationPlan { const r=this.sql.exec('SELECT json FROM realization_plans WHERE id = ?',id).toArray()[0]; if(!r) throw new Error(`[not-found] unknown realization plan ${id}`); return JSON.parse(String(r.json)); }
 list():RealizationPlan[] { return this.sql.exec('SELECT json FROM realization_plans ORDER BY rowid DESC').toArray().map(r=>JSON.parse(String(r.json))); }
 save(p:RealizationPlan) {p.updatedAt=nowIso();this.sql.exec('INSERT OR REPLACE INTO realization_plans (id,json) VALUES (?,?)',p.id,JSON.stringify(p));return p;}
 create(head:LifecycleHead,input:{title:string;genomeCommit?:string;expectedHead?:string|null;tasks:TaskDefinition[]},ontologyDigest:string):RealizationPlan {
  if(!head.manifest) throw new Error('[invalid-state] accepted Genome manifest is required');
  if(input.expectedHead!==undefined&&input.expectedHead!==head.head)throw new Error('[stale-base] System changed while preparing task scope; reload and replan');
  if(input.genomeCommit && input.genomeCommit!==head.genomeCommit) throw new Error('[stale-base] plans must pin the current accepted Genome');
  if(!input.title.trim()||!input.tasks.length||input.tasks.length>100) throw new Error('[invalid-state] title and 1-100 tasks required');
  const analysis=analyzeTasks(input.tasks), id=`plan.${crypto.randomUUID()}`, at=nowIso();
  const tasks:Task[]=input.tasks.map(t=>{const base=head.manifest!.artifacts[t.artifactId];if(!base)throw new Error(`[invalid-state] unbound artifact ${t.artifactId}`);if(base.repo!==t.footprint.repo)throw new Error('[invalid-state] source footprint repository mismatch');return {...t,planId:id,status:'pending',base:{...base},forkRepo:`${base.repo}--task-${crypto.randomUUID().slice(0,12)}`,attempts:[],selectedCandidate:null};});
  return this.save({id,systemId:head.systemId,title:input.title,genome:{repo:head.genomeSource,commit:head.genomeCommit},baseHead:head.head,baseManifest:head.manifest,ontologyDigest,status:'planned',tasks,analysis,integration:[],createdAt:at,updatedAt:at});
 }
 task(p:RealizationPlan,id:string):Task {const t=p.tasks.find(t=>t.id===id);if(!t)throw new Error(`[not-found] unknown task ${id}`);return t;}
 fence(pid:string,tid:string,aid:string,generation:number):{plan:RealizationPlan;task:Task;attempt:TaskAttempt} {
  const plan=this.get(pid),task=this.task(plan,tid),attempt=task.attempts.at(-1);
  if(plan.status==='promoted'||!attempt||attempt.id!==aid||attempt.generation!==generation||attempt.status==='ended'||Date.parse(attempt.leaseExpiresAt)<=Date.now())throw new Error('[invalid-state] task attempt is fenced or its lease expired');
  return {plan,task,attempt};
 }
 claim(pid:string,tid:string,input:TaskClaimRequest,resume=false,preparedBase?:{source:ArtifactBinding;selections:string[]}):ClaimReservation {
  const p=this.get(pid), t=this.task(p,tid),last=t.attempts.at(-1);
  if(p.status==='promoted'||t.status==='selected'||t.status==='completed')throw new Error('[invalid-state] task is already selected or completed');
  if(!resume && last && last.status!=='ended' && Date.parse(last.leaseExpiresAt)>Date.now())throw new Error('[invalid-state] task already has an active writer');
  for(const dep of t.dependsOn)if(!this.task(p,dep).selectedCandidate)throw new Error(`[invalid-state] dependency ${dep} is not selected`);
  for(const c of p.analysis.conflicts.filter(c=>c.tasks.includes(tid))) {
   const other=this.task(p,c.tasks.find(id=>id!==tid)!);const a=other.attempts.at(-1);
   if(a&&a.status!=='ended'&&Date.parse(a.leaseExpiresAt)>Date.now())throw new Error(`[invalid-state] task interference with active ${other.id}`);
  }
  if(!last) {
   const same=t.dependsOn.map(d=>this.task(p,d)).filter(d=>d.artifactId===t.artifactId);
   // Only the maximal selected predecessor is safe as a branch base. Divergent predecessors require an explicit combined base.
   const ancestor=(a:string,b:Task):boolean=>b.dependsOn.includes(a)||b.dependsOn.some(d=>ancestor(a,this.task(p,d)));
   const maximal=same.filter(a=>!same.some(b=>a!==b&&ancestor(a.id,b)));
   if(maximal.length>1){if(!preparedBase||JSON.stringify(preparedBase.selections)!==JSON.stringify(p.tasks.map(t=>t.selectedCandidate??'')))throw new Error('[invalid-state] divergent predecessor branches require an exact combined selected base');t.base=preparedBase.source;}
   if(maximal.length===1) {
    const pred=maximal[0],row=this.sql.exec('SELECT commit_hash FROM candidates WHERE id = ?',pred.selectedCandidate!).toArray()[0];
    if(!row)throw new Error('[invalid-state] predecessor candidate unavailable');
    t.base={repo:pred.forkRepo,commit:String(row.commit_hash)};
   }
  }
  let previous:ClaimReservation['previous']=null;
  if(last) {last.status='ended'; const r=this.sql.exec('SELECT token_id FROM realizations WHERE id = ?',last.realizationId).toArray()[0];previous={realizationId:last.realizationId,forkRepo:t.forkRepo,tokenId:r?.token_id==null?null:String(r.token_id)};this.sql.exec("UPDATE realizations SET secret_hash = NULL, status = 'rejected', updated_at = ? WHERE id = ?",nowIso(),last.realizationId);}
  const generation=(last?.generation??0)+1,id=`attempt.${crypto.randomUUID()}`,rid=`realization.task.${crypto.randomUUID()}`,at=nowIso();
  const lease=Math.max(30,Math.min(input.leaseSeconds??900,3600));
  const attempt:TaskAttempt={id,taskId:tid,generation,realizationId:rid,status:'claimed',agentLabel:input.agentLabel??'local agent',leaseExpiresAt:new Date(Date.now()+lease*1000).toISOString(),createdAt:at};
  const n=Number(this.sql.exec('SELECT COALESCE(MAX(n),0)+1 AS n FROM realizations').one().n);
  this.sql.exec("INSERT INTO head(k,v) VALUES('realization_seq',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",String(n));
  this.sql.exec("INSERT INTO realizations (id,evolution_id,n,target,fork_repo,base_commit,agent_label,status,created_at,updated_at,base_repo,base_head,role,origin) VALUES (?,'',?,'app',?,?,?,'claimed',?,?,?,?,'implementer','cli')",rid,n,t.forkRepo,t.base.commit,attempt.agentLabel,at,at,t.base.repo,p.baseHead);
  this.sql.exec('UPDATE realizations SET pinned_genome=?,pinned_genome_repo=?,task_plan_id=? WHERE id=?',p.genome.commit,p.genome.repo,p.id,rid);this.sql.exec('UPDATE realizations SET task_binding_id=? WHERE id=?',t.artifactId,rid);
  t.attempts.push(attempt);t.status='claimed';p.status='implementing';p.integration=[];this.save(p);
  return {plan:p,task:t,attempt,previous,createFork:!last};
 }
 activate(pid:string,tid:string,aid:string,generation:number,input:{tokenId:string;tokenExpires:string;remote:string;secretHash:string}):RealizationPlan {
  const {plan,task,attempt}=this.fence(pid,tid,aid,generation);attempt.status='working';task.status='working';
  this.sql.exec("UPDATE realizations SET token_id=?,token_expires=?,remote=?,secret_hash=?,status='working',updated_at=? WHERE id=?",input.tokenId,input.tokenExpires,input.remote,input.secretHash,nowIso(),attempt.realizationId);return this.save(plan);
 }
 end(pid:string,tid:string,aid:string,generation:number):void {const p=this.get(pid),t=this.task(p,tid),a=t.attempts.at(-1);if(a?.id!==aid||a.generation!==generation)return;a.status='ended';t.status='pending';this.sql.exec("UPDATE realizations SET secret_hash=NULL,status='rejected' WHERE id=?",a.realizationId);this.save(p);}
 heartbeat(pid:string,tid:string,aid:string,generation:number):RealizationPlan {const {plan,attempt}=this.fence(pid,tid,aid,generation);attempt.leaseExpiresAt=new Date(Date.now()+900000).toISOString();return this.save(plan);}
 submitted(pid:string,tid:string,aid:string,generation:number):RealizationPlan {const {plan,task,attempt}=this.fence(pid,tid,aid,generation);task.status='submitted';attempt.status='submitted';task.selectedCandidate=null;plan.integration=[];return this.save(plan);}
 select(pid:string,tid:string,cid:string):RealizationPlan {
  const p=this.get(pid),t=this.task(p,tid),a=t.attempts.at(-1);if(!a||p.status==='promoted')throw new Error('[invalid-state] task has no selectable attempt');
  const latest=this.sql.exec('SELECT id FROM candidates WHERE realization_id=? ORDER BY rowid DESC LIMIT 1',a.realizationId).toArray()[0];
  if(latest?.id!==cid)throw new Error('[invalid-state] only the exact latest task candidate can be selected');
  if(p.tasks.some(d=>d.dependsOn.includes(tid)&&d.attempts.length))throw new Error('[invalid-state] downstream work already pinned this selection; replan to replace it');
  a.status='ended';t.status='selected';t.selectedCandidate=cid;this.sql.exec('UPDATE realizations SET secret_hash=NULL WHERE id=?',a.realizationId);this.sql.exec("UPDATE candidates SET state='selected' WHERE id=?",cid);p.integration=[];return this.save(p);
 }
 integrate(pid:string,bindings:IntegratedBinding[],expectedSelections:string[]):RealizationPlan {const p=this.get(pid);if(p.status==='promoted'||p.status==='integrated')throw new Error('[invalid-state] plan already integrated or promoted; reload its exact review');const selected=p.tasks.map(t=>t.selectedCandidate);if(selected.some(x=>!x)||JSON.stringify(selected)!==JSON.stringify(expectedSelections))throw new Error('[invalid-state] task selection changed during integration');const ids=[...new Set(p.tasks.map(t=>t.artifactId))].sort();if(JSON.stringify(ids)!==JSON.stringify(bindings.map(b=>b.artifactId).sort()))throw new Error('[invalid-state] all changed bindings require integration');p.integration=bindings;p.status='integrated';return this.save(p);}
}
