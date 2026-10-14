import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderApp } from '@/testing/render';
import { ADMIN_TOKEN_KEY } from '@/api/adminToken';
afterEach(()=>{sessionStorage.clear();vi.unstubAllGlobals();});
it('creates an initial System, previews, and accepts the exact reviewed native package',async()=>{
 sessionStorage.setItem(ADMIN_TOKEN_KEY,'admin');const calls:{url:string;body:unknown}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{const u=String(url);calls.push({url:u,body:init?.body?JSON.parse(String(init.body)):null});
 if(u.endsWith('/initial'))return Response.json({systemId:'system.custom',status:'import-pending'});
 if(u.includes('/ontology-imports'))return Response.json({id:'import.one',systemId:'system.custom',status:u.endsWith('/accept')?'accepted':'review',templateRefs:['template.domain@1'],issues:[],package:{},pin:{id:'custom',version:'1',hash:'exact-hash'}});
 if(u.endsWith('/systems'))return Response.json({systems:[{systemId:'system.custom',title:'Custom'}]});if(u.endsWith('/parts'))return Response.json({parts:[]});return Response.json({});}));
 renderApp('/start');
 fireEvent.change(await screen.findByLabelText('System ID'),{target:{value:'system.custom'}});
 fireEvent.click(screen.getByRole('button',{name:'Create System'}));
 fireEvent.change(await screen.findByLabelText('Native ontology package'),{target:{value:'{"format":"artyfact.ontology-package@1"}'}});
 fireEvent.click(screen.getByText('Add reviewed Genome files (optional)'));fireEvent.change(screen.getByLabelText('Genome files (optional JSON)'),{target:{value:JSON.stringify({'node.yaml':'id: system.custom\nkind: system\n'})}});
 fireEvent.click(screen.getByRole('button',{name:'Preview import'}));
 fireEvent.click(await screen.findByRole('button',{name:'Accept reviewed import'}));
 await waitFor(()=>expect(calls.find(c=>c.url.endsWith('/accept'))?.body).toEqual({hash:'exact-hash'}));
 expect(await screen.findByText('Build with your agent')).toBeTruthy();expect(calls.find(c=>c.url.endsWith('/preview'))?.body).toMatchObject({genomeFiles:{'node.yaml':'id: system.custom\nkind: system\n'}});
 expect(screen.getByRole('heading',{name:'Check the proposed Genome'})).toBeTruthy();expect(screen.getByText(/accepted package only accepts vocabulary/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Check local bootstrap completion'}));expect(await screen.findByRole('link',{name:'Open System work'})).toBeTruthy();
});
it('offers a valid native starter with explicit optional outcomes vocabulary',async()=>{
 const {inspectOntologyPackage}=await import('@artyfact/model');const {metaTemplates}=await import('@artyfact/templates');
 sessionStorage.setItem(ADMIN_TOKEN_KEY,'admin');vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(String(url).endsWith('/systems')?{systems:[]}:String(url).endsWith('/parts')?{parts:[]}:{systemId:'system.custom',status:'import-pending'})));
 renderApp('/start');fireEvent.change(await screen.findByLabelText('System ID'),{target:{value:'system.custom'}});fireEvent.click(screen.getByRole('button',{name:'Create System'}));
 fireEvent.click(await screen.findByRole('button',{name:'Use starter package'}));const source=screen.getByLabelText('Native ontology package') as HTMLTextAreaElement;const native=JSON.parse(source.value);
 expect(inspectOntologyPackage(native,{bundled:metaTemplates,accepted:[]}).issues).toEqual([]);expect(native.templates['template.system.custom@1'].extends).toBe('template.meta.artyfact-genome@1');
 fireEvent.click(screen.getByRole('checkbox',{name:'Include outcomes vocabulary (events, expected effects, assays)'}));fireEvent.click(screen.getByRole('button',{name:'Use starter package'}));expect(inspectOntologyPackage(JSON.parse(source.value),{bundled:metaTemplates,accepted:[]}).issues).toEqual([]);expect(JSON.parse(source.value).templates['template.system.custom@1'].extends).toBe('template.meta.outcomes@1');
});

it('gives a scoped, quoted source-preparation handoff without inventing a plan file',async()=>{
 sessionStorage.setItem(ADMIN_TOKEN_KEY,'must-not-leak');
 const system="system.custom; echo bad",reviewId="import.one'bad";
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(String(url).includes('/ontology-imports/')?{id:reviewId,systemId:system,status:'accepted',issues:[],templateRefs:[],package:{}}:String(url).endsWith('/systems')?{systems:[]}:{})));
 renderApp(`/start?system=${encodeURIComponent(system)}&import=${encodeURIComponent(reviewId)}`);
 const heading=(await screen.findByRole('button',{name:'Check local bootstrap completion'})).closest('li')!;
 const text=heading.textContent!;
 expect(text).toContain('--prepare-only');expect(text).toContain('skill --dir ./project --write --agent generic');
 expect(text).toContain(`--platform ${window.location.origin}`);
 expect(text).toContain('ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN"');expect(text).not.toContain('must-not-leak');
 expect(text).toContain("'system.custom; echo bad'");expect(text).toContain("'import.one'\\''bad'");
 expect(text).toContain('--node');expect(text).not.toContain('plan.json');expect(text).not.toContain('--no-review');
 expect(text).toContain('Genome-only');expect(text).toContain('source-bound');
});

it('previews source-free native Genome files then opens the exact integrity run', async () => {
 sessionStorage.setItem(ADMIN_TOKEN_KEY,'admin'); const calls:string[]=[];
 const run={id:'integrity.one',systemId:'system.custom',snapshotId:'snapshot.one',snapshotHash:'sha256:s',provider:'off',requestedCalls:200,attempt:1,state:'completed',createdAt:'',updatedAt:'',reviewUrl:'/start?system=system.custom&integrity=integrity.one',report:{version:1,id:'report.one',systemId:'system.custom',snapshotHash:'sha256:s',policyVersion:'integrity.v1',createdAt:'',status:'needs-review',structural:{status:'passed',complete:true,findings:[],limitations:[],checkedSubjects:[],checkedRelationships:[]},semantic:{status:'needs-review',complete:false,intentFidelity:'checked',findings:[],limitations:[],checkedSubjects:[],checkedRelationships:[]}}};
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{const u=String(url);calls.push(u);if(u.endsWith('/integrity/preview'))return Response.json({snapshot:{id:'snapshot.one'}});if(u.endsWith('/integrity/runs')&&init?.method==='POST')return Response.json({run});if(u.endsWith('/integrity/runs/integrity.one'))return Response.json({run});if(u.endsWith('/systems'))return Response.json({systems:[]});return Response.json({});}));
 renderApp('/start?system=system.custom');
 fireEvent.change(await screen.findByLabelText('Genome files (JSON path-to-text object)'),{target:{value:JSON.stringify({'system.yaml':'id: system.custom\nkind: system\n'})}});
 fireEvent.click(screen.getByRole('button',{name:'Preview and start integrity check'}));
 expect(await screen.findByText(/Automated result: needs-review/)).toBeTruthy();
 expect(calls.some(u=>u.endsWith('/integrity/preview'))).toBe(true);expect(calls.some(u=>u.endsWith('/integrity/runs'))).toBe(true);
});
