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
  const first=await run(['task','start','plan.one','task.one','--system','system.one','--dir',dir,'--json']);expect(first.err).toBe('');expect(first.code).toBe(0);expect(first.out).not.toContain(token);
  writeFileSync(join(dir,'app.ts'),'user work');const resumed=await run(['task','resume','plan.one','task.one','--system','system.one','--dir',dir,'--json']);expect(resumed.code).toBe(0);expect(readFileSync(join(dir,'app.ts'),'utf8')).toBe('user work');
  sh(dir,'config','user.name','test');sh(dir,'config','user.email','test@test');const checkpoint=await run(['task','checkpoint','Saved user work'],dir);expect(checkpoint.code).toBe(0);expect(calls.at(-1)).toMatchObject({auth:`Bearer ${secret2}`,body:{attemptId:'attempt.2',generation:2}});
  writeFileSync(join(dir,'next.ts'),'next');const submit=await run(['task','submit'],dir);expect(submit.err).toBe('');expect(submit.out+submit.err+checkpoint.out+checkpoint.err+resumed.out+first.err).not.toContain(token);expect(submit.code).toBe(0);expect(sh(bare,'rev-parse','main')).toBe(sh(dir,'rev-parse','HEAD'));
  expect(JSON.parse(readFileSync(join(dir,'.git/artyfact-task.json'),'utf8')).token).toBe(token);for(const f of ['TASK_PACKET.md','AGENTS.md'])expect(readFileSync(join(dir,f),'utf8')).not.toContain(token);expect(statSync(join(dir,'.git/artyfact-task.json')).mode&0o777).toBe(0o600);expect(sh(dir,'ls-files')).not.toContain('.artyfact-task.json');expect(sh(dir,'status','--porcelain')).toBe('');
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

// ---- plan draft / plan tasks / claim hygiene, against a fake HTTP server ------------------------------------------------
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
interface Hit { method: string; url: string; auth: string | undefined; body: any }
async function fake(handler: (hit: Hit) => [number, unknown]): Promise<{ base: string; hits: Hit[]; close: () => Promise<void> }> {
 const hits: Hit[] = [];
 const server: Server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
   const raw = Buffer.concat(chunks).toString();
   const hit: Hit = { method: req.method!, url: req.url!, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined };
   hits.push(hit);
   const [status, json] = handler(hit);
   res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json));
  });
 });
 await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
 const port = (server.address() as { port: number }).port;
 return { base: `http://127.0.0.1:${port}`, hits, close: () => new Promise<void>(r => server.close(() => r())) };
}
const cli = async (args: string[], env: Record<string, string>, at = cwd) => {
 const out: string[] = [], err: string[] = [];
 const code = await main(args, { cwd: at, env, out: s => out.push(s), err: s => err.push(s) });
 return { code, out: out.join('\n'), err: err.join('\n') };
};
const footprint = (artifactId: string, globs: string[]) => ({ repo: 'app', artifactId, globs, paths: [], unmatched: [], known: true });
const draftResponse = {
 request: { title: 'Realize accepted Genome', genomeCommit: 'g1', tasks: [
  { id: 'task.a', title: 'Schema', artifactId: 'artifact.web', steps: ['s'], dependsOn: [], readNodes: [], writeNodes: ['thing.a'], checks: [] },
  { id: 'task.b', title: 'Screens', artifactId: 'artifact.web', steps: ['s'], dependsOn: ['task.a'], readNodes: [], writeNodes: ['thing.b'], checks: [] },
 ] },
 analysis: { conflicts: [{ tasks: ['task.a', 'task.b'], kind: 'dependency', subjects: ['src/db.ts'], message: 'b builds on a' }], waves: [['task.a'], ['task.b']] },
 problems: [{ taskId: 'task.b', severity: 'warning', message: 'footprint unknown for thing.b' }],
 provenance: { planner: { provider: 'fake', model: 'fake' }, genomeCommit: 'g1', evolutionIds: ['evo.1'], nodes: ['thing.x'], fake: true, fallback: false },
};

