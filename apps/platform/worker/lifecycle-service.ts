import { dispatchPreviewBuild } from './deployments';
import { compareExplicitFile } from './compare';
import { acceptedTemplateResolver } from './ontology-packages/store';
import { gitTransport } from './editor';
import type { ArtifactBinding } from '../shared/api';
import { z } from 'zod';
import { diffModels, isTaskId, overlap, type TaskDefinition } from '@artyfact/model';
import type { RealizationPlan, Task, TaskStartResponse, TaskSubmitResponse, ImplementationReview, IntegratedBinding, PlanPromoteResponse } from '../shared/lifecycle';
import type { Candidate, Evaluation, GateItem } from '../shared/api';
import { artifactsErrorCode, artifactsFor, forkAndWait, remoteUrl, withRepo, type ArtifactsRepoLike, type TreeEntry } from './artifacts/client';
import { diffTrees, manifestHash, type TreeDiff } from './artifacts/candidates';
import { listTree } from './artifacts/genome-source';
import { nodesForPath, sourceMapFor } from './artifacts/source-map';
import { newRealizationSecret } from './auth';
import { badRequest, conflict, fromRpc, notFound, unprocessable } from './errors';
import { hookRunner } from './hooks';
import { selectHooks } from './hooks/run';
import type { CandidateRef, SubmissionContext } from './hooks/contract';
import { pushCommit, type FileChange } from './git/push';
import { gateCriteria, hooksOf } from './promotion';
import { evidenceFresh, gateRefusal, genomeAt, refreshRegistry, revokeEnded, systemStub } from './service';
import { lifecyclePacket } from './packets/lifecycle-packet';
import { taskDefinitions } from './tasks/definitions';
import { sha256Hex } from './util';
import { screenshotsSchema, storeScreenshots } from './evidence';
import picomatch from 'picomatch';
import { buildTaskManifest, compareFrom, inFootprint, isModelPath, modelPathNodes, modelTreeDiff, pinnedModelEntries, seedModel, splitDiff, TASK_PROTECTED, taskModelOf, taskPermittedGlobs, type ModelLoader, type TaskManifest } from './lifecycle-model';
import { reviewTaskModel } from './lifecycle-model-review';
import { buildGenome } from './artifacts/genome-source';
import { evidenceLayers } from './lifecycle-task-review';

