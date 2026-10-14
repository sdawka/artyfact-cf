import { runInDurableObject } from 'cloudflare:test';
import { REGISTRY, type SystemAuthority } from '../worker/do/system-authority';
import { replayChanges, replayDelta, replayFrom } from '../worker/lifecycle-service';
import { FakeArtifacts } from './helpers/fake-artifacts';
import type { TreeEntry } from '../worker/artifacts/client';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lifecyclePaths, type RealizationPlan, type TaskStartResponse, type TaskSubmitResponse, type ImplementationReview, type PlanPromoteResponse } from '../shared/lifecycle';
import { setArtifactsOverride } from '../worker/artifacts/client';
import { resetHooks, setHooks } from '../worker/hooks';
import { systemStub } from '../worker/service';
import { ADMIN, call, importFresh, passing } from './helpers/flows';
import { walkTree } from '../worker/artifacts/genome-source';
import { fakeReceivePack } from './helpers/fake-receive-pack';
import { setEditorTransport } from '../worker/editor';
import { listTree } from '../worker/artifacts/genome-source';
import { pushCommit, type FileChange } from '../worker/git/push';
const path=(s:string,p?:string,t?:string,a?:'claim'|'resume'|'submit'|'select')=>(a?lifecyclePaths.action(s,p!,t!,a):p?lifecyclePaths.plan(s,p):lifecyclePaths.plans(s)).replace(/^\/api/,'');
const definition={id:'ui',title:'People UI',artifactId:'artifact.webapp',steps:['Update people UI'],dependsOn:[],readNodes:[],writeNodes:['screen.people'],checks:['C.people.list']};
beforeEach(()=>setHooks({runner:()=>passing}));
afterEach(()=>{resetHooks();setArtifactsOverride(undefined);setEditorTransport(undefined);});
describe('realization plan HTTP lifecycle',()=>{
 it('requires admin plan creation and preserves Genome through one final implementation promotion',async()=>{
  const f=await importFresh();setEditorTransport({fetch:fakeReceivePack(f.ns).fetch});
  expect((await call('POST',path(f.systemId),{title:'Build',tasks:[definition]})).status).toBe(401);
  const created=await call<RealizationPlan>('POST',path(f.systemId),{title:'Build',tasks:[definition]},ADMIN);expect(created.status,JSON.stringify(created.json)).toBe(201);const p=created.json;
  const count=(await systemStub(env,f.systemId).evolutions()).length;
  const start=await call<TaskStartResponse>('POST',path(f.systemId,p.id,'ui','claim'),{},ADMIN);expect(start.status,JSON.stringify(start.json)).toBe(201);const s=start.json;expect(s.packet.reviewUrl).toBe(s.reviewUrl);expect(s.reviewUrl).toBe(`http://example.com/s/${f.systemId}/r/head/review?plan=${encodeURIComponent(p.id)}&task=ui`);
  const repo=f.ns.repo(s.task.forkRepo),files=await walkTree(repo,s.task.base.commit);files.set('src/ui/people/index.html','<h1>People</h1>');const commit=repo.commit(files,'UI');
  const sub=await call<TaskSubmitResponse>('POST',path(f.systemId,p.id,'ui','submit'),{attemptId:s.attempt.id,generation:s.attempt.generation,commit},{authorization:`Bearer ${s.secret}`});expect(sub.status,JSON.stringify(sub.json)).toBe(201);
  const taskReview=await call<{candidates:{candidate:typeof sub.json.candidate;manifest:{commit:string};evaluations:unknown[]}[]}>('GET',`${path(f.systemId,p.id)}/tasks/ui/review`,undefined,{});
  expect(taskReview.status).toBe(200);expect(taskReview.json.candidates[0].candidate.id).toBe(sub.json.candidate.id);expect(taskReview.json.candidates[0].manifest.commit).toBe(commit);expect(taskReview.json.candidates[0].evaluations.length).toBeGreaterThan(0);
  const taskFile=`${path(f.systemId,p.id)}/tasks/ui/review/files?candidateId=${encodeURIComponent(sub.json.candidate.id)}&path=src%2Fui%2Fpeople%2Findex.html`;
  expect((await call('GET',taskFile,undefined,{})).status).toBe(200);
  expect((await call('GET',taskFile.replace('ui/review','wrong/review'),undefined,{})).status).toBe(404);
  expect((await call('GET',taskFile.replace(encodeURIComponent(sub.json.candidate.id),'wrong-candidate'),undefined,{})).status).toBe(404);
  expect((await call('GET',taskFile.replace('src%2Fui%2Fpeople%2Findex.html','src%2Findex.ts'),undefined,{})).status).toBe(400);
  const selected=await call<RealizationPlan>('POST',path(f.systemId,p.id,'ui','select'),{candidateId:sub.json.candidate.id},ADMIN);expect(selected.status,JSON.stringify(selected.json)).toBe(200);
  const integrated=await call<ImplementationReview>('POST',lifecyclePaths.integrate(f.systemId,p.id).replace(/^\/api/,''),{},ADMIN);expect(integrated.status,JSON.stringify(integrated.json)).toBe(200);expect(integrated.json.bindings).toHaveLength(1);
  const review=integrated.json;
  // Reads follow the System's visibility like /work: no token needed.
  for(const read of [path(f.systemId),path(f.systemId,p.id),lifecyclePaths.review(f.systemId,p.id).replace(/^\/api/,'')]){const r=await call('GET',read,undefined,{});expect(r.status,read).toBe(200);}
  const compared=await call<{from:{repo:string};to:{text:string}}>('GET',lifecyclePaths.reviewFile(f.systemId,p.id,'artifact.webapp','src/ui/people/index.html').replace(/^\/api/,''),undefined,{});expect(compared.status).toBe(200);expect(compared.json.from.repo).toBe(f.appRepo);expect(compared.json.to.text).toBe('<h1>People</h1>');
  const promoted=await call<PlanPromoteResponse>('POST',lifecyclePaths.promote(f.systemId,p.id).replace(/^\/api/,''),{expectedHead:review.expectedHead,rationale:'Reviewed',candidateIds:review.bindings.map(b=>b.candidateId)},ADMIN);expect(promoted.status,JSON.stringify(promoted.json)).toBe(200);
  const state=await systemStub(env,f.systemId).state();expect(state!.genomeCommit).toBe(p.genome.commit);expect(state!.manifest!.artifacts['artifact.webapp'].realizedGenome).toBe(p.genome.commit);expect((await systemStub(env,f.systemId).evolutions()).length).toBe(count);
 });
 it('refuses another Task’s valid candidate and a mismatched pinned review manifest',async()=>{
  const f=await importFresh();
  const submit=async(tid:string)=>{
   const p=(await call<RealizationPlan>('POST',path(f.systemId),{title:tid,tasks:[{...definition,id:tid}]},ADMIN)).json;
   const start=(await call<TaskStartResponse>('POST',path(f.systemId,p.id,tid,'claim'),{},ADMIN)).json;
   const repo=f.ns.repo(start.task.forkRepo),files=await walkTree(repo,start.task.base.commit);files.set('src/ui/people/index.html',tid);
   const res=await call<TaskSubmitResponse>('POST',path(f.systemId,p.id,tid,'submit'),{attemptId:start.attempt.id,generation:start.attempt.generation,commit:repo.commit(files,tid)},{authorization:`Bearer ${start.secret}`});expect(res.status).toBe(201);
   return {p,candidate:res.json.candidate};
  };
  const one=await submit('one'),two=await submit('two');
  const scoped=lifecyclePaths.taskReviewFile(f.systemId,one.p.id,'one',two.candidate.id,'src/ui/people/index.html').replace(/^\/api/,'');
  expect((await call('GET',scoped,undefined,{})).status).toBe(404);
  await runInDurableObject(env.SYSTEMS.getByName(f.systemId),async(_i:SystemAuthority,state)=>{
   const sql=state.storage.sql,raw=sql.exec('SELECT manifest_json FROM candidates WHERE id = ?',one.candidate.id).toArray()[0];
   const manifest=JSON.parse(String(raw.manifest_json));manifest.baseCommit='0'.repeat(40);
   sql.exec('UPDATE candidates SET manifest_json=? WHERE id=?',JSON.stringify(manifest),one.candidate.id);
  });
  expect((await call('GET',lifecyclePaths.taskReview(f.systemId,one.p.id,'one').replace(/^\/api/,''),undefined,{})).status).toBe(409);
 });
 it('resume rotates platform and Git credentials and denies the old attempt',async()=>{
  const f=await importFresh(),p=(await call<RealizationPlan>('POST',path(f.systemId),{title:'Build',tasks:[definition]},ADMIN)).json;
  const one=(await call<TaskStartResponse>('POST',path(f.systemId,p.id,'ui','claim'),{},ADMIN)).json;
  const two=await call<TaskStartResponse>('POST',path(f.systemId,p.id,'ui','resume'),{},ADMIN);expect(two.status,JSON.stringify(two.json)).toBe(201);expect(two.json.task.forkRepo).toBe(one.task.forkRepo);expect(two.json.secret).not.toBe(one.secret);
  const old=await call('POST',path(f.systemId,p.id,'ui','submit'),{attemptId:one.attempt.id,generation:one.attempt.generation,commit:one.task.base.commit},{authorization:`Bearer ${one.secret}`});expect(old.status).toBe(403);
  expect(await systemStub(env,f.systemId).realizationSecretHash(one.attempt.realizationId)).toBeNull();
 });
 it('keeps failed revocations pending across retries and never mints a second writer',async()=>{
  const f=await importFresh(),p=(await call<RealizationPlan>('POST',path(f.systemId),{title:'Build',tasks:[definition]},ADMIN)).json;
  const first=(await call<TaskStartResponse>('POST',path(f.systemId,p.id,'ui','claim'),{},ADMIN)).json;
  const repo=f.ns.repo(first.task.forkRepo),revoke=repo.revokeToken.bind(repo);let fails=true;
  repo.revokeToken=async id=>{if(fails)throw new Error('revocation unavailable');return revoke(id);};
  const failed=await call('POST',path(f.systemId,p.id,'ui','resume'),{},ADMIN);expect(failed.status).toBe(500);expect(repo.tokens.filter(t=>!t.revoked)).toHaveLength(1);
  const failedAgain=await call('POST',path(f.systemId,p.id,'ui','resume'),{},ADMIN);expect(failedAgain.status).toBe(500);expect(repo.tokens.filter(t=>!t.revoked)).toHaveLength(1);
  fails=false;const retried=await call<TaskStartResponse>('POST',path(f.systemId,p.id,'ui','resume'),{},ADMIN);expect(retried.status).toBe(201);expect(repo.tokens.filter(t=>!t.revoked)).toHaveLength(1);expect(repo.tokens[0].revoked).toBe(true);
 });
 it('refuses task mutation through legacy checkpoint and submit endpoints',async()=>{
  const f=await importFresh(),p=(await call<RealizationPlan>('POST',path(f.systemId),{title:'Build',tasks:[definition]},ADMIN)).json;
  const first=(await call<TaskStartResponse>('POST',path(f.systemId,p.id,'ui','claim'),{},ADMIN)).json;
  for(const [action,body] of [['checkpoints',{message:'bypass'}],['submit',{commit:first.task.base.commit}]] as const){const out=await call('POST',`/systems/${f.systemId}/realizations/${first.attempt.realizationId}/${action}`,body,{authorization:`Bearer ${first.secret}`});expect(out.status).toBe(409);}
 });

 it('rejects new app and mixed Evolutions and uses Genome-only amendment defaults',async()=>{
  const f=await importFresh();
  for(const kind of ['implementation','mixed'])expect((await call('POST',`/systems/${f.systemId}/evolutions`,{title:'Change',intent:'Change',kind},ADMIN)).status).toBe(400);
  const created=await call<{evolution:{id:string;kind:string}}>('POST',`/systems/${f.systemId}/evolutions`,{title:'Change Genome',intent:'Describe the change'},ADMIN);expect(created.status).toBe(201);expect(created.json.evolution.kind).toBe('genome-amendment');
  expect((await call('POST',`/systems/${f.systemId}/evolutions/${created.json.evolution.id}/realizations`,{target:'app'},ADMIN)).status).toBe(409);
 });
 it('combines two selected predecessors before a downstream task receives its fork',async()=>{
  const f=await importFresh();setEditorTransport({fetch:fakeReceivePack(f.ns).fetch});
  const task=(id:string,deps:string[]=[])=>({id,title:id,artifactId:'artifact.webapp',steps:['Implement'],dependsOn:deps,readNodes:[],writeNodes:[id],checks:[],footprint:{repo:f.appRepo,artifactId:'artifact.webapp',globs:[`src/${id}.txt`],paths:[],unmatched:[`src/${id}.txt`],known:true}});
  const p=await systemStub(env,f.systemId).createRealizationPlan({title:'Fan in',tasks:[task('a'),task('b'),task('c',['a','b'])]});
  for(const id of ['a','b']){const start=(await call<TaskStartResponse>('POST',path(f.systemId,p.id,id,'claim'),{},ADMIN)).json,repo=f.ns.repo(start.task.forkRepo),files=await walkTree(repo,start.task.base.commit);files.set(`src/${id}.txt`,id);const commit=repo.commit(files,id);const submitted=await call<TaskSubmitResponse>('POST',path(f.systemId,p.id,id,'submit'),{attemptId:start.attempt.id,generation:start.attempt.generation,commit},{authorization:`Bearer ${start.secret}`});expect(submitted.status,JSON.stringify(submitted.json)).toBe(201);expect((await call('POST',path(f.systemId,p.id,id,'select'),{candidateId:submitted.json.candidate.id},ADMIN)).status).toBe(200);}
  const downstream=await call<TaskStartResponse>('POST',path(f.systemId,p.id,'c','claim'),{},ADMIN);expect(downstream.status,JSON.stringify(downstream.json)).toBe(201);const combined=await walkTree(f.ns.repo(downstream.json.task.forkRepo),downstream.json.task.base.commit);expect(combined.get('src/a.txt')).toBe('a');expect(combined.get('src/b.txt')).toBe('b');
 });

 it('recovers a first fork failure by creating the same task fork on resume',async()=>{
  const f=await importFresh(),p=(await call<RealizationPlan>('POST',path(f.systemId),{title:'Build',tasks:[definition]},ADMIN)).json,base=f.ns.repo(f.appRepo),fork=base.fork.bind(base);let fail=true;
  base.fork=async(...args)=>{if(fail)throw new Error('fork unavailable');return fork(...args);};
  expect((await call('POST',path(f.systemId,p.id,'ui','claim'),{},ADMIN)).status).toBe(500);
  const before=await systemStub(env,f.systemId).realizationPlan(p.id);fail=false;
  const resumed=await call<TaskStartResponse>('POST',path(f.systemId,p.id,'ui','resume'),{},ADMIN);expect(resumed.status,JSON.stringify(resumed.json)).toBe(201);expect(resumed.json.task.forkRepo).toBe(before.tasks[0].forkRepo);
 });
 it('clears successfully revoked fresh credentials before a non-idempotent retry',async()=>{
  const f=await importFresh(),p=(await call<RealizationPlan>('POST',path(f.systemId),{title:'Build',tasks:[definition]},ADMIN)).json;let restore=()=>{};
  await runInDurableObject(env.SYSTEMS.getByName(f.systemId),async(i:SystemAuthority)=>{const proto=Object.getPrototypeOf(i),orig=proto.lifecycleActivate;proto.lifecycleActivate=function(...args:unknown[]){orig.apply(this,args);throw new Error('activation response lost');};restore=()=>{proto.lifecycleActivate=orig;};});
  try{expect((await call('POST',path(f.systemId,p.id,'ui','claim'),{},ADMIN)).status).toBe(500);}finally{restore();}
  const before=await systemStub(env,f.systemId).realizationPlan(p.id),repo=f.ns.repo(before.tasks[0].forkRepo),revoke=repo.revokeToken.bind(repo);repo.revokeToken=async id=>{if(repo.tokens.find(t=>t.id===id)?.revoked)throw new Error('already revoked');return revoke(id);};
  const retried=await call<TaskStartResponse>('POST',path(f.systemId,p.id,'ui','resume'),{},ADMIN);expect(retried.status,JSON.stringify(retried.json)).toBe(201);expect(repo.tokens.filter(t=>!t.revoked)).toHaveLength(1);
 });

 it('keeps exec bits and symlinks through fan-in and integration',async()=>{
  const f=await importFresh(),transport=fakeReceivePack(f.ns);setEditorTransport({fetch:transport.fetch});
  const task=(id:string,globs:string[],deps:string[]=[])=>({id,title:id,artifactId:'artifact.webapp',steps:['Implement'],dependsOn:deps,readNodes:[],writeNodes:[id],checks:[],footprint:{repo:f.appRepo,artifactId:'artifact.webapp',globs,paths:[],unmatched:globs,known:true}});
  // x: same content, now executable. y: an existing file becomes a symlink with the same text. z builds on both.
  const p=await systemStub(env,f.systemId).createRealizationPlan({title:'Modes',tasks:[task('x',['src/index.ts']),task('y',['src/worker/health.ts']),task('z',['src/z.txt'],['x','y'])]});
  const edits:Record<string,FileChange[]>={x:[{path:'src/index.ts',content:'export default {}',type:'exec'}],y:[{path:'src/worker/health.ts',content:'ok',type:'symlink'}],z:[{path:'src/z.txt',content:'z'}]};
  const kinds=async(repo:string,commit:string)=>{const t=await listTree(f.ns.repo(repo),commit);return {index:t.get('src/index.ts')?.mode,health:t.get('src/worker/health.ts')?.mode};};
  for(const id of ['x','y','z']){
   const start=await call<TaskStartResponse>('POST',path(f.systemId,p.id,id,'claim'),{},ADMIN);expect(start.status,JSON.stringify(start.json)).toBe(201);const s=start.json;
   if(id==='z')expect(await kinds(s.task.base.repo,s.task.base.commit)).toEqual({index:'100755',health:'120000'});
   const pushed=await pushCommit({repo:f.ns.repo(s.task.forkRepo),remote:s.token.remote,token:s.token.value,parent:s.task.base.commit,changes:edits[id],fetch:transport.fetch,author:{name:'Agent',email:'agent@example.com'},message:id});
   const submitted=await call<TaskSubmitResponse>('POST',path(f.systemId,p.id,id,'submit'),{attemptId:s.attempt.id,generation:s.attempt.generation,commit:pushed.commit},{authorization:`Bearer ${s.secret}`});expect(submitted.status,JSON.stringify(submitted.json)).toBe(201);expect(submitted.json.candidate.changedPaths).toEqual(edits[id].map(e=>e.path));
   expect((await call('POST',path(f.systemId,p.id,id,'select'),{candidateId:submitted.json.candidate.id},ADMIN)).status).toBe(200);
  }
  const integrated=await call<ImplementationReview>('POST',lifecyclePaths.integrate(f.systemId,p.id).replace(/^\/api/,''),{},ADMIN);expect(integrated.status,JSON.stringify(integrated.json)).toBe(200);
  const [b]=integrated.json.bindings;expect(await kinds(b.source.repo,b.source.commit)).toEqual({index:'100755',health:'120000'});
  expect((await listTree(f.ns.repo(b.source.repo),b.source.commit)).get('src/z.txt')?.mode).toBe('100644');
  const candidate=integrated.json.candidates.find(c=>c.id===b.candidateId)!;expect(candidate.changedPaths).toEqual(['src/index.ts','src/worker/health.ts','src/z.txt']);
 });

 it('returns claim refusals with structured details',async()=>{
  const f=await importFresh();
  const task=(id:string,deps:string[]=[])=>({id,title:id,artifactId:'artifact.webapp',steps:['Implement'],dependsOn:deps,readNodes:[],writeNodes:[id],checks:[],footprint:{repo:f.appRepo,artifactId:'artifact.webapp',globs:[`src/${id}.txt`],paths:[],unmatched:[`src/${id}.txt`],known:true}});
  const p=await systemStub(env,f.systemId).createRealizationPlan({title:'Refusals',tasks:[task('a'),task('b'),task('c',['a','b'])]});
  const blocked=await call<{error:{code:string;message:string;details?:unknown}}>('POST',path(f.systemId,p.id,'c','claim'),{},ADMIN);
  expect(blocked.status).toBe(409);expect(blocked.json.error).toEqual({code:'invalid-state',message:'dependency a is not selected',details:{blockedOn:['a','b']}});
  expect((await call('POST',path(f.systemId,p.id,'a','claim'),{agentLabel:'agent-one'},ADMIN)).status).toBe(201);
  const taken=await call<{error:{code:string;message:string;details?:unknown}}>('POST',path(f.systemId,p.id,'a','claim'),{agentLabel:'agent-two'},ADMIN);
  expect(taken.status).toBe(409);expect(taken.json.error).toEqual({code:'invalid-state',message:'task already has an active writer',details:{by:'agent-one'}});
 });

 it('keeps a claim when the registry refresh fails after it landed',async()=>{
  const f=await importFresh(),p=(await call<RealizationPlan>('POST',path(f.systemId),{title:'Build',tasks:[definition]},ADMIN)).json;let restore=()=>{};
  await runInDurableObject(env.SYSTEMS.getByName(REGISTRY),async(i:SystemAuthority)=>{const proto=Object.getPrototypeOf(i),orig=proto.registerSystem;let once=true;proto.registerSystem=function(...args:unknown[]){if(once){once=false;throw new Error('registry unavailable');}return orig.apply(this,args);};restore=()=>{proto.registerSystem=orig;};});
  try{
   const claimed=await call<TaskStartResponse>('POST',path(f.systemId,p.id,'ui','claim'),{},ADMIN);expect(claimed.status,JSON.stringify(claimed.json)).toBe(201);
   const after=await systemStub(env,f.systemId).realizationPlan(p.id),a=after.tasks[0].attempts.at(-1)!;
   expect(a.status).toBe('working');expect(Date.parse(a.leaseExpiresAt)).toBeGreaterThan(Date.now());
   expect(f.ns.repo(after.tasks[0].forkRepo).tokens.filter(t=>!t.revoked)).toHaveLength(1);
  }finally{restore();}
 });

});