it('plan draft prints tasks, waves and problems and saves nothing without --create', async () => {
 const srv = await fake(() => [200, draftResponse]);
 try {
  const r = await cli(['plan', 'draft', '--system', 'system.one', '--evolution', 'evo.1', '--evolution', 'evo.2', '--node', 'thing.x', '--hint', 'api first', '--platform', srv.base], { ARTYFACT_ADMIN_TOKEN: 'admin' });
  expect(r.err).toBe(''); expect(r.code).toBe(0);
  expect(srv.hits).toHaveLength(1);
  expect(srv.hits[0]).toMatchObject({ method: 'POST', url: '/api/systems/system.one/realization-plans/draft', auth: 'Bearer admin', body: { evolutionIds: ['evo.1', 'evo.2'], nodes: ['thing.x'], hint: 'api first' } });
  expect(r.out).toMatch(/task\.a\s+Schema\s+1\s+-\s+thing\.a/);
  expect(r.out).toMatch(/task\.b\s+Screens\s+2\s+task\.a\s+thing\.b/);
  expect(r.out).toContain('wave 2: task.b');
  expect(r.out).toContain('conflicts: task.a <-> task.b [dependency] src/db.ts: b builds on a');
  expect(r.out).toContain('warning (task.b): footprint unknown for thing.b');
  expect(r.out).toContain('Nothing was saved');
 } finally { await srv.close(); }
});

it('plan draft --create posts the draft request unchanged and prints the plan id', async () => {
 const srv = await fake(h => h.url.endsWith('/draft') ? [200, draftResponse] : [201, { id: 'plan.new' }]);
 try {
  const r = await cli(['plan', 'draft', '--system', 'system.one', '--create', '--platform', srv.base], { ARTYFACT_ADMIN_TOKEN: 'admin' });
  expect(r.err).toBe(''); expect(r.code).toBe(0);
  expect(srv.hits.map(h => `${h.method} ${h.url}`)).toEqual(['POST /api/systems/system.one/realization-plans/draft', 'POST /api/systems/system.one/realization-plans']);
  expect(srv.hits[1]!.body).toEqual(draftResponse.request);
  expect(r.out).toContain('plan: plan.new');
  expect(r.out).toContain('/s/system.one/r/head/work?plan=plan.new');
  const needsAdmin = await cli(['plan', 'draft', '--system', 'system.one', '--platform', srv.base], {});
  expect(needsAdmin.code).toBe(1); expect(srv.hits).toHaveLength(2);
 } finally { await srv.close(); }
});

const planFixture = {
 id: 'plan.one', systemId: 'system.one', status: 'implementing',
 analysis: { conflicts: [{ tasks: ['task.b', 'task.c'], kind: 'source', subjects: ['src/ui.ts'], message: 'both write src/ui.ts' }], waves: [['task.a'], ['task.b', 'task.c']] },
 tasks: [
  { id: 'task.a', status: 'pending', dependsOn: [], writeNodes: ['thing.a'], footprint: footprint('artifact.web', ['src/db/**']) },
  { id: 'task.b', status: 'pending', dependsOn: ['task.a'], writeNodes: ['thing.b'], footprint: footprint('artifact.web', ['src/ui.ts']) },
  { id: 'task.c', status: 'working', dependsOn: ['task.a'], writeNodes: ['thing.c', 'thing.d'], footprint: footprint('artifact.web', []) },
 ],
};

it('plan tasks prints the table, conflicts and the next claimable task, without any token', async () => {
 const srv = await fake(() => [200, planFixture]);
 try {
  const r = await cli(['plan', 'tasks', 'plan.one', '--system', 'system.one', '--platform', srv.base], {});
  expect(r.err).toBe(''); expect(r.code).toBe(0);
  expect(srv.hits[0]).toMatchObject({ method: 'GET', url: '/api/systems/system.one/realization-plans/plan.one', auth: undefined });
  expect(r.out.split('\n')[0]).toMatch(/^task\s+status\s+wave\s+depends-on\s+write nodes\s+footprint$/);
  expect(r.out).toMatch(/task\.a\s+pending\s+1\s+-\s+thing\.a\s+src\/db\/\*\*/);
  expect(r.out).toMatch(/task\.b\s+pending\s+2\s+task\.a\s+thing\.b\s+src\/ui\.ts/);
  expect(r.out).toMatch(/task\.c\s+working\s+2\s+task\.a\s+thing\.c,thing\.d\s+-/);
  expect(r.out).toContain('conflicts: task.b <-> task.c [source] src/ui.ts: both write src/ui.ts');
  expect(r.out).toMatch(/claim: .*task claim plan\.one task\.a --system system\.one /);
  expect(r.out).toContain('claim: ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact task claim plan.one task.a');
  expect(r.out).not.toContain('task claim plan.one task.b');
  const json = JSON.parse((await cli(['plan', 'tasks', 'plan.one', '--system', 'system.one', '--platform', srv.base, '--json'], {})).out);
  expect(json).toMatchObject({ planId: 'plan.one', next: 'task.a', tasks: [{ id: 'task.a', wave: 1 }, { id: 'task.b', wave: 2 }, { id: 'task.c', wave: 2 }] });
 } finally { await srv.close(); }
});