/** Registry refresh after a lifecycle write landed: best-effort, so a failed cache write never fails the write itself. */
const refresh=(env:Env,sid:string)=>refreshRegistry(env,sid).then(()=>{},e=>console.error(`[lifecycle] registry refresh for ${sid} failed: ${(e as Error)?.message??e}`));
const sha=z.string().regex(/^[0-9a-f]{40}$/), nonempty=z.string().trim().min(1).max(200);
const strings=z.array(nonempty).max(500);
const taskSchema=z.object({id:nonempty.refine(isTaskId,'task ids use letters, digits, ".", "_" or "-", never start with "-", and are not "." or ".."'),title:nonempty,artifactId:nonempty,steps:strings.min(1),dependsOn:strings.default([]),readNodes:strings.default([]),writeNodes:strings.min(1),checks:strings.default([])}).strict();
const planSchema=z.object({title:nonempty,genomeCommit:sha.optional(),tasks:z.array(taskSchema).min(1).max(100)}).strict();
const claimSchema=z.object({agentLabel:nonempty.optional(),leaseSeconds:z.number().int().min(30).max(3600).optional()}).strict();
const attemptSchema=z.object({attemptId:nonempty,generation:z.number().int().positive()});
const checkpointSchema=attemptSchema.extend({message:z.string().trim().min(1).max(4000),commit:sha.optional()}).strict();
const submitSchema=attemptSchema.extend({commit:sha,previewUrl:z.string().url().max(2048).optional(),screenshots:screenshotsSchema.optional()}).strict();
const selectSchema=z.object({candidateId:nonempty}).strict();
const promoteSchema=z.object({expectedHead:z.string().nullable(),rationale:z.string().trim().min(1).max(4000),candidateIds:strings.min(1),acceptModelDelta:z.boolean().optional()}).strict();
function parse<T>(schema:z.ZodType<T>,body:unknown):T {const out=schema.safeParse(body);if(!out.success)throw badRequest('invalid lifecycle request',out.error.issues);return out.data;}
async function rpc<T>(promise:Promise<T>):Promise<T> {try{return await promise;}catch(e){throw fromRpc(e)??e;}}
function taskOf(p:RealizationPlan,tid:string):Task {const t=p.tasks.find(t=>t.id===tid);if(!t)throw notFound(`unknown task ${tid}`);return t;}
const topo=(p:RealizationPlan)=>p.analysis.waves.flatMap(w=>w.map(id=>taskOf(p,id)));
/** Loads a candidate's model with the System's accepted template packs (the model delta and its review). */
async function modelLoader(env:Env,sid:string):Promise<{load:ModelLoader;templates:ReturnType<typeof acceptedTemplateResolver>['templates']}> {const templates=acceptedTemplateResolver(await systemStub(env,sid).ontologyAcceptedPackages()).templates;return {load:(files,revision)=>buildGenome(files,revision,templates).model,templates};}
/** The candidate manifest of a lifecycle fork commit (docs/design/task-fork-model.md §2). */
async function taskManifest(env:Env,p:RealizationPlan,input:{realizationId:string;repo:string;baseRepo:string;baseCommit:string;commit:string;previewUrl?:string},writeNodes:string[]):Promise<TaskManifest> {const g=await genomeAt(env,p.systemId,p.genome.commit,p.genome.repo),{load}=await modelLoader(env,p.systemId);return buildTaskManifest(artifactsFor(env),input,p.genome,g.model,sourceMapFor(g.model),load,writeNodes);}
/** Review a recorded candidate's model delta with System One and store the review and its evaluation row. */
async function recordModelReview(env:Env,p:RealizationPlan,candidate:Candidate,manifest:TaskManifest):Promise<Evaluation[]> {
 if(!manifest.model)return [];
 const stub=systemStub(env,p.systemId),g=await genomeAt(env,p.systemId,p.genome.commit,p.genome.repo),{templates}=await modelLoader(env,p.systemId);
 const {review,evaluation}=await reviewTaskModel(env,artifactsFor(env),{candidateId:candidate.id,commit:candidate.commit,fork:{repo:manifest.repo,commit:candidate.commit},genome:p.genome,base:g,model:manifest.model,templates});
 await stub.putReview(candidate.id,JSON.stringify(review));await stub.recordEvaluations(candidate.id,[evaluation],'evaluated');return [evaluation];
}
export async function createRealizationPlan(env:Env,sid:string,body:unknown):Promise<RealizationPlan> {
 const input=parse(planSchema,body),stub=systemStub(env,sid),state=await stub.state();if(!state?.manifest)throw notFound(`system ${sid} has no accepted Genome`);if(input.genomeCommit&&input.genomeCommit!==state.genomeCommit)throw conflict('stale-base','Create the plan against the current accepted Genome revision');
 const g=await genomeAt(env,sid,state.genomeCommit,state.genomeSource),model=g.model;
 const trees=new Map<string,string[]>();
 for(const t of input.tasks) {
  const binding=state.manifest.artifacts[t.artifactId];if(!binding)throw badRequest(`unknown source binding ${t.artifactId}`);
  const unknown=[...t.readNodes,...t.writeNodes].filter(id=>!model.index.byId[id]);if(unknown.length)throw badRequest(`unknown ontology nodes: ${unknown.join(', ')}`);
  if(t.checks.some(id=>!model.criteria.some(c=>c.id===id)))throw badRequest('task checks must name accepted Genome criteria');
  if(!trees.has(t.artifactId))trees.set(t.artifactId,await withRepo(artifactsFor(env),binding.repo,async repo=>[...(await listTree(repo,binding.commit)).keys()]));
 }
 const tasks:TaskDefinition[]=taskDefinitions(model,state.manifest,Object.fromEntries(trees),input.tasks);
 let plan:RealizationPlan;
 try{plan=await rpc(stub.createRealizationPlan({...input,genomeCommit:state.genomeCommit,expectedHead:state.head,tasks}));}catch(e){if(fromRpc(e))throw e;if(e instanceof Error&&!('status'in e))throw badRequest(e.message);throw e;}
 await refresh(env,sid);return plan;
}
export async function assertGenomeCompatible(env:Env,p:RealizationPlan):Promise<void> {
 const state=await systemStub(env,p.systemId).state();if(!state)throw notFound('System no longer exists');
 if(state.genomeCommit===p.genome.commit)return;
 const [before,after]=await Promise.all([genomeAt(env,p.systemId,p.genome.commit,p.genome.repo),genomeAt(env,p.systemId,state.genomeCommit,state.genomeSource)]);
 const delta=diffModels(before.model,after.model),nodes=[...new Set(p.tasks.flatMap(t=>[...t.writeNodes,...t.readNodes]))],checks=[...new Set(p.tasks.flatMap(t=>t.checks))];
 const scope=new Set([...nodes,...checks]),criteria=new Set(checks);
 // Selection and promotion use both revisions: an attached or newly enforced contract is also a scope change.
 for(const model of [before.model,after.model]) {
  const candidate:CandidateRef={id:'',realizationId:'',evolutionId:'',target:'app',commit:'',baseCommit:'',changedPaths:[],changedNodes:nodes};
  const evolution={id:'',kind:'implementation' as const,acceptanceCriteria:checks,affectedNodes:nodes,state:'realizing' as const};
  const effective=new Set([...checks,...gateCriteria(model,evolution,candidate).map(c=>c.id),...(['submission','promotion'] as const).flatMap(trigger=>selectHooks(model,candidate,trigger,evolution).map(s=>s.criterion.id))]);
  for(const id of effective) {
   criteria.add(id);scope.add(id);
   const c=model.criteria.find(c=>c.id===id);if(!c)continue;
   for(const dependency of [c.ownerId,c.subjectId,...c.sourceRefs,...c.hooks,...hooksOf(model,c).map(h=>h.id)])if(dependency)scope.add(dependency);
  }
  // Owners and source dependencies can inherit contracts from their enclosing ontology paths.
  for(const id of [...scope])for(const ancestor of model.index.path(id))scope.add(ancestor);
 }
 const taskDelta={added:[],removed:[],changed:[...scope].map(id=>({id,fields:[]})),affectedCriteria:[...criteria],affectedJourneys:[]};
 const o=overlap(delta,taskDelta,before.model);
 if(o.shared.length||o.viaCriteria.length)throw conflict('replan-required','accepted Genome changed overlapping task scope; create a new pinned plan');
}
export async function startLifecycleTask(env:Env,sid:string,pid:string,tid:string,body:unknown,platformUrl:string,resume=false):Promise<TaskStartResponse> {
 const input=parse(claimSchema,body),stub=systemStub(env,sid),p=await rpc(stub.realizationPlan(pid));await assertGenomeCompatible(env,p);
 const originalTask=taskOf(p,tid),preparedBase=originalTask.attempts.length?undefined:await prepareFanInBase(env,p,originalTask);
 const claim=await stub.claimLifecycleTask(pid,tid,input,resume,preparedBase).catch(async e=>{throw await claimRefusal(stub,pid,tid,e);}),{task,attempt}=claim;let tokenId:string|undefined,out:TaskStartResponse;
 try {
  // Revoke before creating replacement credentials; if revocation fails, no replacement writer is minted.
  for(const credential of await stub.lifecycleCredentials(pid,tid))if(credential.tokenId){await withRepo(artifactsFor(env),credential.forkRepo,r=>r.revokeToken(credential.tokenId!));await stub.lifecycleCredentialRevoked(credential.realizationId,credential.tokenId);}
  const forked=claim.createFork?await forkAndWait(artifactsFor(env),task.base.repo,task.forkRepo,{baseCommit:task.base.commit}):await withRepo(artifactsFor(env),task.forkRepo,r=>r.info()).catch(e=>{if(artifactsErrorCode(e)==='NOT_FOUND')return forkAndWait(artifactsFor(env),task.base.repo,task.forkRepo,{baseCommit:task.base.commit});throw e;});
  const remote=remoteUrl(env,task.forkRepo,forked.remote);
  // The fork carries the pinned model under system/ (docs/design/task-fork-model.md §1). A fork of the app binding gets the
  // pinned Genome (replacing a stale system/); a fork of a predecessor's candidate keeps the model it selected.
  let model=task.model;
  if(!model){const [head]=await withRepo(artifactsFor(env),task.forkRepo,r=>r.log({limit:1}));const overwrite=task.base.repo===p.baseManifest.artifacts[task.artifactId]?.repo;model=taskModelOf(p.genome.commit,await seedModel(artifactsFor(env),task.forkRepo,head?.hash??task.base.commit,p.genome,{overwrite,remote}));}
  const token=await withRepo(artifactsFor(env),task.forkRepo,r=>r.createToken('write',Math.min(input.leaseSeconds??900,3600)));tokenId=token.id;
  const secret=newRealizationSecret();
  const plan=await rpc(stub.lifecycleActivate(pid,tid,attempt.id,attempt.generation,{tokenId:token.id,tokenExpires:token.expiresAt,remote,secretHash:await sha256Hex(secret),model}));
  const reviewUrl=`${platformUrl.replace(/\/$/,'')}/s/${encodeURIComponent(sid)}/r/head/review?plan=${encodeURIComponent(pid)}&task=${encodeURIComponent(tid)}`;
  const current=taskOf(plan,tid),g=await genomeAt(env,sid,p.genome.commit,p.genome.repo),packet=lifecyclePacket({plan,task:current,attempt:current.attempts.at(-1)!,remote,reviewUrl,model:g.model});
  out={plan,task:current,attempt:current.attempts.at(-1)!,secret,token:{value:token.plaintext,expiresAt:token.expiresAt,remote},remote,packet,reviewUrl};
 }catch(e){
  const log=(what:string)=>(w:unknown)=>console.error(`[lifecycle] ${what} after a failed ${resume?'resume':'claim'} of ${pid}/${tid} failed: ${(w as Error)?.message??w}`);
  if(tokenId)await withRepo(artifactsFor(env),task.forkRepo,r=>r.revokeToken(tokenId!)).then(()=>stub.lifecycleCredentialRevoked(attempt.realizationId,tokenId!)).catch(log(`revoking token ${tokenId}`));
  await stub.lifecycleEnd(pid,tid,attempt.id,attempt.generation).catch(log(`ending attempt ${attempt.id}`));await refresh(env,sid);throw e;}
 // Outside the try: the claim is live and credentials are minted; nothing after this may undo them.
 await refresh(env,sid);return out;
}
/**
 * A claim refusal from the DO as an HttpError with structured details, same code and message: unselected dependencies
 * give `{blockedOn}`, a live writer on this task gives `{by}`, a live conflicting task gives `{taskId, by}`.
 */
