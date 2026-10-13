import { fireEvent,screen } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { renderApp } from '@/testing/render';
import { ADMIN_TOKEN_KEY } from '@/api/adminToken';
import { qk } from '@/api/queries';
import { fixtureBundle } from '@/api/fixtures';
afterEach(()=>{sessionStorage.clear();vi.unstubAllGlobals();});
it('shows a separate pinned Realization plan with dependency waves and exact integrated promotion',async()=>{
 sessionStorage.setItem(ADMIN_TOKEN_KEY,'admin');const calls:{url:string;body:unknown}[]=[];
 const plan={id:'plan.one',systemId:'system.peopling',title:'Implement birthday cards',genome:{repo:'g',commit:'accepted-genome'},status:'integrated',tasks:[],analysis:{waves:[['task.ui'],['task.check']],conflicts:[]},integration:[],createdAt:'',updatedAt:''};
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{const u=String(url);calls.push({url:u,body:init?.body?JSON.parse(String(init.body)):null});if(u.includes('/review/files?'))return Response.json({path:'src/cards.ts',from:{repo:'web-base',commit:'base-source',hash:'old',text:'before',size:6},to:{repo:'web-fork',commit:'exact-source',hash:'new',text:'after',size:5},binary:false,truncated:false});if(u.endsWith('/review'))return Response.json({plan,bindings:[{artifactId:'artifact.web',candidateId:'candidate.integrated',taskCandidates:['candidate.ui'],source:{repo:'web',commit:'exact-source'},realizedGenome:'accepted-genome'}],candidates:[{id:'candidate.integrated',changedPaths:['src/cards.ts'],changedSubjects:['component.cards'],genomeChanges:[]}],evaluations:[],ready:true,blockers:[],expectedHead:'head-one'});if(u.endsWith('/promote'))return Response.json({plan:{...plan,status:'promoted'},commit:{}});if(u.endsWith('/realization-plans'))return Response.json({plans:[plan]});if(u.includes('/realization-plans/'))return Response.json(plan);if(u.endsWith('/systems'))return Response.json([]);return Response.json({parts:[]});}));
 renderApp('/s/system.peopling/r/head/work?plan=plan.one',undefined,qc=>{qc.setQueryData(qk.model('system.peopling','head'),{...fixtureBundle(),source:'api'});qc.setQueryData(qk.evolutions('system.peopling'),{evolutions:[],realizations:[]});});
 expect(await screen.findByRole('heading',{name:'Realizations'})).toBeTruthy();expect(await screen.findByText('accepted-genome')).toBeTruthy();
 expect(await screen.findByText('src/cards.ts')).toBeTruthy();
 expect(screen.getByText('component.cards')).toBeTruthy();
 fireEvent.click(screen.getByText('Changed files and Genome nodes for artifact.web'));fireEvent.click(screen.getByRole('button',{name:'src/cards.ts'}));expect(await screen.findByText('after')).toBeTruthy();expect(calls.some(c=>c.url.includes('/review/files?artifactId=artifact.web&path=src%2Fcards.ts'))).toBe(true);
 fireEvent.change(await screen.findByLabelText('Promotion rationale'),{target:{value:'Reviewed all changed bindings'}});fireEvent.click(screen.getByRole('button',{name:'Promote reviewed implementation'}));
 const {waitFor}=await import('@testing-library/react');await waitFor(()=>expect(calls.find(c=>c.url.endsWith('/promote'))?.body).toEqual({expectedHead:'head-one',rationale:'Reviewed all changed bindings',candidateIds:['candidate.integrated']}));
});
