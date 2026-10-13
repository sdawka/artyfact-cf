import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { SystemAuthority } from '../worker/do/system-authority';
const G='1'.repeat(40), A='a'.repeat(40);
const task=(id:string, deps:string[]=[])=>({id,title:id,artifactId:'web',steps:['implement'],dependsOn:deps,readNodes:[],writeNodes:[id],checks:[],footprint:{repo:'web-repo',artifactId:'web',globs:[`${id}/**`],paths:[`${id}/file.ts`],unmatched:[],known:true}});
const boot={systemId:'system.life',title:'Life',genomeRepo:'genome',appRepo:'web-repo',genomeCommit:G,appCommit:A,artifactId:'web',templateVersions:{},hookVersions:{},platform:null,evolutions:[]};
describe('pinned realization authority',()=>{
 it('pins accepted Genome, creates no Evolution, fences expired retry and retains one task fork',async()=>{
  await runInDurableObject(env.SYSTEMS.getByName(crypto.randomUUID()),async(i:SystemAuthority,state)=>{
   await i.bootstrap(boot);
   const plan=i.createRealizationPlan({title:'Implement',tasks:[task('a')]});
   expect(plan.genome.commit).toBe(G); expect(i.evolutions()).toEqual([]);
   const first=i.claimLifecycleTask(plan.id,'a',{agentLabel:'local',leaseSeconds:30});
   expect(()=>i.claimLifecycleTask(plan.id,'a',{})).toThrow(/active writer/);
   const saved=JSON.parse(String(state.storage.sql.exec('SELECT json FROM realization_plans WHERE id = ?',plan.id).one().json)); saved.tasks[0].attempts[0].leaseExpiresAt='2000-01-01T00:00:00.000Z'; state.storage.sql.exec('UPDATE realization_plans SET json = ? WHERE id = ?',JSON.stringify(saved),plan.id);
   const second=i.claimLifecycleTask(plan.id,'a',{});
   expect(second.task.forkRepo).toBe(first.task.forkRepo);
   expect(second.attempt.generation).toBe(2);
   expect(()=>i.lifecycleFence(plan.id,'a',first.attempt.id,1)).toThrow(/fenced/);
  });
 });
 it('blocks downstream claim until predecessor selected and uses selected source base',async()=>{
  await runInDurableObject(env.SYSTEMS.getByName(crypto.randomUUID()),async(i:SystemAuthority)=>{
   await i.bootstrap(boot);
   const plan=i.createRealizationPlan({title:'Implement',tasks:[task('a'),task('b',['a'])]});
   expect(()=>i.claimLifecycleTask(plan.id,'b',{})).toThrow(/dependency/);
   const claim=i.claimLifecycleTask(plan.id,'a',{});
   const c=i.recordCandidate({realizationId:claim.attempt.realizationId,commit:'b'.repeat(40),manifest:{},changedPaths:['a/file.ts'],changedNodes:['a']}).candidate;
   i.lifecycleSelect(plan.id,'a',c.id);
   const next=i.claimLifecycleTask(plan.id,'b',{});
   expect(next.task.base).toEqual({repo:claim.task.forkRepo,commit:c.commit});
  });
 });
 it('unknown scope prevents simultaneous launch',async()=>{
  await runInDurableObject(env.SYSTEMS.getByName(crypto.randomUUID()),async(i:SystemAuthority)=>{
   await i.bootstrap(boot);
   const a=task('a'); a.footprint.known=false;
   const p=i.createRealizationPlan({title:'Implement',tasks:[a,task('b')]});
   i.claimLifecycleTask(p.id,'a',{});
   expect(()=>i.claimLifecycleTask(p.id,'b',{})).toThrow(/interference/);
  });
 });
 it('refuses a concurrent finalization that would replace the integrated review',async()=>{
  await runInDurableObject(env.SYSTEMS.getByName(crypto.randomUUID()),async(i:SystemAuthority)=>{
   await i.bootstrap(boot);const p=i.createRealizationPlan({title:'Build',tasks:[task('a')]}),a=i.claimLifecycleTask(p.id,'a',{}),c=i.recordCandidate({realizationId:a.attempt.realizationId,commit:'b'.repeat(40),manifest:{},changedPaths:['a/file.ts'],changedNodes:['a']}).candidate;i.lifecycleSelect(p.id,'a',c.id);
   const binding={artifactId:'web',source:{repo:a.task.forkRepo,commit:c.commit},candidateId:c.id,taskCandidates:[c.id],realizedGenome:G};i.lifecycleIntegrate(p.id,[binding],[c.id]);
   expect(()=>i.lifecycleIntegrate(p.id,[{...binding,candidateId:'new'}],[c.id])).toThrow(/already integrated/);expect(i.realizationPlan(p.id).integration[0].candidateId).toBe(c.id);
  });
 });

});