async function claimRefusal(stub:ReturnType<typeof systemStub>,pid:string,tid:string,e:unknown):Promise<unknown> {
 const http=fromRpc(e);if(!http||http.status!==409)return http??e;
 const p=await stub.realizationPlan(pid).catch(()=>null),t=p?.tasks.find(t=>t.id===tid);if(!p||!t)return http;
 let details:Record<string,unknown>|undefined;
 if(/^dependency \S+ is not selected$/.test(http.message))details={blockedOn:t.dependsOn.filter(d=>!p.tasks.find(x=>x.id===d)?.selectedCandidate)};
 else if(http.message==='task already has an active writer')details={by:t.attempts.at(-1)?.agentLabel??null};
 else{const m=/^task interference with active (\S+)$/.exec(http.message),other=m&&p.tasks.find(x=>x.id===m[1]);if(other)details={taskId:other.id,by:other.attempts.at(-1)?.agentLabel??null};}
 return details?conflict(http.code,http.message,details):http;
}
export async function checkpointLifecycleTask(env:Env,sid:string,pid:string,tid:string,body:unknown){const i=parse(checkpointSchema,body);return rpc(systemStub(env,sid).lifecycleCheckpoint(pid,tid,i.attemptId,i.generation,i));}

async function runCandidate(env:Env,p:RealizationPlan,task:Pick<Task,'checks'|'writeNodes'|'footprint'|'base'>,candidate:Candidate,repoName:string,trigger:'submission'|'promotion'='submission',exact=true):Promise<Evaluation[]> {
 const g=await genomeAt(env,p.systemId,p.genome.commit,p.genome.repo),stub=systemStub(env,p.systemId),manifest=await stub.candidateManifest(candidate.id);
 if(!manifest)throw conflict('gate-unavailable','candidate manifest missing');
 const sm=sourceMapFor(g.model),pathNodes={...Object.fromEntries(candidate.changedPaths.filter(path=>!isModelPath(path)).map(path=>[path,nodesForPath(sm,path)])),...modelPathNodes(g.model,candidate.changedPaths)};
 const tree=await withRepo(artifactsFor(env),repoName,async repo=>{const listing=await listTree(repo,candidate.commit),required=new Set(g.model.hooks.filter(h=>h.engine==='manifest').flatMap(h=>(h.inputs.requiredFiles??'').split(',').map(s=>s.trim()).filter(Boolean)));return Promise.all([...listing].map(async([path,e])=>({path,size:required.has(path)?(await repo.readBlob(e.hash))?.size??-1:-1})));});
 const previewUrl=typeof manifest.previewUrl==='string'?manifest.previewUrl:undefined;
 const build=previewUrl?(await stub.builds({realization:candidate.realization,commit:candidate.commit,kind:'preview'})).find(b=>b.status==='passed'&&b.url===previewUrl&&!!b.buildId&&(b.candidate===candidate.id||b.candidate===null)):undefined;
 const screenshots=Array.isArray(manifest.screenshots)?manifest.screenshots as CandidateRef['screenshots']:undefined;
 const ref:CandidateRef={...(previewUrl&&{previewUrl}),...(screenshots?.length&&{screenshots}),...(build?.buildId&&{expectedBuildId:build.buildId}),id:candidate.id,realizationId:candidate.realization,evolutionId:'',target:'app',commit:candidate.commit,baseCommit:task.base.commit,changedPaths:candidate.changedPaths,changedNodes:candidate.changedSubjects,pathNodes};
 // Same freshness rule as the legacy gate: latest evaluation per blocking criterion binds this candidate (commit, Genome or preview).
 const evidenceFreshNow=evidenceFresh(g.model,{acceptanceCriteria:task.checks},ref,await stub.evaluations(candidate.id),candidate.submittedAt,p.genome.commit);
 const ctx:SubmissionContext={systemId:p.systemId,candidate:ref,genomeCommit:p.genome.commit,genomeFiles:Object.fromEntries(g.files),tree,permittedPaths:taskPermittedGlobs(task.footprint.globs),protectedPaths:TASK_PROTECTED,openCandidates:[],trigger,evolution:{id:'',kind:'implementation',acceptanceCriteria:task.checks,affectedNodes:task.writeNodes,state:'realizing'},...(trigger==='promotion'&&{promotionFacts:{currentBaseCommit:task.base.commit,manifestExact:exact,evidenceFresh:evidenceFreshNow}})};
 const evaluations=await hookRunner(env,acceptedTemplateResolver(await stub.ontologyAcceptedPackages()).templates).runSubmission(ctx);await stub.recordEvaluations(candidate.id,evaluations,'evaluated',trigger==='promotion');return evaluations;
}
export async function submitLifecycleTask(env:Env,sid:string,pid:string,tid:string,body:unknown):Promise<TaskSubmitResponse> {
 const i=parse(submitSchema,body),stub=systemStub(env,sid),f=await rpc(stub.lifecycleFence(pid,tid,i.attemptId,i.generation));await assertGenomeCompatible(env,f.plan);
 if(!(f.task.footprint.writeKnown??f.task.footprint.known))throw conflict('scope-unknown','source mappings must be known before submitting');
 const manifest=await taskManifest(env,f.plan,{realizationId:f.attempt.realizationId,repo:f.task.forkRepo,baseRepo:f.task.base.repo,baseCommit:f.task.base.commit,commit:i.commit,...(i.previewUrl&&{previewUrl:i.previewUrl})},f.task.writeNodes);
 if(!manifest.changedPaths.length)throw unprocessable('no-change','task candidate changes no files');
 // Code paths must sit in the footprint and off the protected globs; model paths (system/**) are the candidate's model delta, judged on their own.
 const outside=manifest.changedPaths.filter(path=>!isModelPath(path)&&(!inFootprint(f.task.footprint.globs,path)||TASK_PROTECTED.some(glob=>picomatch(glob,{dot:true})(path))));
 if(outside.length)throw unprocessable('scope-violation',`candidate changes outside its task binding scope: ${outside.join(', ')}`);
 // Screenshots are checked and stored before the candidate is recorded; the fence above already proved the caller holds this attempt.
 const shots=await storeScreenshots(env.EVIDENCE,sid,f.attempt.realizationId,i.commit,i.screenshots??[]);
 const record=await rpc(stub.lifecycleCandidate(pid,tid,i.attemptId,i.generation,{commit:i.commit,manifest:{...manifest,manifestHash:await manifestHash(manifest),planId:pid,taskId:tid,genomeCommit:f.plan.genome.commit},changedPaths:manifest.changedPaths,changedNodes:manifest.changedNodes}));
 if(i.previewUrl)await stub.setPreviewUrl(record.candidate.id,i.previewUrl);
 if(shots.length)await stub.setCandidateScreenshots(record.candidate.id,shots);
 const evaluations=[...await recordModelReview(env,record.plan,record.candidate,manifest),...await runCandidate(env,record.plan,record.task,record.candidate,f.task.forkRepo)];
 const state=await stub.state(),rec=await stub.realization(record.candidate.realization);if(state&&rec)await dispatchPreviewBuild(env,state,rec,record.candidate);
 await refresh(env,sid);return {plan:record.plan,task:record.task,candidate:(await stub.candidate(record.candidate.id))??record.candidate,evaluations};
}
export async function selectLifecycleTask(env:Env,sid:string,pid:string,tid:string,body:unknown):Promise<RealizationPlan> {
 const i=parse(selectSchema,body),stub=systemStub(env,sid),p=await rpc(stub.realizationPlan(pid)),task=taskOf(p,tid),last=task.attempts.at(-1);await assertGenomeCompatible(env,p);
 const plan=await rpc(stub.lifecycleSelect(pid,tid,i.candidateId));
 // The selection has landed; revoking the attempt's write token is best-effort (it also expires with the lease).
 if(last)await stub.realization(last.realizationId).then(rec=>rec?.tokenId?withRepo(artifactsFor(env),task.forkRepo,r=>r.revokeToken(rec.tokenId!)):undefined).catch(w=>console.error(`[lifecycle] revoking the write token of ${pid}/${tid} after select failed: ${(w as Error)?.message??w}`));
 await refresh(env,sid);return plan;
}

