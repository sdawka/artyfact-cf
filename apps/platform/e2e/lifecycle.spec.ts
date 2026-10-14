import {expect,test} from '@playwright/test';
import {mockApi,SID} from './mockApi';
import AxeBuilder from '@axe-core/playwright';
for(const width of [1440,360])test(`native import review and keyboard flow at ${width}px @fixture`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>sessionStorage.setItem('artyfact.adminToken','test-admin'));
 const accepted:string[]=[];
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;const method=route.request().method();let body:unknown={};
  if(path.endsWith('/systems'))body={systems:[]};
  else if(path.endsWith('/parts'))body={parts:[]};
  else if(path.endsWith('/initial'))body={systemId:'system.custom',status:'import-pending'};
  else if(path.includes('/ontology-imports')){if(method==='POST'&&path.endsWith('/accept'))accepted.push(route.request().postDataJSON().hash);body={id:'import.one',systemId:'system.custom',status:path.endsWith('/accept')?'accepted':'review',pin:{id:'custom',version:'1',hash:'exact-hash'},issues:[],templateRefs:['template.domain@1'],package:{format:'artyfact.ontology-package@1'}};}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/start');await page.getByLabel('System ID').fill('system.custom');await page.getByRole('button',{name:'Create System'}).click();
 await page.getByLabel('Native ontology package').fill('{"format":"artyfact.ontology-package@1"}');await page.getByRole('button',{name:'Preview import'}).click();
 const accept=page.getByRole('button',{name:'Accept reviewed import'});await expect(accept).toBeVisible();await accept.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'Build with your agent'})).toBeVisible();expect(accepted).toEqual(['exact-hash']);
 const a11y=await new AxeBuilder({page}).analyze();expect(a11y.violations).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const width of [1440,360])test(`integrated multi-binding review at ${width}px @fixture`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.addInitScript(()=>sessionStorage.setItem('artyfact.adminToken','test-admin'));await mockApi(page);
 const plan={id:'plan.review',systemId:SID,title:'Accepted implementation',genome:{repo:'genome',commit:'a'.repeat(40)},status:'integrated',tasks:[],analysis:{waves:[],conflicts:[]},integration:[],createdAt:'',updatedAt:''};
 const bindings=['artifact.web','artifact.api'].map((artifactId,i)=>({artifactId,candidateId:`candidate.integrated.${i}`,taskCandidates:[`candidate.task.${i}`],source:{repo:`source-${i}`,commit:'b'.repeat(40)},realizedGenome:'a'.repeat(40)}));
 await page.route('**/api/systems/*/realization-plans**',async route=>{const url=new URL(route.request().url());const path=url.pathname;const body=path.endsWith('/review/files')?{path:url.searchParams.get('path'),from:{repo:'exact-base',commit:'c'.repeat(40),hash:'old',text:'before '+ 'x'.repeat(120),size:127},to:{repo:'exact-fork',commit:'b'.repeat(40),hash:'new',text:'after '+ 'x'.repeat(120),size:126},binary:false,truncated:false}:path.endsWith('/review')?{plan,bindings,candidates:bindings.map(b=>({id:b.candidateId,changedPaths:['src/index.ts'],changedSubjects:['component.entry']})),evaluations:[],ready:true,blockers:[],expectedHead:'sc-1'}:path.endsWith('/realization-plans')?{plans:[plan]}:plan;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
 await page.goto(`/s/${SID}/r/head/work?plan=plan.review`);await expect(page.getByRole('heading',{name:'Combined implementation review'})).toBeVisible();
 for(const artifact of ['artifact.web','artifact.api']){await page.getByText(`Changed files and Genome nodes for ${artifact}`).click();}
 await page.getByRole('button',{name:'src/index.ts'}).first().click();await expect(page.getByRole('region',{name:'src/index.ts file changes'})).toBeVisible();
 const a11y=await new AxeBuilder({page}).analyze();expect(a11y.violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const width of [1440,360])test(`draft, edit and create a plan, then its wave board and agent commands at ${width}px @fixture`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce'});await page.addInitScript(()=>sessionStorage.setItem('artyfact.adminToken','test-admin'));await mockApi(page);
 const fp=(id:string)=>({repo:'web',artifactId:'artifact.web',globs:[`src/${id}/**`],paths:[`src/${id}/index.ts`],unmatched:[],known:true});
 const draftTask=(id:string,o={})=>({id,title:`Task ${id}`,artifactId:'artifact.web',steps:[`Build ${id}`],dependsOn:[] as string[],readNodes:[],writeNodes:[`component.${id}`],checks:[],...o});
 const draft={request:{title:'Birthdays',tasks:[draftTask('t1'),draftTask('t2'),draftTask('t3',{dependsOn:['t1','t2']}),draftTask('t4')]},analysis:{waves:[['t1','t2','t4'],['t3']],conflicts:[]},problems:[],provenance:{planner:{provider:'fake',model:'fake'},genomeCommit:'a'.repeat(40),evolutionIds:[],nodes:['component.t1'],fake:true,fallback:true}};
 let created:{title:string;tasks:{id:string}[]}|null=null;
 const plan=()=>({id:'plan.board',systemId:SID,title:created?.title??'Birthdays',genome:{repo:'genome',commit:'a'.repeat(40)},baseHead:'sc-1',baseManifest:{},ontologyDigest:'d',status:'planned',createdAt:'',updatedAt:'u',integration:[],
  tasks:(created?.tasks??[]).map(t=>({...draftTask(t.id),...t,footprint:fp(t.id),planId:'plan.board',status:'pending',base:{repo:'web',commit:'b'.repeat(40)},forkRepo:`web--${t.id}`,attempts:[],selectedCandidate:null})),
  analysis:{waves:[['t1','t2'],['t3']],conflicts:[{tasks:['t1','t3'],kind:'dependency',subjects:[],message:'t1 and t3: dependency interference'},{tasks:['t2','t3'],kind:'source',subjects:['src/shared.ts'],message:'t2 and t3: source interference'}]}});
 await page.route('**/api/systems/*/realization-plans**',async route=>{const path=new URL(route.request().url()).pathname;const method=route.request().method();let body:unknown;
  if(path.endsWith('/draft'))body=draft;else if(path.endsWith('/realization-plans')){if(method==='POST'){created=route.request().postDataJSON();body=plan();}else body={plans:created?[plan()]:[]};}else body=plan();
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
 await page.goto(`/s/${SID}/r/head/work?panel=plan`);
 await page.getByLabel('Genome nodes to implement').fill('component.t1');
 const draftBtn=page.getByRole('button',{name:'Draft tasks'});await expect(draftBtn).toBeEnabled();await draftBtn.focus();await page.keyboard.press('Enter');
 await expect(page.getByTestId('draft-waves')).toHaveText(/As drafted: wave 1 \(t1, t2, t4\); wave 2 \(t3\)/);
 // Keyboard: remove t4, rename t1, then create.
 await page.getByRole('button',{name:'Remove Task t4'}).focus();await page.keyboard.press('Enter');
 await page.getByLabel('Title of t1').fill('Cards');
 expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 await expect(page.getByRole('button',{name:'Create plan'})).toBeEnabled();await page.getByRole('button',{name:'Create plan'}).focus();await page.keyboard.press('Enter');
 await expect(page.getByTestId('plan-counts')).toHaveText('3 tasks · 2 waves');
 expect(created!.tasks.map(t=>t.id)).toEqual(['t1','t2','t3']);
 const board=page.getByRole('group',{name:'Waves'});
 await expect(board.getByRole('region',{name:'Wave 1 · 2 tasks'})).toBeVisible();await expect(board.getByRole('region',{name:'Wave 2 · 1 task'})).toBeVisible();
 await expect(page.getByTestId('task-t3').locator('[data-status="blocked"]')).toBeVisible();
 await expect(page.getByRole('listitem',{name:'Command for Cards'})).toContainText(`ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact task claim plan.board t1 --system ${SID} --dir ./work/t1`);await expect(page.getByRole('listitem',{name:'Command for Cards'})).toContainText(`( cd ./work/t1 && env -u ARTYFACT_ADMIN_TOKEN claude -p`);
 await expect(page.getByRole('listitem',{name:/Command for Task t3/})).toHaveCount(0);
 await page.getByRole('button',{name:'Task t3'}).focus();await page.keyboard.press('Enter');
 await expect(page.getByTestId('task-detail')).toContainText('Waits until “Cards”, “Task t2” are selected.');
 expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