it('plan tasks quotes a hostile plan or task id in the printed claim line', async () => {
 const evil = "task.a'$(touch pwned)";
 const hostile = JSON.parse(JSON.stringify(planFixture).replaceAll('"task.a"', JSON.stringify(evil)).replaceAll('"plan.one"', '"plan one;x"'));
 const srv = await fake(() => [200, hostile]);
 try {
  const r = await cli(['plan', 'tasks', 'plan.one', '--system', 'system.one', '--platform', srv.base], {});
  expect(r.code).toBe(0);
  const q = `'task.a'\\''$(touch pwned)'`;
  expect(r.out).toContain(`task claim 'plan one;x' ${q} --system system.one --dir './work/${q.slice(1)} --agent-label 'claude:${q.slice(1)}`);
 } finally { await srv.close(); }
});

it('plan tasks names no claim when every pending task waits on a dependency', async () => {
 const waiting = { ...planFixture, tasks: planFixture.tasks.map(t => t.id === 'task.a' ? { ...t, status: 'working' } : t) };
 const srv = await fake(() => [200, waiting]);
 try {
  const r = await cli(['plan', 'tasks', 'plan.one', '--system', 'system.one', '--platform', srv.base], {});
  expect(r.out).toContain('claim: no task is claimable now');
 } finally { await srv.close(); }
});

it('claim turns blocked, taken and interference refusals into friendly one-line errors', async () => {
 const dir = join(cwd, 'friendly');
 const refusal = (details: object) => fake(() => [409, { error: { code: 'invalid-state', message: 'refused', details } }]);
 const blocked = await refusal({ blockedOn: ['task.a', 'task.x'] });
 const taken = await refusal({ by: 'claude:task.b' });
 const interfering = await refusal({ taskId: 'task.c', by: null });
 try {
  const claim = (base: string) => cli(['task', 'claim', 'plan.one', 'task.b', '--system', 'system.one', '--dir', dir, '--platform', base], { ARTYFACT_ADMIN_TOKEN: 'admin' });
  const a = await claim(blocked.base);
  expect(a.code).toBe(1); expect(a.err).toContain('blocked by task.a, task.x (not yet selected)');
  const b = await claim(taken.base);
  expect(b.code).toBe(1); expect(b.err).toContain('task task.b is taken by claude:task.b');
  const c = await claim(interfering.base);
  expect(c.code).toBe(1); expect(c.err).toContain('task task.b conflicts with task.c, held by an unnamed agent');
  expect(existsSync(dir)).toBe(false);
 } finally { await blocked.close(); await taken.close(); await interfering.close(); }
});

it('plan tasks skips a task whose conflicting task holds a live attempt', async () => {
 const live = { id: 'attempt.1', status: 'working', agentLabel: 'claude:task.c', leaseExpiresAt: '2099-01-01T00:00:00Z' };
 const plan = { ...planFixture, tasks: planFixture.tasks.map(t => t.id === 'task.a' ? { ...t, status: 'selected' } : t.id === 'task.c' ? { ...t, attempts: [live] } : t) };
 const srv = await fake(() => [200, plan]);
 try {
  const r = await cli(['plan', 'tasks', 'plan.one', '--system', 'system.one', '--platform', srv.base], {});
  expect(r.out).toContain('claim: no task is claimable now');
  const lapsed = { ...plan, tasks: plan.tasks.map(t => t.id === 'task.c' ? { ...t, attempts: [{ ...live, leaseExpiresAt: '2000-01-01T00:00:00Z' }] } : t) };
  const srv2 = await fake(() => [200, lapsed]);
  try { expect((await cli(['plan', 'tasks', 'plan.one', '--system', 'system.one', '--platform', srv2.base], {})).out).toMatch(/claim: .*task claim plan\.one task\.b /); } finally { await srv2.close(); }
 } finally { await srv.close(); }
});