/** A file's identity for replay: content and entry kind, so a mode-only change (exec bit, symlink) is a change. */
const entryKey=(e?:TreeEntry)=>e?`${e.type}:${e.hash}`:undefined;
export interface Replay {current:Map<string,string>;edits:Map<string,FileChange>}
export const replayFrom=(original:Map<string,TreeEntry>):Replay=>({current:new Map([...original].map(([path,e])=>[path,entryKey(e)!])),edits:new Map()});
/** The model side of a replay: the pinned Genome's entries at their `system/` paths (the implicit base of every model path) and the candidate's model diff against them. */
export interface ReplayModel {pinned:Map<string,TreeEntry>;diff:TreeDiff}
/** `original` plus the pinned model, so a replay treats the pinned Genome as what every task started from. */
export const withPinnedModel=(original:Map<string,TreeEntry>,pinned:Map<string,TreeEntry>):Map<string,TreeEntry>=>new Map([...[...original].filter(([path])=>!isModelPath(path)),...pinned]);
/** The replayed edits that still differ from `original`, each with its entry kind. */
export const replayChanges=(r:Replay,original:Map<string,TreeEntry>)=>[...r.edits.values()].filter(e=>r.current.get(e.path)!==entryKey(original.get(e.path)));
/**
 * Replay one selected candidate's delta (`from` to `to` in `repo`) onto `r`. A path whose current content or kind is
 * neither the candidate's base nor its result is a divergent predecessor (`divergent`).
 */
