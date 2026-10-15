import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ImplementationReview, RealizationPlan, TaskStartResponse, TaskSubmitResponse } from '../shared/lifecycle';
import type { VerificationResult } from '@artyfact/model';
import { ADMIN, call, importFresh, passing } from './helpers/flows';
import { walkTree } from '../worker/artifacts/genome-source';
import { setArtifactsOverride } from '../worker/artifacts/client';
import { setEditorTransport } from '../worker/editor';
import { resetHooks, setHooks } from '../worker/hooks';
import { fakeReceivePack } from './helpers/fake-receive-pack';
import { systemStub } from '../worker/service';
beforeEach(()=>setHooks({runner:()=>passing}));
afterEach(()=>{resetHooks();setArtifactsOverride(undefined);setEditorTransport(undefined);vi.restoreAllMocks();});
async function integrated() {
 const f=await importFresh();setEditorTransport({fetch:fakeReceivePack(f.ns).fetch});
 const base=`/systems/${f.systemId}/realization-plans`;
 const made=await call<RealizationPlan>('POST',base,{title:'Cloud check',tasks:[{id:'ui',title:'UI',artifactId:'artifact.webapp',steps:['Update'],dependsOn:[],readNodes:[],writeNodes:['screen.people'],checks:['C.people.list']}]},ADMIN);
 const p=made.json,root=`${base}/${p.id}`;
 const claim=await call<TaskStartResponse>('POST',`${root}/tasks/ui/claim`,{},ADMIN),a=claim.json;
 const repo=f.ns.repo(a.task.forkRepo),files=await walkTree(repo,a.task.base.commit);files.set('src/ui/people/index.html','<h1>Verified</h1>');
 const submit=await call<TaskSubmitResponse>('POST',`${root}/tasks/ui/submit`,{attemptId:a.attempt.id,generation:a.attempt.generation,commit:repo.commit(files,'change')},{authorization:`Bearer ${a.secret}`});
 await call('POST',`${root}/tasks/ui/select`,{candidateId:submit.json.candidate.id},ADMIN);
 const review=await call<ImplementationReview>('POST',`${root}/integrate`,{},ADMIN);expect(review.status).toBe(200);
 return {f,p,root,review:review.json};
}
it('requires admin for verification and activation, with no client evidence import route',async()=>{
 const {root}=await integrated();
 for(const [method,path] of [['POST','verification/start'],['POST','verification/poll'],['GET','activation?artifactId=artifact.webapp'],['GET','verification/output?artifactId=artifact.webapp']]) {
  expect((await call(method,`${root}/${path}`,method==='POST'?{artifactId:'artifact.webapp'}:undefined)).status).toBe(401);
 }
 expect((await call('POST',`${root}/verification/result`,{status:'passed'},ADMIN)).status).toBe(404);
 expect((await call('GET',`${root}/activation?artifactId=artifact.webapp`,undefined,ADMIN)).status).toBe(409);
});
it('polls only the configured verifier and refuses identity substitution before promotion',async()=>{
 const {f,p,root,review}=await integrated();
 const { startVerification, pollVerification, activationDescriptor }=await import('../worker/verification');
 const configured={...env,VERIFICATION_URL:'https://verify.example.test',VERIFICATION_TOKEN:'private-test-token'};
 let result:VerificationResult;
 const transport=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  expect(String(input)).toMatch(/^https:\/\/verify.example.test\/verify/);expect(new Headers(init?.headers).get('authorization')).toBe('Bearer private-test-token');
  if(init?.method==='POST'){const request=JSON.parse(String(init.body));result={version:1,request,status:'queued',steps:[]};}
  return Response.json(result);
 }) as unknown as typeof fetch;
 await startVerification(configured,f.systemId,p.id,{artifactId:'artifact.webapp'},transport);
 const original=result!;
 result={...original,status:'passed',request:{...original.request,source:{...original.request.source,commit:'a'.repeat(40)}},steps:[{name:'verify',command:'npm run ci -- --ultra-compact',status:'passed'}],finishedAt:new Date().toISOString(),output:{key:`verification/v1/${original.request.id}/output.tar.gz`,digest:'b'.repeat(64),size:10}};
 await expect(pollVerification(configured,f.systemId,p.id,{artifactId:'artifact.webapp'},transport)).rejects.toThrow(/identity/);
 expect((await systemStub(env,f.systemId).verification(p.id,'artifact.webapp'))!.status).toBe('queued');
 result={...result,request:original.request};
 await pollVerification(configured,f.systemId,p.id,{artifactId:'artifact.webapp'},transport);
 const promoted=await call('POST',`${root}/promote`,{expectedHead:review.expectedHead,candidateIds:review.bindings.map(b=>b.candidateId),rationale:'Human approval'},ADMIN);expect(promoted.status,JSON.stringify(promoted.json)).toBe(200);
 const activation=await activationDescriptor(configured,f.systemId,p.id,'artifact.webapp');
 expect(activation.source).toEqual(original.request.source);expect(activation.genome).toEqual(original.request.genome);expect(activation.systemCommit).toBe((await systemStub(env,f.systemId).state())!.head);
});

it('refreshes immediate and cached success, recovering an interrupted evidence update',async()=>{
 const {f,p}=await integrated();
 const {startVerification,pollVerification}=await import('../worker/verification');
 const configured={...env,VERIFICATION_URL:'https://verify.example.test',VERIFICATION_TOKEN:'private-test-token'};
 const run=vi.fn(passing.runSubmission);setHooks({runner:()=>({...passing,runSubmission:run})});
 const transport=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{const request=JSON.parse(String(init?.body));return Response.json({version:1,request,status:'passed',steps:[{name:'verify',command:'npm run ci -- --ultra-compact',status:'passed'}],finishedAt:new Date().toISOString(),output:{key:`verification/v1/${request.id}/output.tar.gz`,digest:'b'.repeat(64),size:10}});}) as unknown as typeof fetch;
 run.mockRejectedValueOnce(new Error('interrupted evidence update'));
 await expect(startVerification(configured,f.systemId,p.id,{artifactId:'artifact.webapp'},transport)).rejects.toThrow('interrupted');
 expect((await systemStub(env,f.systemId).verification(p.id,'artifact.webapp'))!.status).toBe('passed');
 await pollVerification(configured,f.systemId,p.id,{artifactId:'artifact.webapp'},transport);
 expect(run).toHaveBeenCalledTimes(2);expect(transport).toHaveBeenCalledTimes(1);
 await startVerification(configured,f.systemId,p.id,{artifactId:'artifact.webapp'},transport);
 expect(run).toHaveBeenCalledTimes(3);expect(transport).toHaveBeenCalledTimes(1);
});