it('claim validates the target directory before any HTTP call', async () => {
 const srv = await fake(() => [500, {}]);
 try {
  const foreign = join(cwd, 'foreign-dir'); mkdirSync(foreign); writeFileSync(join(foreign, 'notes.txt'), 'mine');
  const a = await cli(['task', 'claim', 'plan.one', 'task.a', '--system', 'system.one', '--dir', foreign, '--platform', srv.base], { ARTYFACT_ADMIN_TOKEN: 'admin' });
  expect(a.code).toBe(1); expect(a.err).toContain('not empty');
  const file = join(cwd, 'a-file'); writeFileSync(file, 'x');
  const b = await cli(['task', 'claim', 'plan.one', 'task.a', '--system', 'system.one', '--dir', file, '--platform', srv.base], { ARTYFACT_ADMIN_TOKEN: 'admin' });
  expect(b.code).toBe(1); expect(b.err).toContain('not a directory');
  const other = join(cwd, 'other-task'); mkdirSync(join(other, '.git'), { recursive: true });
  writeFileSync(join(other, '.artyfact-task.json'), JSON.stringify({ platform: srv.base, systemId: 'system.one', planId: 'plan.one', taskId: 'task.z', attemptId: 'a', generation: 1, remote: `https://${'a'.repeat(32)}.artifacts.cloudflare.net/git/ns/t.git`, secret: 'a1'.repeat(32), reviewUrl: 'u' }));
  const c = await cli(['task', 'claim', 'plan.one', 'task.a', '--system', 'system.one', '--dir', other, '--platform', srv.base], { ARTYFACT_ADMIN_TOKEN: 'admin' });
  expect(c.code).toBe(1); expect(c.err).toContain('another task');
  const locked = join(cwd, 'locked-parent'); mkdirSync(locked); writeFileSync(join(locked, 'f'), 'x');
  const d = await cli(['task', 'claim', 'plan.one', 'task.a', '--system', 'system.one', '--dir', join(locked, 'f', 'sub'), '--platform', srv.base], { ARTYFACT_ADMIN_TOKEN: 'admin' });
  expect(d.code).toBe(1); expect(d.err).toContain('cannot inspect');
  expect(srv.hits).toHaveLength(0);
 } finally { await srv.close(); }
});