export async function replayDelta(repo:ArtifactsRepoLike,from:string,to:string,r:Replay,check:(path:string)=>void,divergent:(path:string)=>Error,model?:ReplayModel):Promise<void> {
 const [before,after,whole]=await Promise.all([listTree(repo,from),listTree(repo,to),diffTrees(repo,from,to)]);
 // Code paths replay against the task's base; model paths (system/**) against the pinned Genome, and only when the caller carries the model.
 const code=splitDiff(whole).code,diff:TreeDiff=model?{added:[...code.added,...model.diff.added],modified:[...code.modified,...model.diff.modified],removed:[...code.removed,...model.diff.removed]}:code;
 const removed=new Set(diff.removed);
 for(const path of [...diff.added,...diff.modified,...diff.removed]) {
  if(!isModelPath(path))check(path);
  const prevEntry=isModelPath(path)?model!.pinned.get(path):before.get(path),nextEntry=after.get(path),expected=entryKey(prevEntry),next=entryKey(nextEntry),existing=r.current.get(path);
  // listTree skips gitlinks (submodules): a diff path missing on the side that should hold it is one; never replay it.
  if(removed.has(path)?!prevEntry:!nextEntry)throw conflict('integration-conflict',`${path} is not a regular file, executable or symlink; replan or revise the candidate`);
  if(existing!==expected&&existing!==next)throw divergent(path);
  if(next===existing)continue;
  if(nextEntry){const blob=await repo.readBlob(nextEntry.hash);if(!blob)throw conflict('integration-unavailable',`missing selected blob ${path}`);if(blob.size>1_000_000)throw unprocessable('integration-too-large',`changed file ${path} exceeds 1 MB integration limit`);r.edits.set(path,{path,content:new Uint8Array(await blob.arrayBuffer()),type:nextEntry.type as FileChange['type']});r.current.set(path,next!);}
  else{r.edits.set(path,{path,content:null});r.current.delete(path);}
 }
}

