import { constants, existsSync, lstatSync, mkdirSync, openSync, closeSync, writeSync, fchmodSync, readFileSync, readdirSync, rmSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { lifecyclePaths, type CreateRealizationPlanRequest, type DraftRealizationPlanRequest, type DraftRealizationPlanResponse, type ImplementationReview, type RealizationPlan, type Task, type TaskStartResponse, type TaskSubmitResponse } from '../../../apps/platform/shared/lifecycle.ts';
import { shellArg } from '../../../apps/platform/shared/shell.ts';
import { operationsPaths } from '../../../apps/platform/shared/operations.ts';
import type { OntologyImportReview } from '../../../apps/platform/shared/ontology-packages.ts';
import { initCommand } from './init.ts';
import { PlatformClient, PlatformError } from './api.ts';
import { CliError, assertId, assertRemote, assertSecret, assertToken, commitIfDirty, git, isTracked } from './git.ts';
import { resolvePlatform } from './platform-url.ts';
import { WORKSPACE_IGNORES } from './ignore.ts';
import { mergeAgentsBlock } from './agents-md.ts';
import type { Io } from './main.ts';
/** Inside .git, so no .gitignore negation can stage it; the old root location is read once and moved here. */
const CONFIG='.git/artyfact-task.json',LEGACY_CONFIG='.artyfact-task.json';
const id=(label:string,value:string|undefined)=>{if(!value)throw new CliError(`${label} is required`);return assertId(label,value);};
/** Screenshot limits the platform enforces on `task submit --screenshot`: 4 images, 4 MiB each, PNG/JPEG/WebP. */
const MAX_SCREENSHOTS=4,MAX_SCREENSHOT_BYTES=4*1024*1024;
function imageType(b:Buffer):'image/png'|'image/jpeg'|'image/webp'|null{
 if(b.length>=8&&b[0]===0x89&&b.subarray(1,4).toString('latin1')==='PNG')return 'image/png';
 if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg';
 if(b.length>=12&&b.subarray(0,4).toString('latin1')==='RIFF'&&b.subarray(8,12).toString('latin1')==='WEBP')return 'image/webp';
 return null;
}
/** `--screenshot` files as the submit body's `screenshots`: regular files, at most 4, each a PNG, JPEG or WebP of at most 4 MiB. */
function readScreenshots(files:string[],io:Io){
 if(files.length>MAX_SCREENSHOTS)throw new CliError(`at most ${MAX_SCREENSHOTS} --screenshot files`);
 return files.map(file=>{
  const path=resolve(io.cwd,file);let stat;try{stat=lstatSync(path);}catch{throw new CliError(`screenshot ${file} not found`);}
  if(!stat.isFile())throw new CliError(`screenshot ${file} must be a regular file`);
  if(stat.size>MAX_SCREENSHOT_BYTES)throw new CliError(`screenshot ${file} is ${stat.size} bytes; the limit is ${MAX_SCREENSHOT_BYTES}`);
  const bytes=readFileSync(path);if(bytes.length>MAX_SCREENSHOT_BYTES)throw new CliError(`screenshot ${file} is ${bytes.length} bytes; the limit is ${MAX_SCREENSHOT_BYTES}`);
  const mediaType=imageType(bytes);if(!mediaType)throw new CliError(`screenshot ${file} is not a PNG, JPEG or WebP image`);
  return {name:basename(path).slice(0,200),mediaType,base64:bytes.toString('base64')};
 });
}
const readJson=(file:string,io:Io)=>{const path=resolve(io.cwd,file);const stat=lstatSync(path);if(!stat.isFile()||stat.size>4*1024*1024)throw new CliError('input must be a regular JSON file smaller than 4 MiB');return JSON.parse(readFileSync(path,'utf8'));};
function write(path:string,data:string,mode=0o644){if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw new CliError('refusing symlinked task workspace file');const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,mode);try{writeSync(fd,data);fchmodSync(fd,mode);}finally{closeSync(fd);}}
/** Credentials: a fresh 0600 file renamed into place, so the path never holds them with wider permissions. */
function writeSecret(path:string,data:string){if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw new CliError('refusing symlinked task workspace file');const tmp=`${path}.${process.pid}.tmp`;rmSync(tmp,{force:true});const fd=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeSync(fd,data);fchmodSync(fd,0o600);}finally{closeSync(fd);}renameSync(tmp,path);}
/** The task config path in `dir`, moving a legacy root `.artyfact-task.json` into .git first. */
function configPath(dir:string):string{
 const path=join(dir,CONFIG),legacy=join(dir,LEGACY_CONFIG);
 if(!existsSync(path)&&existsSync(legacy)&&existsSync(join(dir,'.git'))&&lstatSync(join(dir,'.git')).isDirectory()){if(lstatSync(legacy).isSymbolicLink())throw new CliError('refusing symlinked task config');writeSecret(path,readFileSync(legacy,'utf8'));unlinkSync(legacy);}
 return path;
}
/** `.git/artyfact-task.json` (mode 0600, inside .git, never staged). `token` is the fork write token at rest. */
interface LocalTask {platform:string;systemId:string;planId:string;taskId:string;attemptId:string;generation:number;remote:string;secret:string;reviewUrl:string;token?:string;tokenExpires?:string}
function local(io:Io):LocalTask {const path=configPath(io.cwd);if(!existsSync(path))throw new CliError(`run artyfact task start first (${CONFIG} missing)`);if(lstatSync(path).isSymbolicLink())throw new CliError('refusing symlinked task config');const cfg=JSON.parse(readFileSync(path,'utf8')) as LocalTask;for(const key of ['systemId','planId','taskId','attemptId'] as const)assertId(key,cfg[key]);assertSecret(cfg.secret);if(cfg.token!==undefined)assertToken(cfg.token);assertRemote('task remote',cfg.remote,io.env);return cfg;}
/** Validate the claim/start/resume target before any HTTP call: absent or empty, or this task's earlier workspace. */
function assertTaskDir(dir:string,io:Io,system:string,plan:string,task:string):LocalTask|undefined{
 let stat;try{stat=lstatSync(dir);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw new CliError(`cannot inspect ${dir}: ${(e as NodeJS.ErrnoException).code??(e as Error).message}; choose another --dir`);}
 if(stat.isSymbolicLink())throw new CliError('refusing symlinked workspace');
 if(!stat.isDirectory())throw new CliError(`${dir} exists and is not a directory; choose another --dir`);
 if(!readdirSync(dir).length)return undefined;
 if(!existsSync(configPath(dir)))throw new CliError(`${dir} exists and is not empty; choose an empty --dir or this task's earlier workspace`);
 const prior=local({...io,cwd:dir});
 if(prior.systemId!==system||prior.planId!==plan||prior.taskId!==task)throw new CliError('workspace belongs to another task');
 for(const sub of ['.git','.git/info']){let st;try{st=lstatSync(join(dir,sub));}catch{throw new CliError('workspace has no usable git directory; choose an empty --dir');}if(!st.isDirectory())throw new CliError('refusing unsafe git workspace');}
 if(git(dir,['config','--get','remote.origin.url'])!==prior.remote)throw new CliError('resumed workspace remote differs; preserve work and choose a new --dir');
 return prior;
}
/** Turn the claim routes' 409 details (`{blockedOn}`, `{by}`, `{taskId, by}`) into the one-line texts the agent loop prints; anything else passes through. */
function claimError(e:unknown,task:string):unknown{
 if(!(e instanceof PlatformError)||e.status!==409)return e;
 const d=(e.details??{}) as {blockedOn?:unknown;by?:unknown;taskId?:unknown};
 const blocked=Array.isArray(d.blockedOn)?d.blockedOn.filter((x):x is string=>typeof x==='string'):[];
 if(blocked.length)return new CliError(`blocked by ${blocked.join(', ')} (not yet selected)`);
 const by=typeof d.by==='string'?d.by:'an unnamed agent';
 if(typeof d.taskId==='string')return new CliError(`task ${task} conflicts with ${d.taskId}, held by ${by}`);
 if('by' in d)return new CliError(`task ${task} is taken by ${by}`);
 return e;
}
const cell=(xs:readonly string[]|undefined)=>xs?.length?xs.join(','):'-';
const table=(head:string[],rows:string[][])=>{const w=head.map((h,i)=>Math.max(h.length,...rows.map(r=>r[i]!.length)));const line=(c:string[])=>c.map((x,i)=>x.padEnd(w[i]!)).join('  ').trimEnd();return [line(head),...rows.map(line)];};
const waveOf=(waves:string[][]|undefined,id:string)=>{const i=(waves??[]).findIndex(w=>w.includes(id));return i<0?'-':String(i+1);};
const footprintOf=(t:Pick<Task,'footprint'>)=>cell([...new Set([...(t.footprint?.globs??[]),...(t.footprint?.paths??[])])]);
const conflictLines=(a:RealizationPlan['analysis']|undefined)=>(a?.conflicts??[]).map(c=>`conflicts: ${c.tasks.join(' <-> ')} [${c.kind}] ${c.subjects.join(', ')}: ${c.message}`);
/** The lowest-wave pending task whose dependencies are all selected or completed and that no conflicting live attempt blocks. */
function nextClaimable(plan:RealizationPlan):Task|undefined{
 const done=new Set(plan.tasks.filter(t=>t.status==='selected'||t.status==='completed').map(t=>t.id));
 const live=(t:Task)=>{const a=t.attempts?.at(-1);return !!a&&a.status!=='ended'&&Date.parse(a.leaseExpiresAt)>Date.now();};
 const held=(t:Task)=>(plan.analysis?.conflicts??[]).some(c=>c.tasks.includes(t.id)&&c.tasks.some(o=>o!==t.id&&plan.tasks.some(x=>x.id===o&&live(x))));
 return plan.tasks.filter(t=>t.status==='pending'&&t.dependsOn.every(d=>done.has(d))&&!held(t))
  .sort((a,b)=>(Number(waveOf(plan.analysis?.waves,a.id))||Infinity)-(Number(waveOf(plan.analysis?.waves,b.id))||Infinity))[0];
}
function printDraft(d:DraftRealizationPlanResponse,io:Io){
 const tasks=d.request.tasks;
 io.out(`draft: ${d.request.title} (${tasks.length} task${tasks.length===1?'':'s'}, genome ${d.request.genomeCommit??d.provenance.genomeCommit})`);
 io.out(table(['task','title','wave','depends-on','write nodes'],tasks.map(t=>[t.id,t.title,waveOf(d.analysis.waves,t.id),cell(t.dependsOn),cell(t.writeNodes)])).join('\n'));
 d.analysis.waves.forEach((w,i)=>io.out(`wave ${i+1}: ${w.join(', ')}`));
 for(const line of conflictLines(d.analysis))io.out(line);
 for(const p of d.problems)io.out(`${p.severity}${p.taskId?` (${p.taskId})`:''}: ${p.message}`);
 if(d.provenance.fallback)io.out('planner: deterministic fallback partition');
}
const reviewLink=(base:string,s:string,p:string)=>`${base}/s/${encodeURIComponent(s)}/r/head/work?plan=${encodeURIComponent(p)}`;
export async function lifecycleCommand(command:string,args:string[],io:Io):Promise<number>{
 const {values:v,positionals:p}=parseArgs({args,allowPositionals:true,options:{system:{type:'string'},platform:{type:'string'},file:{type:'string'},dir:{type:'string'},hash:{type:'string'},candidate:{type:'string'},binding:{type:'string'},key:{type:'string'},reason:{type:'string'},'expected-version':{type:'string'},'agent-label':{type:'string'},from:{type:'string'},to:{type:'string'},before:{type:'string'},cursor:{type:'string'},limit:{type:'string'},json:{type:'boolean'},screenshot:{type:'string',multiple:true},evolution:{type:'string',multiple:true},node:{type:'string',multiple:true},hint:{type:'string'},title:{type:'string'},create:{type:'boolean'}}});
 const action=p[0];
 if(command==='task'&&['checkpoint','submit','status'].includes(action??'')){
  if(action==='checkpoint'&&!p[1])throw new CliError('usage: artyfact task checkpoint "<message>"');
  if(action!=='submit'&&v.screenshot?.length)throw new CliError('--screenshot belongs to task submit');
  // Read before committing or pushing, so a bad file stops the submit before anything leaves the workspace.
  const screenshots=action==='submit'?readScreenshots(v.screenshot??[],io):[];
  const cfg=local(io);const client=new PlatformClient(cfg.platform,io.env.ARTYFACT_SECRET||cfg.secret);const path=lifecyclePaths.action(cfg.systemId,cfg.planId,cfg.taskId,action==='checkpoint'?'checkpoint':'submit');
  if(action==='status'){io.out(JSON.stringify(await client.request('GET',lifecyclePaths.task(cfg.systemId,cfg.planId,cfg.taskId)),null,2));return 0;}
  const writeToken=action==='submit'?io.env.ARTYFACT_TOKEN||cfg.token:undefined;if(action==='submit'&&!writeToken)throw new CliError(`no task write token: ${CONFIG} holds none and ARTYFACT_TOKEN is unset; run task resume <plan> <task> --system <system> --dir . to store a fresh one`);
  if(action==='submit'&&!io.env.ARTYFACT_TOKEN&&cfg.tokenExpires&&Date.parse(cfg.tokenExpires)<=Date.now())io.err(`note: the stored task write token expired at ${cfg.tokenExpires}; if the push fails, run task resume to store a fresh one`);
  if(writeToken)assertToken(writeToken);const message=p[1]??'Task submission';const commit=commitIfDirty(io.cwd,message,io.err);
  if(writeToken)git(io.cwd,['push','--',cfg.remote,'HEAD:main'],writeToken);
  const res=await client.request<TaskSubmitResponse>('POST',path,{attemptId:cfg.attemptId,generation:cfg.generation,commit,...(action==='checkpoint'?{message}:{}),...(screenshots.length>0&&{screenshots})});io.out(JSON.stringify({...res,reviewUrl:cfg.reviewUrl},null,2));if(!v.json)io.out(`Review: ${cfg.reviewUrl}`);return 0;
 }
 const publicRead=command==='plan'&&['tasks','list','show','review'].includes(action??'');
 const token=io.env.ARTYFACT_ADMIN_TOKEN;if(!token&&!publicRead)throw new CliError('ARTYFACT_ADMIN_TOKEN is required for this scoped administrative command');if(token)assertToken(token);
 const system=id('system',v.system??io.env.ARTYFACT_SYSTEM);const base=await resolvePlatform(v.platform,io.env,io.fetch??fetch,io.err);const client=new PlatformClient(base,token||undefined);let result:unknown;
 if(command==='evolution'){
  const root=`/api/systems/${encodeURIComponent(system)}`;
  if(action==='create'){if(!v.file)throw new CliError('--file evolution.json is required');const body=readJson(v.file,io);result=await client.request<{evolution:{id:string}}>('POST',`${root}/evolutions`,{...body,kind:'genome-amendment'});io.out(`Review: ${base}/s/${encodeURIComponent(system)}/r/head/work?evolution=${encodeURIComponent((result as {evolution:{id:string}}).evolution.id)}`);}
  else if(action==='propose'){if(!v.file)throw new CliError('--file intent.json is required');result=await client.request<{id:string}>('POST',`${root}/intents`,readJson(v.file,io));io.out(`Review: ${base}/s/${encodeURIComponent(system)}/r/head/work?panel=intent&proposal=${encodeURIComponent((result as {id:string}).id)}`);}
  else if(action==='show')result=await client.request('GET',`${root}/intents/${encodeURIComponent(id('proposal',p[1]))}`);else throw new CliError('usage: artyfact evolution create|propose|show --system sid');
 }else if(command==='plan'){
  if(action==='draft'){
   const nodes=(v.node??[]).map(n=>assertId('node',n)),evolutionIds=(v.evolution??[]).map(e=>assertId('evolution',e));
   const body:DraftRealizationPlanRequest={...(v.title&&{title:v.title}),...(evolutionIds.length&&{evolutionIds}),...(nodes.length&&{nodes}),...(v.hint&&{hint:v.hint})};
   const draft=await client.request<DraftRealizationPlanResponse>('POST',lifecyclePaths.draft(system),body);
   if(v.json&&!v.create){io.out(JSON.stringify(draft,null,2));return 0;}
   if(!v.json)printDraft(draft,io);
   if(!v.create){io.out(`Nothing was saved. Re-run with --create to create this plan${draft.problems.some(p=>p.severity==='error')?' (resolve the errors first)':''}.`);return 0;}
   const created=await client.request<RealizationPlan>('POST',lifecyclePaths.plans(system),draft.request);
   if(v.json)io.out(JSON.stringify({draft,plan:created},null,2));else{io.out(`plan: ${created.id}`);io.out(`Review: ${reviewLink(base,system,created.id)}`);}
   return 0;
  }
  else if(action==='tasks'){
   const planId=id('plan',p[1]),plan=await client.request<RealizationPlan>('GET',lifecyclePaths.plan(system,planId));
   if(v.json){io.out(JSON.stringify({planId:plan.id,status:plan.status,tasks:plan.tasks.map(t=>({id:t.id,status:t.status,wave:Number(waveOf(plan.analysis?.waves,t.id))||null,dependsOn:t.dependsOn,writeNodes:t.writeNodes,footprint:t.footprint})),conflicts:plan.analysis?.conflicts??[],waves:plan.analysis?.waves??[],next:nextClaimable(plan)?.id??null},null,2));return 0;}
   if(!plan.tasks.length){io.out(`Plan ${plan.id} has no tasks.`);return 0;}
   io.out(table(['task','status','wave','depends-on','write nodes','footprint'],plan.tasks.map(t=>[t.id,t.status,waveOf(plan.analysis?.waves,t.id),cell(t.dependsOn),cell(t.writeNodes),footprintOf(t)])).join('\n'));
   for(const line of conflictLines(plan.analysis))io.out(line);
   const next=nextClaimable(plan);io.out(next?`claim: ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact task claim ${[plan.id,next.id,'--system',system,'--dir',`./work/${next.id}`,'--agent-label',`claude:${next.id}`].map(shellArg).join(' ')}`:'claim: no task is claimable now (all claimed, finished, or blocked by an unfinished dependency)');
   return 0;
  }
  else if(action==='list')result=await client.request('GET',lifecyclePaths.plans(system));
  else if(action==='create'){if(!v.file)throw new CliError('--file plan.json is required');const body=readJson(v.file,io) as CreateRealizationPlanRequest;result=await client.request<RealizationPlan>('POST',lifecyclePaths.plans(system),body);io.out(`Review: ${reviewLink(base,system,(result as RealizationPlan).id)}`);}
  else {const plan=id('plan',p[1]);if(action==='show')result=await client.request('GET',lifecyclePaths.plan(system,plan));else if(action==='review')result=await client.request('GET',lifecyclePaths.review(system,plan));else if(action==='integrate')result=await client.request('POST',lifecyclePaths.integrate(system,plan),{});else if(action==='promote'){if(!v.file)throw new CliError('--file reviewed-promotion.json is required');result=await client.request('POST',lifecyclePaths.promote(system,plan),readJson(v.file,io));}else throw new CliError('usage: artyfact plan draft|tasks|create|list|show|integrate|review|promote');io.out(`Review: ${reviewLink(base,system,plan)}`);}
 }else if(command==='task'){
  const plan=id('plan',p[1]),task=id('task',p[2]);
  if(action==='select')result=await client.request('POST',lifecyclePaths.action(system,plan,task,'select'),{candidateId:id('candidate',v.candidate)});
  else if(action==='claim'||action==='start'||action==='resume'){
   const dir=resolve(io.cwd,v.dir??task),prior=assertTaskDir(dir,io,system,plan,task);
   let res:TaskStartResponse;try{res=await client.request<TaskStartResponse>('POST',lifecyclePaths.action(system,plan,task,action),{agentLabel:v['agent-label']??'local agent'});}catch(e){throw claimError(e,task);}
   const remote=assertRemote('task remote',res.remote,io.env),secret=assertSecret(res.secret),writeToken=assertToken(res.token.value);
   if(prior){if(prior.remote!==remote)throw new CliError('resumed workspace remote differs; preserve work and choose a new --dir');}else{const fresh=!existsSync(dir);mkdirSync(dir,{recursive:true});try{git(io.cwd,['clone','--',remote,dir],writeToken);}catch(e){
    // The claim holds a live lease and there is no release route; drop the half-made workspace and point at resume, which reuses the lease.
    if(fresh)rmSync(dir,{recursive:true,force:true});else for(const entry of readdirSync(dir))rmSync(join(dir,entry),{recursive:true,force:true});
    throw new CliError(`${action} landed but the workspace could not be cloned (${(e as Error).message}); the lease is still yours, so fix the cause and run: artyfact task resume ${[plan,task,'--system',system,'--dir',dir].map(shellArg).join(' ')}`);}}
   for(const sub of ['.git','.git/info'])if(!lstatSync(join(dir,sub)).isDirectory()||lstatSync(join(dir,sub)).isSymbolicLink())throw new CliError('refusing unsafe git workspace');
   if(isTracked(dir,LEGACY_CONFIG)||isTracked(dir,'TASK_PACKET.md'))throw new CliError('refusing tracked task configuration or packet; do not store attempt credentials in source');
   const cfg:LocalTask={platform:base,systemId:system,planId:plan,taskId:task,attemptId:res.attempt.id,generation:res.attempt.generation,remote,secret,reviewUrl:res.reviewUrl,token:writeToken,tokenExpires:res.token.expiresAt};
   const exclude=join(dir,'.git/info/exclude'),existing=readFileSync(exclude,'utf8');write(exclude,`${existing}\n${[LEGACY_CONFIG,'TASK_PACKET.md','AGENTS.md',...WORKSPACE_IGNORES].join('\n')}\n`);
   const hidden=[secret,writeToken,token,io.env.ARTYFACT_TOKEN,io.env.ARTYFACT_SECRET,prior?.token,prior?.secret].filter((x):x is string=>!!x);
   const scrub=(s:string)=>hidden.reduce((out,h)=>out.replaceAll(h,'***'),s);write(join(dir,'TASK_PACKET.md'),scrub(res.packet.markdown));
   const agents=join(dir,'AGENTS.md');write(agents,mergeAgentsBlock(existsSync(agents)?readFileSync(agents,'utf8'):'',scrub(res.packet.agentsMd??`Read TASK_PACKET.md. Implement only the pinned Genome, permitted paths, and Task scope. Run its checks. Checkpoint with npx artyfact task checkpoint "<message>". Submit with npx artyfact task submit; the task write token is stored in ${CONFIG} and is never shown. Never approve an Evolution, integrate, or promote without review. Return the durable review link: ${res.reviewUrl}`),'artyfact-task'));
   writeSecret(join(dir,CONFIG),JSON.stringify(cfg,null,2)+'\n');
   if(v.json){io.out(JSON.stringify({workspace:dir,attemptId:res.attempt.id,generation:res.attempt.generation,reviewUrl:res.reviewUrl,tokenExpires:res.token.expiresAt}));return 0;}
   io.out(`Task workspace ready: ${dir}`);io.out(`Review: ${res.reviewUrl}`);io.out(`The task write token is stored in ${CONFIG} (mode 0600, inside .git, never staged); task submit uses it. Run task resume to refresh it.`);return 0;
  }else throw new CliError('usage: artyfact task claim|start|resume <plan> <task> | checkpoint <message> | submit | select <plan> <task> --candidate id');
 }else if(command==='ontology'){
  const root=`/api/systems/${encodeURIComponent(system)}/ontology-imports`;
  if(action==='bootstrap'){
   const review=await client.request<OntologyImportReview>('GET',`${root}/${encodeURIComponent(id('import',p[1]))}`);
   if(review.status!=='accepted'||review.systemId!==system||!review.genomeFiles)throw new CliError('bootstrap requires an accepted import for this System with reviewed Genome files');
   if(!v.dir)throw new CliError('--dir new-project is required');const dir=resolve(io.cwd,v.dir);if(existsSync(dir))throw new CliError('bootstrap destination already exists; choose an empty new directory');
   const entries=Object.entries(review.genomeFiles);if(entries.length>1000||entries.some(([path,content])=>!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(segment=>segment==='..'||segment==='.'||segment==='.git'||!segment)||typeof content!=='string'||content.length>1024*1024))throw new CliError('unsafe or oversized reviewed Genome path');
   mkdirSync(join(dir,'genome'),{recursive:true});for(const [path,content] of entries){const target=join(dir,'genome',path);mkdirSync(dirname(target),{recursive:true});write(target,content);}
   io.out(`Reviewed Genome materialized in ${dir}/genome`);return await initCommand(['--dir',dir,'--platform',base,'--no-review'],io);
  }else if(action==='preview'){if(!v.file)throw new CliError('--file native-package.json is required');result=await client.request<OntologyImportReview>('POST',`${root}/preview`,(()=>{const input=readJson(v.file,io);return input&&typeof input==='object'&&Object.hasOwn(input,'package')?input:{package:input};})());io.out(`Review: ${base}/start?system=${encodeURIComponent(system)}&import=${encodeURIComponent((result as OntologyImportReview).id)}`);}
  else if(action==='list')result=await client.request('GET',root);else if(action==='show')result=await client.request('GET',`${root}/${encodeURIComponent(id('import',p[1]))}`);else if(action==='accept'){if(!v.hash)throw new CliError('--hash from the reviewed preview is required');result=await client.request('POST',`${root}/${encodeURIComponent(id('import',p[1]))}/accept`,{hash:v.hash});}else throw new CliError('usage: artyfact ontology preview|list|show|accept|bootstrap');
 }else if(command==='operations'){
  const query=new URLSearchParams();for(const name of ['from','to','before','cursor','limit'] as const)if(v[name]!==undefined)query.set(name,v[name]!);const suffix=query.size?`?${query}`:'';
  if(action==='bindings')result=await client.request('GET',operationsPaths.bindings(system));else{const binding=id('binding',v.binding);if(action==='metrics'||action==='measurements'||action==='flags'||action==='audit')result=await client.request('GET',operationsPaths[action](system,binding)+suffix);else if(action==='flag-create'){if(!v.file)throw new CliError('--file flag.json is required');result=await client.request('POST',operationsPaths.flags(system,binding),readJson(v.file,io));}else if(action==='flag-update'){if(!v.file)throw new CliError('--file update.json is required');result=await client.request('PATCH',operationsPaths.flag(system,binding,id('key',v.key)),readJson(v.file,io));}else if(action==='flag-disable'){if(!v['expected-version']||!v.reason)throw new CliError('--expected-version and --reason are required');result=await client.request('PATCH',operationsPaths.flag(system,binding,id('key',v.key)),{expectedVersion:v['expected-version'],reason:v.reason,patch:{enabled:false}});}else throw new CliError('usage: artyfact operations bindings|metrics|measurements|flags|audit|flag-create|flag-update|flag-disable');}
 }else throw new CliError(`unknown lifecycle command ${command}`);
 io.out(JSON.stringify(result,null,2));return 0;
}