it('a claim whose clone fails removes the half-made workspace and names the resume command', async () => {
 const sh = (at: string, ...args: string[]) => execFileSync('git', ['-C', at, ...args], { encoding: 'utf8' }).trim();
 const source = join(cwd, 'cf-source'), bare = join(cwd, 'cf.git'), dir = join(cwd, 'cf work');
 mkdirSync(source); sh(cwd, 'init', '--bare', '-q', bare); sh(source, 'init', '-q', '-b', 'main'); writeFileSync(join(source, 'app.ts'), 'base'); sh(source, 'add', 'app.ts');
 sh(source, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base'); sh(source, 'push', '-q', bare, 'HEAD:main'); sh(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
 const remote = `https://${'d'.repeat(32)}.artifacts.cloudflare.net/git/ns/cf.git`, token = 'CF-WRITE-TOKEN-0123456789';
 const srv = await fake(() => [200, { attempt: { id: 'attempt.1', generation: 1 }, secret: 'd4'.repeat(32), token: { value: token, remote, expiresAt: '2099-01-01T00:00:00Z' }, remote, packet: { markdown: 'packet' }, reviewUrl: 'http://localhost/review' }]);
 const old = { c: process.env.GIT_CONFIG_COUNT, k: process.env.GIT_CONFIG_KEY_0, v: process.env.GIT_CONFIG_VALUE_0 };
 process.env.GIT_CONFIG_COUNT = '1'; process.env.GIT_CONFIG_KEY_0 = `url.${join(cwd, 'missing.git')}.insteadOf`; process.env.GIT_CONFIG_VALUE_0 = remote;
 try {
  const claim = await cli(['task', 'claim', 'plan.one', 'task.a', '--system', 'system.one', '--dir', dir, '--platform', srv.base], { ARTYFACT_ADMIN_TOKEN: 'admin' });
  expect(claim.code).toBe(1);
  expect(claim.err).toContain('claim landed but the workspace could not be cloned');
  expect(claim.err).toContain(`artyfact task resume plan.one task.a --system system.one --dir '${dir}'`);
  expect(claim.err).not.toContain(token);
  expect(existsSync(dir)).toBe(false);
  process.env.GIT_CONFIG_KEY_0 = `url.${bare}.insteadOf`;
  const resume = await cli(['task', 'resume', 'plan.one', 'task.a', '--system', 'system.one', '--dir', dir, '--platform', srv.base], { ARTYFACT_ADMIN_TOKEN: 'admin' });
  expect(resume.err).toBe(''); expect(resume.code).toBe(0);
  expect(existsSync(join(dir, '.git/artyfact-task.json'))).toBe(true);
  expect(srv.hits.map(h => h.url.split('/').at(-1))).toEqual(['claim', 'resume']);
 } finally {
  for (const [k, v] of [['GIT_CONFIG_COUNT', old.c], ['GIT_CONFIG_KEY_0', old.k], ['GIT_CONFIG_VALUE_0', old.v]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  await srv.close();
 }
});

it('a .gitignore negation never stages the task config: the legacy root file moves into .git and a root copy is left out', async () => {
 const sh = (at: string, ...args: string[]) => execFileSync('git', ['-C', at, ...args], { encoding: 'utf8' }).trim();
 const source = join(cwd, 'neg-source'), bare = join(cwd, 'neg.git'), dir = join(cwd, 'neg-work');
 mkdirSync(source); sh(cwd, 'init', '--bare', '-q', bare); sh(source, 'init', '-q', '-b', 'main'); writeFileSync(join(source, 'app.ts'), 'base'); sh(source, 'add', 'app.ts');
 sh(source, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base'); sh(source, 'push', '-q', bare, 'HEAD:main'); sh(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
 const remote = `https://${'e'.repeat(32)}.artifacts.cloudflare.net/git/ns/neg.git`, token = 'NEG-WRITE-TOKEN-0123456789';
 const srv = await fake(h => h.url.endsWith('/claim')
  ? [200, { attempt: { id: 'attempt.1', generation: 1 }, secret: 'e5'.repeat(32), token: { value: token, remote, expiresAt: '2099-01-01T00:00:00Z' }, remote, packet: { markdown: 'packet' }, reviewUrl: 'http://localhost/review' }]
  : [200, { task: { status: 'submitted' }, candidate: { id: 'candidate.1' }, evaluations: [] }]);
 const old = { c: process.env.GIT_CONFIG_COUNT, k: process.env.GIT_CONFIG_KEY_0, v: process.env.GIT_CONFIG_VALUE_0 };
 process.env.GIT_CONFIG_COUNT = '1'; process.env.GIT_CONFIG_KEY_0 = `url.${bare}.insteadOf`; process.env.GIT_CONFIG_VALUE_0 = remote;
 try {
  expect((await cli(['task', 'claim', 'plan.one', 'task.a', '--system', 'system.one', '--dir', dir, '--platform', srv.base], { ARTYFACT_ADMIN_TOKEN: 'admin' })).code).toBe(0);
  // A workspace from before the move: the config at the root, and a .gitignore that un-ignores it.
  renameSync(join(dir, '.git/artyfact-task.json'), join(dir, '.artyfact-task.json'));
  writeFileSync(join(dir, '.gitignore'), '!.artyfact-task.json\n'); sh(dir, 'config', 'user.name', 't'); sh(dir, 'config', 'user.email', 't@t');
  const first = await cli(['task', 'submit'], {}, dir);
  expect(first.err).toBe(''); expect(first.code).toBe(0);
  expect(existsSync(join(dir, '.artyfact-task.json'))).toBe(false);
  expect(statSync(join(dir, '.git/artyfact-task.json')).mode & 0o777).toBe(0o600);
  // A root copy written later is still never staged.
  writeFileSync(join(dir, '.artyfact-task.json'), readFileSync(join(dir, '.git/artyfact-task.json'))); writeFileSync(join(dir, 'more.ts'), 'more');
  const second = await cli(['task', 'submit'], {}, dir);
  expect(second.code).toBe(0); expect(second.err).toContain('not staged');
  expect(sh(bare, 'ls-tree', '-r', '--name-only', 'main')).not.toContain('artyfact-task.json');
  expect(sh(bare, 'log', '-p', 'main')).not.toContain(token);
 } finally {
  for (const [k, v] of [['GIT_CONFIG_COUNT', old.c], ['GIT_CONFIG_KEY_0', old.k], ['GIT_CONFIG_VALUE_0', old.v]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  await srv.close();
 }
});

it('claim stores the write token only in .git/artyfact-task.json, writes packet.agentsMd, and submit works without ARTYFACT_TOKEN', async () => {
 const sh = (at: string, ...args: string[]) => execFileSync('git', ['-C', at, ...args], { encoding: 'utf8' }).trim();
 const source = join(cwd, 'hyg-source'), bare = join(cwd, 'hyg.git'), dir = join(cwd, 'hyg-work');
 mkdirSync(source); sh(cwd, 'init', '--bare', '-q', bare); sh(source, 'init', '-q', '-b', 'main'); writeFileSync(join(source, 'app.ts'), 'base'); sh(source, 'add', 'app.ts');
 sh(source, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base'); sh(source, 'push', '-q', bare, 'HEAD:main'); sh(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
 const remote = `https://${'b'.repeat(32)}.artifacts.cloudflare.net/git/ns/hyg.git`;
 const token = 'WRITE-TOKEN-0123456789abcdef', secret = 'c3'.repeat(32), admin = 'ADMIN-TOKEN-xyz';
 const srv = await fake(h => {
  if (h.url.endsWith('/claim')) return [200, { attempt: { id: 'attempt.1', generation: 1 }, secret, token: { value: token, remote, expiresAt: '2099-01-01T00:00:00Z' }, remote,
   packet: { markdown: `Task packet. Leaked on purpose: ${token} and ${secret} and ${admin}`, agentsMd: `# Task agents file\nUse ${token} carefully. Review: http://x/r` }, reviewUrl: 'http://localhost/review' }];
  return [200, { task: { status: 'submitted' }, candidate: { id: 'candidate.1' }, evaluations: [] }];
 });
 const old = { c: process.env.GIT_CONFIG_COUNT, k: process.env.GIT_CONFIG_KEY_0, v: process.env.GIT_CONFIG_VALUE_0 };
 process.env.GIT_CONFIG_COUNT = '1'; process.env.GIT_CONFIG_KEY_0 = `url.${bare}.insteadOf`; process.env.GIT_CONFIG_VALUE_0 = remote;
 try {
  const claim = await cli(['task', 'claim', 'plan.one', 'task.a', '--system', 'system.one', '--dir', dir, '--platform', srv.base], { ARTYFACT_ADMIN_TOKEN: admin });
  expect(claim.err).toBe(''); expect(claim.code).toBe(0);
  expect(srv.hits[0]!.auth).toBe(`Bearer ${admin}`);
  expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('# Task agents file');
  expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).not.toContain('Never approve an Evolution');
  sh(dir, 'config', 'user.name', 't'); sh(dir, 'config', 'user.email', 't@t'); writeFileSync(join(dir, 'new.ts'), 'work');
  const submit = await cli(['task', 'submit'], {}, dir);
  expect(submit.err).toBe(''); expect(submit.code).toBe(0);
  expect(sh(bare, 'rev-parse', 'main')).toBe(sh(dir, 'rev-parse', 'HEAD'));
  expect(srv.hits.at(-1)!.auth).toBe(`Bearer ${secret}`);
  for (const secretText of [token, admin]) expect(claim.out + claim.err + submit.out + submit.err).not.toContain(secretText);
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const holders = walk(dir).filter(f => readFileSync(f).includes(token));
  expect(holders).toEqual([join(dir, '.git/artyfact-task.json')]);
  expect(walk(dir).filter(f => readFileSync(f).includes(admin))).toEqual([]);
  expect(statSync(join(dir, '.git/artyfact-task.json')).mode & 0o777).toBe(0o600);
  expect(sh(dir, 'ls-files')).not.toContain('.artyfact-task.json');
  expect(readFileSync(join(dir, 'TASK_PACKET.md'), 'utf8')).not.toContain(token);
  // an environment token takes precedence over the stored one
  expect((await cli(['task', 'submit'], { ARTYFACT_TOKEN: 'bad token!' }, dir)).code).toBe(1);
 } finally {
  await srv.close();
  for (const [key, value] of [['GIT_CONFIG_COUNT', old.c], ['GIT_CONFIG_KEY_0', old.k], ['GIT_CONFIG_VALUE_0', old.v]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
 }
});