/** Combine exact task deltas in dependency order; mismatched predecessor content refuses integration. */
export async function integrateLifecyclePlan(env:Env,sid:string,pid:string,platformUrl:string):Promise<ImplementationReview> {
 const stub=systemStub(env,sid),p=await rpc(stub.realizationPlan(pid));await assertGenomeCompatible(env,p);
 if(p.status==='integrated')return reviewLifecyclePlan(env,sid,pid);
 if(p.status==='promoted')throw conflict('invalid-state','plan already promoted');
 if(p.tasks.some(t=>!t.selectedCandidate))throw conflict('invalid-state','select every task candidate before integration');
 const bindings:IntegratedBinding[]=[],ns=artifactsFor(env),pinned=await pinnedModelEntries(ns,p.genome);
 for(const artifactId of [...new Set(p.tasks.map(t=>t.artifactId))].sort()) {
  const base=p.baseManifest.artifacts[artifactId],ordered=topo(p).filter(t=>t.artifactId===artifactId),original=withPinnedModel(await withRepo(ns,base.repo,r=>listTree(r,base.commit)),pinned);
  const replay=replayFrom(original);
  for(const task of ordered) {
   const candidate=await stub.candidate(task.selectedCandidate!);if(!candidate)throw notFound('selected task candidate disappeared');
   const latest=(await stub.candidates({realizationId:candidate.realization}))[0];if(latest?.id!==candidate.id)throw conflict('stale-candidate','selected task candidate has been superseded');
   const model={pinned,diff:await modelTreeDiff(ns,p.genome,{repo:task.forkRepo,commit:candidate.commit})};
   await withRepo(ns,task.forkRepo,repo=>replayDelta(repo,task.base.commit,candidate.commit,replay,
    path=>{if(!inFootprint(task.footprint.globs,path))throw conflict('scope-violation',`selected candidate changes outside task ${task.id}`);},
    path=>conflict('integration-conflict',`task ${task.id} has a divergent predecessor at ${path}; replan or revise the candidate`),model));
  }
  const changes=replayChanges(replay,original);
  if(changes.reduce((n,e)=>n+(typeof e.content==='string'?new TextEncoder().encode(e.content).length:e.content?.byteLength??0),0)>8_000_000)throw unprocessable('integration-too-large','binding changes exceed 8 MB integration limit');
  if(!changes.length)throw conflict('no-change',`binding ${artifactId} has no integrated changes`);
  const forkRepo=`${base.repo}--integrate-${crypto.randomUUID().slice(0,12)}`,forked=await forkAndWait(ns,base.repo,forkRepo,{baseCommit:base.commit}),rec=await rpc(stub.lifecycleReserveIntegration(pid,artifactId,forkRepo));
  let tokenId:string|undefined;
  try {
   // The integrated commit is a whole System snapshot: the pinned model under system/, then the tasks' code and model edits on top.
   const remote=remoteUrl(env,forkRepo,forked.remote),seeded=await seedModel(ns,forkRepo,base.commit,p.genome,{overwrite:true,remote});
   const token=await withRepo(ns,forkRepo,r=>r.createToken('write',300));tokenId=token.id;
   const pushed=await withRepo(ns,forkRepo,r=>pushCommit({repo:r,remote,token:token.plaintext,parent:seeded,changes,...gitTransport(),author:{name:'Artyfact',email:'platform@artyfact.local'},message:`Integrate ${p.title}`}));
   const manifest=await taskManifest(env,p,{realizationId:rec.realization.id,repo:forkRepo,baseRepo:base.repo,baseCommit:base.commit,commit:pushed.commit},[...new Set(ordered.flatMap(t=>t.writeNodes))]);
   const result=await rpc(stub.recordCandidate({realizationId:rec.realization.id,commit:pushed.commit,manifest:{...manifest,manifestHash:await manifestHash(manifest),planId:pid,artifactId,genomeCommit:p.genome.commit,taskCandidates:ordered.map(t=>t.selectedCandidate)},changedPaths:manifest.changedPaths,changedNodes:manifest.changedNodes}));
   const combined={checks:[...new Set(ordered.flatMap(t=>t.checks))],writeNodes:[...new Set(ordered.flatMap(t=>t.writeNodes))],footprint:{repo:base.repo,artifactId,globs:[...new Set(ordered.flatMap(t=>t.footprint.globs))],paths:manifest.changedPaths,unmatched:[],known:true},base};
   await recordModelReview(env,p,result.candidate,manifest);await runCandidate(env,p,combined,result.candidate,forkRepo);
   const state=await stub.state();if(state)await dispatchPreviewBuild(env,state,rec,result.candidate);
   bindings.push({artifactId,source:{repo:forkRepo,commit:pushed.commit},candidateId:result.candidate.id,taskCandidates:ordered.map(t=>t.selectedCandidate!),realizedGenome:p.genome.commit,...(manifest.model&&{model:manifest.model})});
  }finally{if(tokenId)await withRepo(ns,forkRepo,r=>r.revokeToken(tokenId!));}
 }
 await rpc(stub.lifecycleIntegrate(pid,bindings,p.tasks.map(t=>t.selectedCandidate!)));await refresh(env,sid);
 void platformUrl;
 return reviewLifecyclePlan(env,sid,pid);
}
export async function reviewLifecyclePlan(env:Env,sid:string,pid:string):Promise<ImplementationReview> {
 const stub=systemStub(env,sid),p=await rpc(stub.realizationPlan(pid)),state=await stub.state(),g=await genomeAt(env,sid,p.genome.commit,p.genome.repo),evaluations:Evaluation[]=[],candidates:Candidate[]=[],blockers:string[]=[];
 if(p.status!=='integrated')blockers.push('Integrate all selected tasks before promotion.');
 const withModel=p.integration.filter(b=>b.model);if(withModel.length>1)blockers.push('Several integrated bindings change the model; only one Genome can be accepted per promotion.');
 const modelDelta=withModel[0]?{source:withModel[0].source,model:withModel[0].model!}:undefined;if(modelDelta?.model.loadError)blockers.push(`The integrated model does not load: ${modelDelta.model.loadError}`);
 try{await assertGenomeCompatible(env,p);}catch(e){blockers.push((e as Error).message);}
 for(const binding of p.integration) {
  const candidate=await stub.candidate(binding.candidateId);if(candidate)candidates.push(candidate);else blockers.push(`Integrated candidate ${binding.candidateId} is missing.`);
  const base=p.baseManifest.artifacts[binding.artifactId],now=state?.manifest?.artifacts[binding.artifactId];
  if(now?.repo!==base.repo||now.commit!==base.commit)blockers.push(`Binding ${binding.artifactId} changed; replan required.`);
  const tasks=p.tasks.filter(t=>t.artifactId===binding.artifactId),checks=[...new Set(tasks.flatMap(t=>t.checks))],es=await stub.evaluations(binding.candidateId);evaluations.push(...es);
  for(const gate of gateCriteria(g.model,{acceptanceCriteria:checks},{target:'app'}))if(gate.blocking) {
   const criterion=g.model.criteria.find(c=>c.id===gate.id);
   if(criterion&&hooksOf(g.model,criterion).some(h=>/base-current|manifest-exact|evidence-fresh/.test(h.inputs.check??'')))continue;
   // As the promotion gate (SystemAuthority.gateItems): not-run rows of hooks that never run before promotion are disregarded; any other row must pass.
   const off=new Set(gate.offTriggerHooks??[]),rows=es.filter(e=>e.criterion===gate.id&&!(e.execution==='not-run'&&off.has(e.hook)));if(!rows.length||rows.some(e=>e.execution!=='completed'||e.verdict!=='pass'))blockers.push(`Integrated ${binding.artifactId}: ${gate.id} is not passing.`);
  }
 }
 return {plan:p,bindings:p.integration,candidates,evaluations,ready:blockers.length===0,blockers,expectedHead:state?.head??null,layers:evidenceLayers(g.model,evaluations),...(modelDelta&&{modelDelta})};
}
export async function promoteLifecyclePlan(env:Env,sid:string,pid:string,body:unknown):Promise<PlanPromoteResponse> {
 const input=parse(promoteSchema,body),stub=systemStub(env,sid),p=await rpc(stub.realizationPlan(pid));await assertGenomeCompatible(env,p);
 const g=await genomeAt(env,sid,p.genome.commit,p.genome.repo),gates:Record<string,ReturnType<typeof gateCriteria>>={};
 for(const b of p.integration) {
  const c=await stub.candidate(b.candidateId),manifest=await stub.candidateManifest(b.candidateId);if(!c||!manifest)throw conflict('gate-unavailable','integrated candidate missing');
  const tasks=p.tasks.filter(t=>t.artifactId===b.artifactId),combined={checks:[...new Set(tasks.flatMap(t=>t.checks))],writeNodes:[...new Set(tasks.flatMap(t=>t.writeNodes))],footprint:{repo:p.baseManifest.artifacts[b.artifactId].repo,artifactId:b.artifactId,globs:[...new Set(tasks.flatMap(t=>t.footprint.globs))],paths:c.changedPaths,unmatched:[],known:true},base:p.baseManifest.artifacts[b.artifactId]};
  const exact=await manifestHash(await taskManifest(env,p,{realizationId:c.realization,repo:b.source.repo,baseRepo:combined.base.repo,baseCommit:combined.base.commit,commit:c.commit},combined.writeNodes))===manifest.manifestHash;
  if(!exact)throw conflict('stale-candidate','integrated candidate no longer matches exact reviewed evidence');
  // The integrated system/ is re-read and re-parsed by the canonical loader now, never trusted from the stored delta: what loads here is what becomes the Genome.
  if(b.model){try{await genomeAt(env,sid,b.source.commit,b.source.repo);}catch(e){throw conflict('model-delta-invalid',`the integrated model does not load: ${(e as Error)?.message??e}`);}}
  await runCandidate(env,p,combined,c,b.source.repo,'promotion',exact);gates[c.id]=gateCriteria(g.model,{acceptanceCriteria:combined.checks},{target:'app'});
 }
 // An integrated model delta moves the accepted Genome to the integrated commit (its system/), once the reviewer accepts it.
 const withModel=p.integration.filter(b=>b.model);if(withModel.length>1)throw conflict('model-delta-ambiguous','several integrated bindings change the model; replan so one binding carries the model change');
 if(withModel.length&&withModel[0].model!.loadError)throw conflict('model-delta-invalid',`the integrated model does not load: ${withModel[0].model!.loadError}`);
 if(withModel.length&&input.acceptModelDelta!==true)throw conflict('model-delta-unreviewed','the integrated implementation changes the model; review the model delta and promote with acceptModelDelta: true');
 const genome=withModel.length?{repo:withModel[0].source.repo,commit:withModel[0].source.commit}:undefined;
 const out=await rpc(stub.lifecyclePromote(pid,{expectedHead:input.expectedHead,rationale:input.rationale,candidateIds:input.candidateIds,gates,by:'admin',...(genome&&{genome})}));if(!out.ok)throw gateRefusal(out);const result=out;await revokeEnded(env,sid,result.ended);await refresh(env,sid);return {plan:result.plan,commit:result.commit};
}


