import { constants, existsSync, lstatSync, mkdirSync, openSync, closeSync, writeSync, fchmodSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { lifecyclePaths, type CreateRealizationPlanRequest, type ImplementationReview, type RealizationPlan, type TaskStartResponse, type TaskSubmitResponse } from '../../../apps/platform/shared/lifecycle.ts';
import { operationsPaths } from '../../../apps/platform/shared/operations.ts';
import type { OntologyImportReview } from '../../../apps/platform/shared/ontology-packages.ts';
import { initCommand } from './init.ts';
import { PlatformClient } from './api.ts';
import { CliError, assertId, assertRemote, assertSecret, assertToken, commitIfDirty, git, isTracked } from './git.ts';
import { resolvePlatform } from './platform-url.ts';
import { WORKSPACE_IGNORES } from './ignore.ts';
import { mergeAgentsBlock } from './agents-md.ts';
import type { Io } from './main.ts';
const CONFIG='.artyfact-task.json';
const id=(label:string,value:string|undefined)=>{if(!value)throw new CliError(`${label} is required`);return assertId(label,value);};
const readJson=(file:string,io:Io)=>{const path=resolve(io.cwd,file);const stat=lstatSync(path);if(!stat.isFile()||stat.size>4*1024*1024)throw new CliError('input must be a regular JSON file smaller than 4 MiB');return JSON.parse(readFileSync(path,'utf8'));};
function write(path:string,data:string,mode=0o644){if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw new CliError('refusing symlinked task workspace file');const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,mode);try{writeSync(fd,data);fchmodSync(fd,mode);}finally{closeSync(fd);}}
interface LocalTask {platform:string;systemId:string;planId:string;taskId:string;attemptId:string;generation:number;remote:string;secret:string;reviewUrl:string}
function local(io:Io):LocalTask {const path=join(io.cwd,CONFIG);if(!existsSync(path))throw new CliError(`run artyfact task start first (${CONFIG} missing)`);if(lstatSync(path).isSymbolicLink())throw new CliError('refusing symlinked task config');const cfg=JSON.parse(readFileSync(path,'utf8')) as LocalTask;for(const key of ['systemId','planId','taskId','attemptId'] as const)assertId(key,cfg[key]);assertSecret(cfg.secret);assertRemote('task remote',cfg.remote,io.env);return cfg;}
const reviewLink=(base:string,s:string,p:string)=>`${base}/s/${encodeURIComponent(s)}/r/head/work?plan=${encodeURIComponent(p)}`;
export async function lifecycleCommand(command:string,args:string[],io:Io):Promise<number>{
 const {values:v,positionals:p}=parseArgs({args,allowPositionals:true,options:{system:{type:'string'},platform:{type:'string'},file:{type:'string'},dir:{type:'string'},hash:{type:'string'},candidate:{type:'string'},binding:{type:'string'},key:{type:'string'},reason:{type:'string'},'expected-version':{type:'string'},'agent-label':{type:'string'},from:{type:'string'},to:{type:'string'},before:{type:'string'},cursor:{type:'string'},limit:{type:'string'},json:{type:'boolean'}}});
 const action=p[0];
 if(command==='task'&&['checkpoint','submit','status'].includes(action??'')){
  if(action==='checkpoint'&&!p[1])throw new CliError('usage: artyfact task checkpoint "<message>"');
  const cfg=local(io);const client=new PlatformClient(cfg.platform,io.env.ARTYFACT_SECRET||cfg.secret);const path=lifecyclePaths.action(cfg.systemId,cfg.planId,cfg.taskId,action==='checkpoint'?'checkpoint':'submit');
  if(action==='status'){io.out(JSON.stringify(await client.request('GET',lifecyclePaths.task(cfg.systemId,cfg.planId,cfg.taskId)),null,2));return 0;}
  const writeToken=action==='submit'?io.env.ARTYFACT_TOKEN:undefined;if(action==='submit'&&!writeToken)throw new CliError('ARTYFACT_TOKEN is required to push the task fork; run task resume <plan> <task> --system <system> --dir . --json for fresh credentials, then set ARTYFACT_TOKEN from its token field');
  if(writeToken)assertToken(writeToken);const message=p[1]??'Task submission';const commit=commitIfDirty(io.cwd,message,io.err);
  if(writeToken)git(io.cwd,['push','--',cfg.remote,'HEAD:main'],writeToken);
  const res=await client.request<TaskSubmitResponse>('POST',path,{attemptId:cfg.attemptId,generation:cfg.generation,commit,...(action==='checkpoint'?{message}:{})});io.out(JSON.stringify({...res,reviewUrl:cfg.reviewUrl},null,2));if(!v.json)io.out(`Review: ${cfg.reviewUrl}`);return 0;
 }
 const token=io.env.ARTYFACT_ADMIN_TOKEN;if(!token)throw new CliError('ARTYFACT_ADMIN_TOKEN is required for this scoped administrative command');assertToken(token);
 const system=id('system',v.system??io.env.ARTYFACT_SYSTEM);const base=await resolvePlatform(v.platform,io.env,io.fetch??fetch,io.err);const client=new PlatformClient(base,token);let result:unknown;
 if(command==='evolution'){
  const root=`/api/systems/${encodeURIComponent(system)}`;
  if(action==='create'){if(!v.file)throw new CliError('--file evolution.json is required');const body=readJson(v.file,io);result=await client.request<{evolution:{id:string}}>('POST',`${root}/evolutions`,{...body,kind:'genome-amendment'});io.out(`Review: ${base}/s/${encodeURIComponent(system)}/r/head/work?evolution=${encodeURIComponent((result as {evolution:{id:string}}).evolution.id)}`);}
  else if(action==='propose'){if(!v.file)throw new CliError('--file intent.json is required');result=await client.request<{id:string}>('POST',`${root}/intents`,readJson(v.file,io));io.out(`Review: ${base}/s/${encodeURIComponent(system)}/r/head/work?panel=intent&proposal=${encodeURIComponent((result as {id:string}).id)}`);}
  else if(action==='show')result=await client.request('GET',`${root}/intents/${encodeURIComponent(id('proposal',p[1]))}`);else throw new CliError('usage: artyfact evolution create|propose|show --system sid');
 }else if(command==='plan'){
  if(action==='list')result=await client.request('GET',lifecyclePaths.plans(system));
  else if(action==='create'){if(!v.file)throw new CliError('--file plan.json is required');const body=readJson(v.file,io) as CreateRealizationPlanRequest;result=await client.request<RealizationPlan>('POST',lifecyclePaths.plans(system),body);io.out(`Review: ${reviewLink(base,system,(result as RealizationPlan).id)}`);}
  else {const plan=id('plan',p[1]);if(action==='show')result=await client.request('GET',lifecyclePaths.plan(system,plan));else if(action==='review')result=await client.request('GET',lifecyclePaths.review(system,plan));else if(action==='integrate')result=await client.request('POST',lifecyclePaths.integrate(system,plan),{});else if(action==='promote'){if(!v.file)throw new CliError('--file reviewed-promotion.json is required');result=await client.request('POST',lifecyclePaths.promote(system,plan),readJson(v.file,io));}else throw new CliError('usage: artyfact plan create|list|show|integrate|review|promote');io.out(`Review: ${reviewLink(base,system,plan)}`);}
 }else if(command==='task'){
  const plan=id('plan',p[1]),task=id('task',p[2]);
  if(action==='select')result=await client.request('POST',lifecyclePaths.action(system,plan,task,'select'),{candidateId:id('candidate',v.candidate)});
  else if(action==='claim'||action==='start'||action==='resume'){
   const dir=resolve(io.cwd,v.dir??task);if(existsSync(dir)&&lstatSync(dir).isSymbolicLink())throw new CliError('refusing symlinked workspace');let prior:LocalTask|undefined;
   if(existsSync(dir)&&readdirSync(dir).length){prior=local({...io,cwd:dir});if(prior.systemId!==system||prior.planId!==plan||prior.taskId!==task)throw new CliError('workspace belongs to another task');}
   const res=await client.request<TaskStartResponse>('POST',lifecyclePaths.action(system,plan,task,action),{agentLabel:v['agent-label']??'local agent'});
   const remote=assertRemote('task remote',res.remote,io.env),secret=assertSecret(res.secret),writeToken=assertToken(res.token.value);
   if(prior){if(prior.remote!==remote||git(dir,['config','--get','remote.origin.url'])!==remote)throw new CliError('resumed workspace remote differs; preserve work and choose a new --dir');}else{mkdirSync(dir,{recursive:true});git(io.cwd,['clone','--',remote,dir],writeToken);}
   for(const sub of ['.git','.git/info'])if(!lstatSync(join(dir,sub)).isDirectory()||lstatSync(join(dir,sub)).isSymbolicLink())throw new CliError('refusing unsafe git workspace');
   if(isTracked(dir,CONFIG)||isTracked(dir,'TASK_PACKET.md'))throw new CliError('refusing tracked task configuration or packet; do not store attempt credentials in source');
   const cfg:LocalTask={platform:base,systemId:system,planId:plan,taskId:task,attemptId:res.attempt.id,generation:res.attempt.generation,remote,secret,reviewUrl:res.reviewUrl};
   const exclude=join(dir,'.git/info/exclude'),existing=readFileSync(exclude,'utf8');write(exclude,`${existing}\n${[CONFIG,'TASK_PACKET.md','AGENTS.md',...WORKSPACE_IGNORES].join('\n')}\n`);
   const scrub=(s:string)=>s.replaceAll(secret,'***').replaceAll(writeToken,'***');write(join(dir,'TASK_PACKET.md'),scrub(res.packet.markdown));
   const agents=join(dir,'AGENTS.md');write(agents,mergeAgentsBlock(existsSync(agents)?readFileSync(agents,'utf8'):'',scrub(`Read TASK_PACKET.md. Implement only the pinned Genome, permitted paths, and Task scope. Run its checks. Checkpoint with npx artyfact task checkpoint "<message>". Submit with npx artyfact task submit; set ARTYFACT_TOKEN to the current task write token before push. Never approve an Evolution, integrate, or promote without review. Return the durable review link: ${res.reviewUrl}`),'artyfact-task'));
   write(join(dir,CONFIG),JSON.stringify(cfg,null,2)+'\n',0o600);if(v.json){io.out(JSON.stringify({workspace:dir,attemptId:res.attempt.id,generation:res.attempt.generation,token:writeToken,secret,reviewUrl:res.reviewUrl}));return 0;}
   io.out(`Task workspace ready: ${dir}`);io.out(`Review: ${res.reviewUrl}`);io.out('The write token is not stored. Run task resume with --json for a one-time credential handoff; set ARTYFACT_TOKEN from its token field.');return 0;
  }else throw new CliError('usage: artyfact task claim|start|resume <plan> <task> | checkpoint <message> | submit | select <plan> <task> --candidate id');
 }else if(command==='ontology'){
  const root=`/api/systems/${encodeURIComponent(system)}/ontology-imports`;
  if(action==='bootstrap'){
   const review=await client.request<OntologyImportReview>('GET',`${root}/${encodeURIComponent(id('import',p[1]))}`);
   if(review.status!=='accepted'||review.systemId!==system||!review.genomeFiles)throw new CliError('bootstrap requires an accepted import for this System with reviewed Genome files');
   if(!v.dir)throw new CliError('--dir new-project is required');const dir=resolve(io.cwd,v.dir);if(existsSync(dir))throw new CliError('bootstrap destination already exists; choose an empty new directory');
   const entries=Object.entries(review.genomeFiles);if(entries.length>1000||entries.some(([path,content])=>!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(segment=>segment==='..'||segment==='.'||segment==='.git'||!segment)||typeof content!=='string'||content.length>1024*1024))throw new CliError('unsafe or oversized reviewed Genome path');
   mkdirSync(join(dir,'genome'),{recursive:true});for(const [path,content] of entries){const target=join(dir,'genome',path);mkdirSync(dirname(target),{recursive:true});write(target,content);}
   io.out(`Reviewed Genome materialized in ${dir}/genome`);return await initCommand(['--dir',dir,'--platform',base],io);
  }else if(action==='preview'){if(!v.file)throw new CliError('--file native-package.json is required');result=await client.request<OntologyImportReview>('POST',`${root}/preview`,(()=>{const input=readJson(v.file,io);return input&&typeof input==='object'&&Object.hasOwn(input,'package')?input:{package:input};})());io.out(`Review: ${base}/start?system=${encodeURIComponent(system)}&import=${encodeURIComponent((result as OntologyImportReview).id)}`);}
  else if(action==='list')result=await client.request('GET',root);else if(action==='show')result=await client.request('GET',`${root}/${encodeURIComponent(id('import',p[1]))}`);else if(action==='accept'){if(!v.hash)throw new CliError('--hash from the reviewed preview is required');result=await client.request('POST',`${root}/${encodeURIComponent(id('import',p[1]))}/accept`,{hash:v.hash});}else throw new CliError('usage: artyfact ontology preview|list|show|accept|bootstrap');
 }else if(command==='operations'){
  const query=new URLSearchParams();for(const name of ['from','to','before','cursor','limit'] as const)if(v[name]!==undefined)query.set(name,v[name]!);const suffix=query.size?`?${query}`:'';
  if(action==='bindings')result=await client.request('GET',operationsPaths.bindings(system));else{const binding=id('binding',v.binding);if(action==='metrics'||action==='measurements'||action==='flags'||action==='audit')result=await client.request('GET',operationsPaths[action](system,binding)+suffix);else if(action==='flag-create'){if(!v.file)throw new CliError('--file flag.json is required');result=await client.request('POST',operationsPaths.flags(system,binding),readJson(v.file,io));}else if(action==='flag-update'){if(!v.file)throw new CliError('--file update.json is required');result=await client.request('PATCH',operationsPaths.flag(system,binding,id('key',v.key)),readJson(v.file,io));}else if(action==='flag-disable'){if(!v['expected-version']||!v.reason)throw new CliError('--expected-version and --reason are required');result=await client.request('PATCH',operationsPaths.flag(system,binding,id('key',v.key)),{expectedVersion:v['expected-version'],reason:v.reason,patch:{enabled:false}});}else throw new CliError('usage: artyfact operations bindings|metrics|measurements|flags|audit|flag-create|flag-update|flag-disable');}
 }else throw new CliError(`unknown lifecycle command ${command}`);
 io.out(JSON.stringify(result,null,2));return 0;
}
