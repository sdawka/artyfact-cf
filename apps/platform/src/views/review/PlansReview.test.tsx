import type {QueryClient} from '@tanstack/react-query';
import {fireEvent,screen,waitFor,within} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {renderApp} from '@/testing/render';
import {PLAN_PROMOTE_INVALIDATIONS,qk} from '@/api/queries';
import {ADMIN_TOKEN_KEY} from '@/api/adminToken';
import {seed} from '../work/testSeed';
import {makePlan,task,attempt} from '../work/plan/testPlan';
import {candidate,SYSTEM} from '../work/testData';
const base=`/s/${SYSTEM}/r/head`;
afterEach(()=>{sessionStorage.clear();vi.unstubAllGlobals();});
function api(options:{fail?:boolean;loading?:boolean;token?:boolean;selected?:boolean}={}){
 let plan=makePlan({tasks:[task('t1',{status:options.selected?'selected':'submitted',attempts:[attempt({status:'submitted'})],selectedCandidate:options.selected?'candidate.exact':null})]});
 const entry={candidate:candidate({id:'candidate.exact',realization:'r.1',changedPaths:['src/exact.ts'],changedSubjects:['component.t1']}),manifest:{planId:plan.id,taskId:'t1',realizationId:'r.1',repo:'fork',baseRepo:'web',baseCommit:'pinned-base',commit:'exact-commit',manifestHash:'hash',changedPaths:['src/exact.ts']},evaluations:[{id:'evaluation.1',criterion:'C.exact',verdict:'pass',execution:'completed'}]};
 const calls:{url:string;body:unknown}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);calls.push({url,body:init?.body?JSON.parse(String(init.body)):null});
  if(url.endsWith('/api/systems'))return Response.json([{systemId:SYSTEM,title:'System',head:null,genomeRepo:'g',appRepo:'a',genomeCommit:'g',evolutionCounts:{},updatedAt:'',planCounts:{open:1,awaitingAgent:0,submitted:plan.tasks[0]?.status==='submitted'?1:0,integrated:0}}]);
  if(url.endsWith('/realization-plans')){if(options.loading)return new Promise<Response>(()=>{});if(options.fail)return Response.json({error:{message:'plans unavailable'}},{status:503});return Response.json({plans:[plan]});}
  if(url.endsWith('/tasks/t1/select')){plan={...plan,tasks:[{...plan.tasks[0]!,status:'selected',selectedCandidate:'candidate.exact'}],updatedAt:'u2'};return Response.json(plan);}
  if(url.includes('/review/files'))return Response.json({from:{repo:'web',commit:'pinned-base',text:'before'},to:{repo:'fork',commit:'exact-commit',text:'after'},binary:false,truncated:false});
  if(url.endsWith('/tasks/t1/review'))return Response.json({plan,task:plan.tasks[0],candidates:[entry]});
  if(url.includes('/realization-plans/'))return Response.json(plan);
  return Response.json({});
 }));
 if(options.token!==false)sessionStorage.setItem(ADMIN_TOKEN_KEY,'admin');
 return {calls,setup:seed({api:true,realizations:[]})};
}
it('reviews exact candidate files/evaluations and refreshes after selection',async()=>{
 const a=api();const {qc}=renderApp(`${base}/review?plan=plan.one&task=t1`,undefined,a.setup);
 const review=await screen.findByRole('region',{name:'Review Task t1'});
 expect(within(review).getByText('candidate.exact')).toBeTruthy();expect(review.textContent).toMatch(/C\.exact: pass \(completed\)/);
 fireEvent.click(within(review).getByRole('button',{name:'src/exact.ts'}));expect(await within(review).findByText('pinned-base')).toBeTruthy();
 await waitFor(()=>expect((qc.getQueryData(qk.systems()) as {planCounts?:{submitted:number}}[])[0]?.planCounts?.submitted).toBe(1));
 fireEvent.click(within(review).getByRole('button',{name:'Select reviewed Task result'}));
 await waitFor(()=>expect(a.calls.find(c=>c.url.endsWith('/select'))?.body).toEqual({candidateId:'candidate.exact'}));
 await waitFor(()=>expect(screen.queryByTestId('queue-task-selection:plan.one:t1')).toBeNull());
 expect(screen.queryByLabelText(/Reviewed candidate ID/)).toBeNull();
 await waitFor(()=>expect((qc.getQueryData(qk.systems()) as {planCounts?:{submitted:number}}[])[0]?.planCounts?.submitted).toBe(0),{timeout:1000});
});
it('keeps decided Task deep links readable and selection disabled',async()=>{
 const a=api({selected:true});renderApp(`${base}/review?plan=plan.one&task=t1`,undefined,a.setup);
 const review=await screen.findByRole('region',{name:'Review Task t1'});expect(within(review).getByText('candidate.exact')).toBeTruthy();expect(within(review).getByRole('button',{name:'Select reviewed Task result'}).hasAttribute('disabled')).toBe(true);
});
it('shows plan read errors instead of nothing waiting',async()=>{
 const a=api({fail:true});renderApp(`${base}/review`,undefined,a.setup);expect(await screen.findByText(/Reading plans: plans unavailable/)).toBeTruthy();expect(screen.queryByText('Nothing is waiting on you.')).toBeNull();
});
it('shows plan loading instead of nothing waiting',async()=>{
 const a=api({loading:true});renderApp(`${base}/review`,undefined,a.setup);expect(await screen.findByText('Loading the queue…')).toBeTruthy();expect(screen.queryByText('Nothing is waiting on you.')).toBeNull();
});
it('disables selection without an admin token',async()=>{
 const a=api({token:false});renderApp(`${base}/review?plan=plan.one&task=t1`,undefined,a.setup);expect((await screen.findByRole('button',{name:'Select reviewed Task result'})).hasAttribute('disabled')).toBe(true);
});