async function prepareFanInBase(env:Env,p:RealizationPlan,t:Task):Promise<{source:ArtifactBinding;selections:string[]}|undefined> {
 const same=t.dependsOn.map(id=>taskOf(p,id)).filter(d=>d.artifactId===t.artifactId);
 const ancestor=(a:string,b:Task):boolean=>b.dependsOn.includes(a)||b.dependsOn.some(id=>ancestor(a,taskOf(p,id)));
 const maximal=same.filter(a=>!same.some(b=>a!==b&&ancestor(a.id,b)));
 if(maximal.length<2)return;
 if(maximal.some(a=>!a.selectedCandidate))return;
 const selectedTasks=topo(p).filter(a=>a.artifactId===t.artifactId&&maximal.some(b=>a.id===b.id||ancestor(a.id,b)));
 const base=p.baseManifest.artifacts[t.artifactId],ns=artifactsFor(env),pinned=await pinnedModelEntries(ns,p.genome),original=withPinnedModel(await withRepo(ns,base.repo,r=>listTree(r,base.commit)),pinned),replay=replayFrom(original);
 for(const predecessor of selectedTasks) {
  if(!predecessor.selectedCandidate)throw conflict('invalid-state','fan-in ancestor has no selected candidate');
  const candidate=await systemStub(env,p.systemId).candidate(predecessor.selectedCandidate);if(!candidate)throw conflict('invalid-state','fan-in candidate unavailable');
  const model={pinned,diff:await modelTreeDiff(ns,p.genome,{repo:predecessor.forkRepo,commit:candidate.commit})};
  await withRepo(ns,predecessor.forkRepo,repo=>replayDelta(repo,predecessor.base.commit,candidate.commit,replay,()=>{},path=>conflict('integration-conflict',`fan-in predecessor conflicts at ${path}`),model));
 }
 const changes=replayChanges(replay,original);
 if(!changes.length)return {source:base,selections:p.tasks.map(t=>t.selectedCandidate??'')};
 // The combined base is a whole snapshot too: the pinned model first, then the predecessors' code and model edits.
 const forkRepo=`${base.repo}--fan-in-${crypto.randomUUID().slice(0,12)}`,forked=await forkAndWait(ns,base.repo,forkRepo,{baseCommit:base.commit}),remote=remoteUrl(env,forkRepo,forked.remote),seeded=await seedModel(ns,forkRepo,base.commit,p.genome,{overwrite:true,remote}),token=await withRepo(ns,forkRepo,r=>r.createToken('write',300));
 try{const result=await withRepo(ns,forkRepo,r=>pushCommit({repo:r,remote,token:token.plaintext,parent:seeded,changes,...gitTransport(),author:{name:'Artyfact',email:'platform@artyfact.local'},message:`Combine predecessors for ${t.title}`}));return {source:{repo:forkRepo,commit:result.commit},selections:p.tasks.map(t=>t.selectedCandidate??'')};}finally{await withRepo(ns,forkRepo,r=>r.revokeToken(token.id));}
}

