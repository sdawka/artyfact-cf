import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { main } from '../src/main.ts';
const cwd=mkdtempSync(join(tmpdir(),'artyfact-life-'));
afterEach(()=>vi.unstubAllGlobals());
it('creates a pinned plan through the scoped API and returns its durable review link',async()=>{
 const file=join(cwd,'plan.json'); writeFileSync(file,JSON.stringify({title:'Implement accepted Genome',tasks:[]}));
 const calls: {url:string;init?:RequestInit}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{calls.push({url,init});return Response.json({id:'plan.one'});}));
 const out:string[]=[],err:string[]=[];
 const code=await main(['plan','create','--system','system.one','--file',file,'--platform','http://localhost:1337'],{cwd,env:{ARTYFACT_ADMIN_TOKEN:'admin'},out:s=>out.push(s),err:s=>err.push(s)});
 expect(err).toEqual([]);expect(code).toBe(0);
 expect(calls[0]?.url).toBe('http://localhost:1337/api/systems/system.one/realization-plans');
 expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer admin');
 expect(out.join('\n')).toContain('/s/system.one/r/head/work?plan=plan.one');
});
it('previews a native import without accepting it',async()=>{
 const file=join(cwd,'ontology.json');writeFileSync(file,JSON.stringify({format:'artyfact.ontology-package@1',id:'custom',version:'1',dependencies:[],templates:{}}));
 const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string)=>{calls.push(url);return Response.json({id:'import.one',systemId:'system.one',status:'review',issues:[],templateRefs:[],pin:{id:'custom',version:'1',hash:'abc'}});}));
 const out:string[]=[]; const code=await main(['ontology','preview','--system','system.one','--file',file,'--platform','http://localhost:1337'],{cwd,env:{ARTYFACT_ADMIN_TOKEN:'admin'},out:s=>out.push(s),err:()=>{}});
 expect(code).toBe(0);expect(calls).toEqual(['http://localhost:1337/api/systems/system.one/ontology-imports/preview']);expect(out.join('\n')).toContain('import=import.one');
});
it('rejects missing credentials before sending an administrative write',async()=>{
 const send=vi.fn();vi.stubGlobal('fetch',send);const err:string[]=[];
 expect(await main(['plan','integrate','plan.one','--system','system.one','--platform','http://localhost:1337'],{cwd,env:{},out:()=>{},err:s=>err.push(s)})).toBe(1);
 expect(err.join('\n')).toContain('ARTYFACT_ADMIN_TOKEN');expect(send).not.toHaveBeenCalled();
});
it('new Evolutions are Genome-only even when a client file asks for mixed implementation',async()=>{
 const file=join(cwd,'evolution.json');writeFileSync(file,JSON.stringify({title:'New model',intent:'Change vocabulary',kind:'mixed',risk:'low'}));
 const calls:{body:unknown}[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{calls.push({body:JSON.parse(String(init?.body))});return Response.json({evolution:{id:'evolution.one'}});}));
 const code=await main(['evolution','create','--system','system.one','--file',file,'--platform','http://localhost:1337'],{cwd,env:{ARTYFACT_ADMIN_TOKEN:'admin'},out:()=>{},err:()=>{}});
 expect(code).toBe(0);expect(calls[0]?.body).toMatchObject({kind:'genome-amendment'});
});
it('bootstrap refuses invalid reviews before writing or provisioning resources',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'import.bad',systemId:'system.one',status:'invalid',genomeFiles:{'node.yaml':'bad'}})));
 const err:string[]=[];const code=await main(['ontology','bootstrap','import.bad','--system','system.one','--dir','bootstrap-bad','--platform','http://localhost:1337'],{cwd,env:{ARTYFACT_ADMIN_TOKEN:'admin'},out:()=>{},err:s=>err.push(s)});
 expect(code).toBe(1);expect(err.join('\n')).toContain('accepted import');
});
it('starts and resumes one task fork with fenced credentials, checkpoints, and submits real Git commits',async()=>{
 const {execFileSync}=await import('node:child_process');const {mkdirSync,readFileSync,readdirSync,statSync}=await import('node:fs');
 const dir=join(cwd,'task-real'),source=join(cwd,'source'),bare=join(cwd,'task.git');mkdirSync(source);const sh=(at:string,...args:string[])=>execFileSync('git',['-C',at,...args],{encoding:'utf8'}).trim();
 sh(cwd,'init','--bare','-q',bare);sh(source,'init','-q','-b','main');writeFileSync(join(source,'app.ts'),'base');sh(source,'add','app.ts');sh(source,'-c','user.name=test','-c','user.email=test@test','commit','-q','-m','base');sh(source,'push','-q',bare,'HEAD:main');sh(bare,'symbolic-ref','HEAD','refs/heads/main');
 const remote=`https://${'a'.repeat(32)}.artifacts.cloudflare.net/git/ns/task.git`,secret='a1'.repeat(32),secret2='b2'.repeat(32),token='fork-write-token';const calls:{url:string;body:any;auth:string|null}[]=[];let generation=1;
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{calls.push({url,body:init?.body?JSON.parse(String(init.body)):undefined,auth:new Headers(init?.headers).get('authorization')});if(url.endsWith('/start')||url.endsWith('/resume')){if(url.endsWith('/resume'))generation=2;return Response.json({attempt:{id:`attempt.${generation}`,generation},secret:generation===1?secret:secret2,token:{value:token,remote,expiresAt:'2030-01-01'},remote,packet:{markdown:'Pinned Genome and scope'},reviewUrl:'http://localhost:1337/s/system.one/r/head/work?plan=plan.one'});}return Response.json({task:{status:'submitted'},candidate:{id:'candidate.task'},evaluations:[]});}));
 const old={count:process.env.GIT_CONFIG_COUNT,key:process.env.GIT_CONFIG_KEY_0,value:process.env.GIT_CONFIG_VALUE_0};process.env.GIT_CONFIG_COUNT='1';process.env.GIT_CONFIG_KEY_0=`url.${bare}.insteadOf`;process.env.GIT_CONFIG_VALUE_0=remote;
 const run=async(args:string[],at=cwd,env:Record<string,string>={})=>{const out:string[]=[],err:string[]=[];const code=await main(args,{cwd:at,env:{ARTYFACT_ADMIN_TOKEN:'admin',ARTYFACT_PLATFORM:'http://localhost:1337',...env},out:s=>out.push(s),err:s=>err.push(s)});return {code,out:out.join('\n'),err:err.join('\n')};};
 try{
  const first=await run(['task','start','plan.one','task.one','--system','system.one','--dir',dir,'--json']);expect(first.err).toBe('');expect(first.code).toBe(0);expect(JSON.parse(first.out).token).toBe(token);
  writeFileSync(join(dir,'app.ts'),'user work');const resumed=await run(['task','resume','plan.one','task.one','--system','system.one','--dir',dir,'--json']);expect(resumed.code).toBe(0);expect(readFileSync(join(dir,'app.ts'),'utf8')).toBe('user work');
  sh(dir,'config','user.name','test');sh(dir,'config','user.email','test@test');const checkpoint=await run(['task','checkpoint','Saved user work'],dir);expect(checkpoint.code).toBe(0);expect(calls.at(-1)).toMatchObject({auth:`Bearer ${secret2}`,body:{attemptId:'attempt.2',generation:2}});
  writeFileSync(join(dir,'next.ts'),'next');const submit=await run(['task','submit'],dir,{ARTYFACT_TOKEN:token});expect(submit.err).toBe('');expect(submit.code).toBe(0);expect(sh(bare,'rev-parse','main')).toBe(sh(dir,'rev-parse','HEAD'));
  expect(readFileSync(join(dir,'.artyfact-task.json'),'utf8')).not.toContain(token);expect(statSync(join(dir,'.artyfact-task.json')).mode&0o777).toBe(0o600);expect(sh(dir,'ls-files')).not.toContain('.artyfact-task.json');expect(sh(dir,'status','--porcelain')).toBe('');
  writeFileSync(join(dir,'.artyfact-task.json'),'{}');sh(dir,'add','-f','.artyfact-task.json');sh(dir,'commit','-q','-m','unsafe tracked configuration');sh(dir,'push','-q',bare,'HEAD:main');
  const unsafeDir=join(cwd,'unsafe-task');const unsafe=await run(['task','start','plan.one','task.one','--system','system.one','--dir',unsafeDir]);expect(unsafe.code).toBe(1);expect(unsafe.err).toContain('tracked task configuration');expect(readFileSync(join(unsafeDir,'.artyfact-task.json'),'utf8')).toBe('{}');
 }finally{for(const [key,value] of [['GIT_CONFIG_COUNT',old.count],['GIT_CONFIG_KEY_0',old.key],['GIT_CONFIG_VALUE_0',old.value]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}}
});
it('uses scoped operational windows and cursor pagination without fabricating results',async()=>{
 const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string)=>{calls.push(url);return Response.json({state:'partial',flags:[],nextCursor:'more'});}));
 const io={cwd,env:{ARTYFACT_ADMIN_TOKEN:'admin',ARTYFACT_PLATFORM:'http://localhost:1337'},out:()=>{},err:()=>{}};
 expect(await main(['operations','flags','--system','system.one','--binding','artifact.web','--cursor','next page'],io)).toBe(0);
 expect(calls[0]).toBe('http://localhost:1337/api/systems/system.one/operations/bindings/artifact.web/flags?cursor=next+page');
});

it('accepts an import preview envelope containing reviewed Genome files',async()=>{
 const file=join(cwd,'review-envelope.json'),body={package:{format:'artyfact.ontology-package@1'},genomeFiles:{'node.yaml':'id: system.one\nkind: system\n'}};writeFileSync(file,JSON.stringify(body));const calls:unknown[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{calls.push(JSON.parse(String(init?.body)));return Response.json({id:'import.one'});}));
 expect(await main(['ontology','preview','--system','system.one','--file',file,'--platform','http://localhost:1337'],{cwd,env:{ARTYFACT_ADMIN_TOKEN:'admin'},out:()=>{},err:()=>{}})).toBe(0);expect(calls).toEqual([body]);
});
