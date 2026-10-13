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