export async function reviewLifecycleFile(env:Env,sid:string,pid:string,artifactId:string,path:string){
 const stub=systemStub(env,sid),p=await rpc(stub.realizationPlan(pid)),binding=p.integration.find(b=>b.artifactId===artifactId);if(!binding)throw notFound('unknown integrated artifact binding');
 const candidate=await stub.candidate(binding.candidateId);if(!candidate?.changedPaths.includes(path))throw badRequest('path must be a changed file of this exact integrated candidate');
 const base=p.baseManifest.artifacts[artifactId],{from,fromPath}=await compareFrom(artifactsFor(env),p.genome,{ref:p.baseHead??p.id,repo:base.repo,commit:base.commit},path);return compareExplicitFile(env,from,{ref:binding.candidateId,repo:binding.source.repo,commit:binding.source.commit},path,fromPath);
}

/** Trusted build reports refresh only evidence for an existing exact immutable task/integration candidate. */
export async function refreshLifecycleCandidate(env:Env,sid:string,rid:string,commit:string,previewUrl?:string):Promise<import('../shared/api').SubmitResponse>{
 const stub=systemStub(env,sid),pid=await stub.realizationPlanId(rid);if(!pid)throw notFound('realization plan missing');
 const p=await rpc(stub.realizationPlan(pid)),rec=await stub.realization(rid),candidate=(await stub.candidates({realizationId:rid})).find(c=>c.commit===commit);if(!rec||!candidate)throw conflict('invalid-state','Task Attempts must submit their exact candidate before reporting a preview');
 if(!['submitted','evaluated','selected'].includes(candidate.state))throw conflict('invalid-state','candidate is no longer open');
 if(previewUrl)await stub.setPreviewUrl(candidate.id,previewUrl);
 const attemptTask=p.tasks.find(t=>t.attempts.some(a=>a.realizationId===rid));
 const bindingId=await stub.realizationBindingId(rid);if(!bindingId)throw conflict('invalid-state','task artifact binding missing');
 const tasks=p.tasks.filter(t=>t.artifactId===bindingId),task=attemptTask??{checks:[...new Set(tasks.flatMap(t=>t.checks))],writeNodes:[...new Set(tasks.flatMap(t=>t.writeNodes))],footprint:{repo:p.baseManifest.artifacts[bindingId].repo,artifactId:bindingId,globs:[...new Set(tasks.flatMap(t=>t.footprint.globs))],paths:candidate.changedPaths,unmatched:[],known:true},base:p.baseManifest.artifacts[bindingId]};
 const evaluations=await runCandidate(env,p,task,candidate,rec.forkRepo);return {created:false,realization:rec.realization,candidate,evaluations,conflicts:[]};
}
