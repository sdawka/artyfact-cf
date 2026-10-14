import type { TaskCandidateReview, TaskReview } from '../shared/lifecycle';
import { compareExplicitFile } from './compare';
import { badRequest, conflict, fromRpc, notFound } from './errors';
import { systemStub } from './service';

/** Reads have the enclosing System's visibility. Candidates must belong to this Task and pinned plan/base. */
export async function reviewLifecycleTask(env:Env,sid:string,pid:string,tid:string):Promise<TaskReview> {
 const stub=systemStub(env,sid),plan=await stub.realizationPlan(pid).catch(e=>{throw fromRpc(e)??e;}),task=plan.tasks.find(t=>t.id===tid);
 if(!task)throw notFound(`unknown task ${tid}`);
 const candidates:TaskCandidateReview[]=[];
 for(const attempt of task.attempts) {
  for(const candidate of await stub.candidates({realizationId:attempt.realizationId})) {
   const manifest=await stub.candidateManifest(candidate.id);
   if(!manifest || manifest.planId!==pid || manifest.taskId!==tid || manifest.realizationId!==attempt.realizationId || candidate.realization!==attempt.realizationId || manifest.repo!==task.forkRepo || manifest.baseRepo!==task.base.repo || manifest.baseCommit!==task.base.commit || manifest.commit!==candidate.commit || manifest.genomeCommit!==plan.genome.commit || typeof manifest.manifestHash!=='string' || !Array.isArray(manifest.changedPaths) || manifest.changedPaths.length!==candidate.changedPaths.length || candidate.changedPaths.some(path=>!(manifest.changedPaths as string[]).includes(path)))throw conflict('stale-candidate','Task candidate does not match its pinned review manifest');
   candidates.push({candidate,manifest:manifest as TaskCandidateReview['manifest'],evaluations:await stub.evaluations(candidate.id)});
  }
 }
 return {plan,task,candidates};
}
export async function reviewLifecycleTaskFile(env:Env,sid:string,pid:string,tid:string,candidateId:string,path:string) {
 const review=await reviewLifecycleTask(env,sid,pid,tid),entry=review.candidates.find(c=>c.candidate.id===candidateId);
 if(!entry)throw notFound('candidate does not belong to this Task');
 if(!entry.candidate.changedPaths.includes(path))throw badRequest('path must be a changed file of this exact Task candidate');
 const {manifest}=entry;
 return compareExplicitFile(env,{ref:review.plan.baseHead??review.plan.id,repo:manifest.baseRepo,commit:manifest.baseCommit},{ref:candidateId,repo:manifest.repo,commit:manifest.commit},path);
}
