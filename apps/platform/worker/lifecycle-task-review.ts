import { layerOf, type CriterionLayer, type SystemModel } from '@artyfact/model';
import type { CandidateModel, Evaluation, GenomeCandidateReview } from '../shared/api';
import type { TaskCandidateReview, TaskReview } from '../shared/lifecycle';
import { compareExplicitFile } from './compare';
import { badRequest, conflict, fromRpc, notFound } from './errors';
import { artifactsFor } from './artifacts/client';
import { compareFrom } from './lifecycle-model';
import { MODEL_REVIEW_CRITERION } from './lifecycle-model-review';
import { hooksOf } from './promotion';
import { genomeAt, systemStub } from './service';

/** Layer of every criterion `evaluations` name (docs/design/task-fork-model.md §3); an id the Genome lacks is `realization`. */
export function evidenceLayers(m:SystemModel,evaluations:Evaluation[]):Record<string,CriterionLayer> {
 const out:Record<string,CriterionLayer>={};
 for(const id of new Set(evaluations.map(e=>e.criterion))){const c=m.criteria.find(c=>c.id===id);out[id]=c?layerOf(c,hooksOf(m,c)):id===MODEL_REVIEW_CRITERION?'genome':'realization';}
 return out;
}

/** Reads have the enclosing System's visibility. Candidates must belong to this Task and pinned plan/base. */
export async function reviewLifecycleTask(env:Env,sid:string,pid:string,tid:string):Promise<TaskReview> {
 const stub=systemStub(env,sid),plan=await stub.realizationPlan(pid).catch(e=>{throw fromRpc(e)??e;}),task=plan.tasks.find(t=>t.id===tid);
 if(!task)throw notFound(`unknown task ${tid}`);
 const candidates:TaskCandidateReview[]=[];
 for(const attempt of task.attempts) {
  for(const candidate of await stub.candidates({realizationId:attempt.realizationId})) {
   const manifest=await stub.candidateManifest(candidate.id);
   if(!manifest || manifest.planId!==pid || manifest.taskId!==tid || manifest.realizationId!==attempt.realizationId || candidate.realization!==attempt.realizationId || manifest.repo!==task.forkRepo || manifest.baseRepo!==task.base.repo || manifest.baseCommit!==task.base.commit || manifest.commit!==candidate.commit || manifest.genomeCommit!==plan.genome.commit || typeof manifest.manifestHash!=='string' || !Array.isArray(manifest.changedPaths) || manifest.changedPaths.length!==candidate.changedPaths.length || candidate.changedPaths.some(path=>!(manifest.changedPaths as string[]).includes(path)))throw conflict('stale-candidate','Task candidate does not match its pinned review manifest');
   const model=manifest.model as CandidateModel|undefined,stored=model?await stub.review(candidate.id):null;
   // The agent says why it changed the model in a checkpoint: the attempt's last one is the reason shown beside the delta.
   const reason=model?(await stub.realization(attempt.realizationId))?.realization.checkpoints.at(-1)?.summary:undefined;
   candidates.push({candidate,manifest:manifest as TaskCandidateReview['manifest'],evaluations:await stub.evaluations(candidate.id),...(model&&{model:{...model,review:stored?JSON.parse(stored) as GenomeCandidateReview:null,...(reason&&{reason})}})});
  }
 }
 const g=await genomeAt(env,sid,plan.genome.commit,plan.genome.repo);
 return {plan,task,candidates,layers:evidenceLayers(g.model,candidates.flatMap(c=>c.evaluations))};
}
export async function reviewLifecycleTaskFile(env:Env,sid:string,pid:string,tid:string,candidateId:string,path:string) {
 const review=await reviewLifecycleTask(env,sid,pid,tid),entry=review.candidates.find(c=>c.candidate.id===candidateId);
 if(!entry)throw notFound('candidate does not belong to this Task');
 if(!entry.candidate.changedPaths.includes(path))throw badRequest('path must be a changed file of this exact Task candidate');
 const {manifest}=entry,{from,fromPath}=await compareFrom(artifactsFor(env),review.plan.genome,{ref:review.plan.baseHead??review.plan.id,repo:manifest.baseRepo,commit:manifest.baseCommit},path);
 return compareExplicitFile(env,from,{ref:candidateId,repo:manifest.repo,commit:manifest.commit},path,fromPath);
}