describe('replayDelta',()=>{
 /** A commit whose root tree is the parent's with `edit` applied to its entries. */
 async function rootEdit(repo:ReturnType<FakeArtifacts['create']>,parent:string,edit:(entries:TreeEntry[])=>TreeEntry[]):Promise<string>{
  const meta=(await repo.readCommit(parent))!,entries=edit([...(await repo.readTree(meta.treeHash))!]).sort((a,b)=>a.name<b.name?-1:1);
  const tree=repo.store.put({kind:'tree',entries});
  return repo.store.put({kind:'commit',meta:{...meta,hash:'',treeHash:tree,parents:[parent],message:'edit'}});
 }
 const setup=()=>{const ns=new FakeArtifacts(),repo=ns.create('app'),base=repo.commit({'run.sh':'echo\n','README.md':'r\n'},'base');return {repo,base};};
 const noScope=()=>{},divergent=(path:string)=>Object.assign(new Error(`divergent ${path}`),{code:'divergent'});
 const gitlink={name:'sub',mode:'160000',type:'gitlink' as const,hash:'1'.repeat(40)};
 it('refuses a candidate that adds a gitlink',async()=>{
  const {repo,base}=setup(),cand=await rootEdit(repo,base,e=>[...e,gitlink]),original=await listTree(repo,base);
  await expect(replayDelta(repo,base,cand,replayFrom(original),noScope,divergent)).rejects.toMatchObject({status:409,code:'integration-conflict'});
 });
 it('refuses a candidate that removes a gitlink',async()=>{
  const {repo,base}=setup(),withLink=await rootEdit(repo,base,e=>[...e,gitlink]),cand=await rootEdit(repo,withLink,e=>e.filter(x=>x.name!=='sub'));
  await expect(replayDelta(repo,withLink,cand,replayFrom(await listTree(repo,withLink)),noScope,divergent)).rejects.toMatchObject({status:409,code:'integration-conflict'});
 });
 it('replays a mode-only change with its kind and treats it as divergent for a later content edit',async()=>{
  const {repo,base}=setup(),original=await listTree(repo,base),r=replayFrom(original);
  const chmod=await rootEdit(repo,base,e=>e.map(x=>x.name==='run.sh'?{...x,mode:'100755',type:'exec' as const}:x));
  await replayDelta(repo,base,chmod,r,noScope,divergent);
  expect(replayChanges(r,original)).toEqual([expect.objectContaining({path:'run.sh',type:'exec'})]);
  const edit=repo.commit({'run.sh':'echo hi\n','README.md':'r\n'},'edit');
  await expect(replayDelta(repo,base,edit,r,noScope,divergent)).rejects.toMatchObject({code:'divergent'});
 });
});
