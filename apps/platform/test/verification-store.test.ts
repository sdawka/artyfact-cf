import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { SystemAuthority } from '../worker/do/system-authority';
import type { VerificationRequest, VerificationResult } from '@artyfact/model';
const G='1'.repeat(40), A='a'.repeat(40), C='b'.repeat(40);
async function setup(i:SystemAuthority) {
 await i.bootstrap({systemId:'system.artyfact',title:'Self',genomeRepo:'model',appRepo:'app',genomeCommit:G,appCommit:A,artifactId:'web',templateVersions:{},hookVersions:{},platform:null,evolutions:[]});
 const p=i.createRealizationPlan({title:'Self change',tasks:[{id:'task',title:'Task',artifactId:'web',steps:['Change'],dependsOn:[],readNodes:[],writeNodes:['thing'],checks:[],footprint:{repo:'app',artifactId:'web',globs:['**'],paths:['index.ts'],unmatched:[],known:true}}]});
 const a=i.claimLifecycleTask(p.id,'task',{}), c=i.recordCandidate({realizationId:a.attempt.realizationId,commit:C,manifest:{},changedPaths:['index.ts'],changedNodes:['thing']}).candidate;
 i.lifecycleSelect(p.id,'task',c.id);i.lifecycleIntegrate(p.id,[{artifactId:'web',source:{repo:a.task.forkRepo,commit:C},candidateId:c.id,taskCandidates:[c.id],realizedGenome:G}],[c.id]);
 const request:VerificationResult['request']={version:1,id:'verify-one',systemId:'system.artyfact',planId:p.id,artifactId:'web',candidateId:c.id,source:{repo:a.task.forkRepo,commit:C},genome:{repo:'model',commit:G,prefix:'',digest:'a'.repeat(64)},profile:'artyfact-self-v1',checks:[]};
 return {p,request};
}
const passed=(request:VerificationResult['request']):VerificationResult=>({version:1,request,status:'passed',steps:[{name:'verify',command:'npm run ci -- --ultra-compact',status:'passed'}],startedAt:'2026-10-14T00:00:00Z',finishedAt:'2026-10-14T00:01:00Z',output:{key:`verification/v1/${request.id}/output.tar.gz`,digest:'b'.repeat(64),size:100}});
describe('verification evidence at the authority boundary',()=>{
 it('rejects missing, failed and wrong-source results; stores one exact terminal result',async()=>{
  await runInDurableObject(env.SYSTEMS.getByName(crypto.randomUUID()),async(i:SystemAuthority)=>{
   const {p,request}=await setup(i);
   expect(()=>i.assertPlanVerified(p.id)).toThrow(/verification/);
   expect(()=>i.reserveVerification({...request,source:{...request.source,commit:A}})).toThrow(/source/);
   i.reserveVerification(request);
   expect(()=>i.recordVerification({...passed(request),request:{...request,candidateId:'other'}})).toThrow(/identity/);
   for(const output of [{key:'verification/v1/other/output.tar.gz',digest:'b'.repeat(64),size:100},{key:`verification/v1/${request.id}/output.tar.gz`,digest:'B'.repeat(64),size:100},{key:`verification/v1/${request.id}/output.tar.gz`,digest:'b'.repeat(64),size:0},{key:`verification/v1/${request.id}/output.tar.gz`,digest:'b'.repeat(64),size:17*1024*1024}])
    expect(()=>i.recordVerification({...passed(request),output})).toThrow(/bounded, digest-bound archive/);
   i.recordVerification({...passed(request),status:'failed',output:undefined});
   expect(()=>i.assertPlanVerified(p.id)).toThrow(/verification/);
   expect(()=>i.recordVerification(passed(request))).toThrow(/terminal/);
   const retry={...request,id:'verify-two'};i.reserveVerification(retry,true);i.recordVerification(passed(retry));
   expect(i.assertPlanVerified(p.id)[0].request.id).toBe('verify-two');
   expect(()=>i.reserveVerification({...request,id:'verify-three'},true)).toThrow(/passed/);
  });
 });
 it('requires immutable cloud verification inside the promotion transaction',async()=>{
  await runInDurableObject(env.SYSTEMS.getByName(crypto.randomUUID()),async(i:SystemAuthority)=>{
   const {p,request}=await setup(i),head=i.state()!.head;
   const input={candidateIds:[request.candidateId],expectedHead:head,rationale:'Human reviewed',gates:{[request.candidateId]:[{id:'C.test',blocking:true,severity:'hard' as const}]},by:'admin'};
   await expect(i.lifecyclePromote(p.id,input)).rejects.toThrow(/verification/);
   expect(i.state()!.head).toBe(head);
   i.reserveVerification(request);i.recordVerification(passed(request));
   i.recordEvaluations(request.candidateId,[{id:'eval',candidate:request.candidateId,criterion:'C.test',hook:'test',ownerId:'thing',subjectId:'thing',targetRef:C,execution:'completed',verdict:'pass',verifier:'test',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),observations:[],limitations:[],provenance:{}}]);
   const out=await i.lifecyclePromote(p.id,input);expect(out.ok).toBe(true);
   expect(i.verification(p.id,'web')?.status).toBe('passed');
   expect(()=>i.reserveVerification({...request,id:'late'},true)).toThrow(/integrated/);
  });
 });
});