it('names a missing Task rather than claiming nothing waits',async()=>{
 const a=api();renderApp(`${base}/review?plan=plan.one&task=missing`,undefined,a.setup);expect(await screen.findByText('No Task missing in plan plan.one.')).toBeTruthy();expect(screen.queryByText('Nothing is waiting on you.')).toBeNull();
});
it('keeps Thing routing and global parameters in Task decision links',async()=>{
 const a=api();renderApp(`${base}/things/thing.webapp/review?focus=screen.people&layer=proteome`,undefined,a.setup);
 const link=await screen.findByTestId('queue-task-selection:plan.one:t1');expect(link.getAttribute('href')).toBe(`${base}/things/thing.webapp/review?focus=screen.people&layer=proteome&plan=plan.one&task=t1`);
});

it('disables integrated promotion with explicit stale-head blockers',async()=>{
 const plan=makePlan({status:'integrated',tasks:[]});sessionStorage.setItem(ADMIN_TOKEN_KEY,'admin');
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const url=String(input);return Response.json(url.endsWith('/review')?{plan,bindings:[],candidates:[],evaluations:[],ready:false,blockers:['Binding artifact.web changed; replan required.'],expectedHead:'changed-head'}:url.endsWith('/realization-plans')?{plans:[plan]}:plan);}));
 renderApp(`${base}/review?plan=plan.one`,undefined,seed({api:true,realizations:[]}));
 fireEvent.change(await screen.findByLabelText('Promotion rationale'),{target:{value:'Review rationale'}});
 expect(screen.getByText('Binding artifact.web changed; replan required.')).toBeTruthy();expect(screen.getByRole('button',{name:'Promote reviewed implementation'}).hasAttribute('disabled')).toBe(true);
});

it('after Promote shows the promoted state and its System commit, not the stale blockers, and refreshes the head',async()=>{
 const binding={artifactId:'artifact.web',source:{repo:'fork',commit:'int-commit'},candidateId:'cand.int',taskCandidates:['cand.t1'],realizedGenome:'g'.repeat(40)};
 let plan=makePlan({status:'integrated',tasks:[],integration:[binding] as never});let promoted=false;let seeded:QueryClient|undefined;sessionStorage.setItem(ADMIN_TOKEN_KEY,'admin');
 const commit={id:'sc-2-abcdef12',parent:'sc-1',candidates:['cand.int'],evolutions:[],manifest:[],genomeCommit:'g'.repeat(40),decision:{by:'admin',at:'',policy:'p',rationale:'r'}};
 const after:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);if(promoted)after.push(url);
  if(url.endsWith('/promote')&&init?.method==='POST'){promoted=true;plan={...plan,status:'promoted',updatedAt:'u2'};return Response.json({plan,commit});}
  if(url.endsWith('/history'))return Response.json({commits:promoted?[commit]:[]});
  // Recomputed against the moved head, the review of a promoted plan lists blockers that no longer apply.
  if(url.endsWith('/review'))return Response.json(promoted?{plan,bindings:[binding],candidates:[],evaluations:[],ready:false,blockers:['Integrate all selected tasks before promotion.'],expectedHead:'sc-2'}:{plan,bindings:[binding],candidates:[],evaluations:[],ready:true,blockers:[],expectedHead:'sc-1'});
  if(url.includes('/realization-plans'))return Response.json(url.endsWith('/realization-plans')?{plans:[plan]}:plan);
  // Refetched after the promote: the model and readiness answer with what the test seeded.
  if(/\/model\b/.test(url))return Response.json(seeded!.getQueryData(qk.model(SYSTEM,'head')));
  if(/\/readiness\b/.test(url))return Response.json(seeded!.getQueryData(qk.readiness(SYSTEM,'head'))??{});
  return Response.json({});}));
 const {qc}=renderApp(`${base}/review?plan=plan.one`,undefined,(c)=>{seeded=c;seed({api:true,realizations:[]})(c);c.setQueryData(qk.changelogEntry(SYSTEM,'sc-1'),{});});
 fireEvent.change(await screen.findByLabelText('Promotion rationale'),{target:{value:'Ship it'}});
 fireEvent.click(screen.getByRole('button',{name:'Promote reviewed implementation'}));
 const link=await screen.findByRole('link',{name:'sc-2-abcdef12'});
 expect(link.getAttribute('href')).toBe(`${base}/changelog?commit=sc-2-abcdef12`);
 expect(screen.getByRole('heading',{name:'Promoted'})).toBeTruthy();
 expect(screen.queryByRole('list',{name:'Promotion blockers'})).toBeNull();expect(screen.queryByText('Combined implementation review')).toBeNull();
 // The header's head (revisions) and the model refetch now, not on the next navigation; unmounted keys are marked stale.
 expect(after.some(u=>u.includes('/revisions'))).toBe(true);expect(after.some(u=>u.includes('/model'))).toBe(true);
 expect(qc.getQueryState(qk.changelogEntry(SYSTEM,'sc-1'))?.isInvalidated).toBe(true);
 expect(PLAN_PROMOTE_INVALIDATIONS).toEqual(expect.arrayContaining(['plan','plans','implementation-review','history','readiness','revisions','model','systems','changelog','compare']));
});
