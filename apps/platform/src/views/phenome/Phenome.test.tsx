import type { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, within, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Build, Deployment, PhenomeEvent } from "../../../shared/api";
import { phenomeVersionKey } from "../../../shared/phenome";
import { fixtureBundle } from "@/api/fixtures";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";

const SYSTEM = "system.peopling";
const PATH = `/s/${SYSTEM}/r/head/phenome`;
const COMMIT = "a".repeat(40);
const OTHER = "b".repeat(40);
const T = "2026-01-01T00:00:00.000Z";

const build = (o: Partial<Build> = {}): Build => ({
  id: "build.1", status: "passed", kind: "preview", commit: COMMIT, realization: "realization.1", candidate: "cand.1", reporter: "ci",
  url: "https://preview.example.dev", steps: [{ name: "install", status: "passed" }, { name: "test", status: "failed" }],
  startedAt: T, createdAt: T, updatedAt: T, ...o,
});
const deployment = (o: Partial<Deployment> = {}): Deployment => ({
  id: "deploy.1", kind: "production", status: "live", repo: "app", commit: COMMIT, systemCommit: "sc-2", build: "build.9",
  url: "https://app.example.dev", buildId: COMMIT, by: "admin", createdAt: T, updatedAt: T, ...o,
});
const event = (seq: number, buildId: string, o: Partial<PhenomeEvent> = {}): PhenomeEvent => ({
  seq, receivedAt: T, systemId: SYSTEM, thingId: "thing.webapp", artifactId: "artifact.webapp", buildId, commit: buildId, emittedAt: T,
  kind: "journey.step", payload: {}, ...o,
});

interface Seed { builds?: Build[]; production?: Deployment | null; history?: Deployment[]; events?: PhenomeEvent[]; query?: object }
const seed = (s: Seed = {}) => (qc: QueryClient) => {
  qc.setQueryData(qk.builds(SYSTEM, {}), { builds: s.builds ?? [] });
  qc.setQueryData(qk.deployments(SYSTEM), { production: s.production ?? null, history: s.history ?? [] });
  const events = s.events ?? [];
  const keyOf = (e: PhenomeEvent) => phenomeVersionKey(e.outputId, e.buildId, e.commit);
  const keys = [...new Set(events.map(keyOf))];
  qc.setQueryData(qk.phenomePages(SYSTEM, s.query ?? {}), { pages: [{
    events,
    versions: keys.map((key) => { const first = events.find((e) => keyOf(e) === key)!; return { key, output: first.outputId ?? null, genomeCommit: first.genomeCommit ?? null, buildId: first.buildId, commit: first.commit, deployment: null, systemCommit: null, count: events.filter((e) => keyOf(e) === key).length }; }),
  }], pageParams: [undefined] });
};

describe("Deployments page", () => {
  it("notes that admin actions need the header token, until one is set", async () => {
    sessionStorage.clear();
    renderApp(PATH, undefined, seed());
    expect(await screen.findByText("Admin actions need the admin token: set it in the header.")).toBeTruthy();
    sessionStorage.setItem("artyfact.adminToken", "adm");
    try {
      cleanup();
      renderApp(PATH, undefined, seed());
      await screen.findByRole("heading", { level: 1, name: "Deployments" });
      expect(screen.queryByText(/Admin actions need the admin token/)).toBeNull();
    } finally {
      sessionStorage.clear();
    }
  });

  it("keeps other Things' builds and events outside a scoped Thing workspace", async () => {
    renderApp(`/s/${SYSTEM}/r/head/things/thing.webapp/phenome`, undefined, seed({
      builds: [build({ thingId: "thing.webapp", candidate: "cand.selected" }), build({ id: "build.other", thingId: "thing.other", candidate: "cand.other" })],
      query: {thing:"thing.webapp"},
      events: [event(2, COMMIT, { kind: "selected.event" }), event(1, OTHER, { thingId: "thing.other", kind: "other.event" })],
    }));
    expect(await screen.findByText("cand.selected")).toBeTruthy();
    expect(screen.queryByText("cand.other")).toBeNull();
    expect(screen.getByText("selected.event")).toBeTruthy();
    expect(screen.queryByText("other.event")).toBeNull();
  });

  it("separates events for distinct outputs built from the same source", async () => {
    renderApp(PATH, undefined, seed({ events: [event(2, COMMIT, { outputId: "output.two" }), event(1, COMMIT, { outputId: "output.one" })] }));
    const groups = await screen.findAllByText(/events/, { selector: "summary" });
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.textContent)).toEqual([expect.stringContaining("output.two"), expect.stringContaining("output.one")]);
  });

  it("distinguishes realized output identity from source and keeps legacy identity unknown", async () => {
    renderApp(PATH, undefined, seed({
      builds: [build({ output: { id: "output.known", thingId: "thing.webapp", artifactId: "artifact.webapp", source: { repo: "app", commit: COMMIT }, genomeCommit: OTHER, build: "build.1", createdAt: T } }), build({ id: "build.legacy" })],
      production: deployment({ output: "output.known" }),
      events: [event(1, COMMIT, { outputId: "output.known", genomeCommit: OTHER })],
    }));
    expect(await screen.findAllByText("output.known")).toHaveLength(3);
    expect(screen.getByText("Output unknown")).toBeTruthy();
    expect(screen.getByText(/Source app@aaaaaaa/)).toBeTruthy();
  });

  it("shows the empty state with the literal unknown and nothing green", async () => {
    const { container } = renderApp(PATH, undefined, seed());
    expect(await screen.findByRole("heading", { level: 1, name: "Deployments" })).toBeTruthy();
    expect(screen.getByText(/No deployments recorded/).textContent).toContain("unknown");
    expect(screen.getByText("No runtime events in this scope.")).toBeTruthy();
    expect(container.querySelector('[data-tone="pass"], [data-verdict="pass"]')).toBeNull();
  });

  it("lists builds with steps, a safe preview link and the candidate", async () => {
    renderApp(PATH, undefined, seed({ builds: [build()] }));
    const steps = await screen.findByRole("list", { name: "Steps of build.1" });
    expect(within(steps).getByText("install: passed")).toBeTruthy();
    expect(within(steps).getByText("test: failed")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Preview" });
    expect(link.getAttribute("href")).toBe("https://preview.example.dev");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("cand.1")).toBeTruthy();
  });

  it("groups events by version key under ?deployment=", async () => {
    renderApp(`${PATH}?deployment=deploy.1`, undefined, seed({
      query: { deployment: "deploy.1" },
      events: [event(3, COMMIT), event(2, COMMIT), event(1, OTHER)],
    }));
    const groups = await screen.findAllByText(/events/, { selector: "summary" });
    expect(groups.map((g) => g.textContent)).toEqual([expect.stringContaining("aaaaaaa · 2 events"), expect.stringContaining("bbbbbbb · 1 events")]);
  });

  it("uses the fail tone for failed builds and pass only for passed", async () => {
    const { container } = renderApp(PATH, undefined, seed({
      builds: [build({ id: "b.fail", status: "failed" }), build({ id: "b.run", status: "running" }), build({ id: "b.err", status: "error" }), build({ id: "b.ok", status: "passed" })],
      production: deployment(),
    }));
    await screen.findByRole("list", { name: "Steps of b.ok" });
    const tone = (status: string) => container.querySelector(`[data-status="${status}"][data-tone]`)!.getAttribute("data-tone");
    expect(tone("failed")).toBe("fail");
    expect(tone("error")).toBe("fail");
    expect(tone("running")).toBe("neutral");
    expect(tone("passed")).toBe("pass");
    expect(container.querySelector('[data-status="live"]')!.getAttribute("data-tone")).toBe("neutral");
    expect(container.querySelectorAll('[data-tone="pass"]')).toHaveLength(1);
  });
});


it("keeps runtime outcome verdicts unknown despite implementation and raw pass evidence",async()=>{
 const bundle=fixtureBundle();const criterion=bundle.model.criteria[0]!;bundle.model.criteria=[{...criterion,id:'C.runtime',targetKind:'observation'}];
 const {container}=renderApp(`${PATH}?deployment=deploy.1&candidates=cand.foreign`,undefined,qc=>{
  seed({history:[deployment({build:'build.1'})],builds:[build()],events:[event(1,COMMIT,{criterion:'C.runtime',payload:{verdict:'pass'}})],query:{deployment:'deploy.1'}})(qc);
  qc.setQueryData(qk.model(SYSTEM,'head'),bundle);qc.setQueryData(qk.evaluations(SYSTEM),{evaluations:[{id:'eval.foreign',criterion:'C.runtime',candidate:'cand.foreign',execution:'completed',verdict:'pass',evaluatedAt:T}]});
 });
 const card=(await screen.findByRole('heading',{name:'Outcome criteria'})).closest('section')!;
 expect(within(card).getByText('unknown')).toBeTruthy();expect(card.querySelector('[data-verdict="pass"]')).toBeNull();expect(container.textContent).toContain('Runtime outcome evaluation is not available');
});

it('shows implementation evaluations only through the selected deployment build candidate',async()=>{
 const evaluation=(candidate:string,id:string)=>({id,candidate,hook:'hook.test',criterion:'C.people.list',ownerId:'thing.webapp',subjectId:'screen.people',targetRef:COMMIT,execution:'completed',verdict:'pass',verifier:'ci',startedAt:T,observations:[],limitations:[],provenance:{}});
 const {router}=renderApp(`${PATH}?deployment=deploy.1`,undefined,qc=>{
  seed({history:[deployment({build:'build.1'}),deployment({id:'deploy.foreign',build:'build.other'}),deployment({id:'deploy.legacy',build:undefined})],builds:[build(),build({id:'build.other',candidate:'cand.foreign'})],query:{deployment:'deploy.1'}})(qc);
  qc.setQueryData(qk.evaluations(SYSTEM),{evaluations:[evaluation('cand.1','eval.exact'),evaluation('cand.foreign','eval.foreign')]});
 });
 const card=(await screen.findByRole('heading',{name:'Implementation evaluations'})).closest('section')!;
 expect(card.textContent).toContain('eval.exact');expect(card.textContent).not.toContain('eval.foreign');
 await router.navigate(`${PATH}?deployment=deploy.foreign`);await screen.findByText('eval.foreign');expect(screen.queryByText('eval.exact')).toBeNull();
 await router.navigate(`${PATH}?deployment=deploy.legacy`);expect(await screen.findByText('No exact deployment → build → candidate association.')).toBeTruthy();expect(screen.queryByText('eval.foreign')).toBeNull();
});


function pageApi(setup:{initialError?:boolean;olderError?:boolean}={}) {
 const paths:string[]=[];let initialFailures=setup.initialError?1:0,olderFailures=setup.olderError?1:0;
 const version={key:'output.b',output:'output.b',genomeCommit:null,buildId:'runtime.b',commit:COMMIT,deployment:'deploy.b',systemCommit:null,count:2};
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  const u=String(url);paths.push(u);
  if(u.includes('/phenome/events')){
   const query=new URL(u,'https://example.com').searchParams;
   if(query.get('thing')==='thing.webapp')return Response.json({events:[],versions:[]});
   if(query.get('before')){if(olderFailures-->0)return Response.json({error:{code:'older-failed',message:'Older page unavailable'}},{status:503});return Response.json({events:[event(2,'runtime.b',{thingId:'thing.b',outputId:'output.b',kind:'b.newest'}),event(1,'runtime.b',{thingId:'thing.b',outputId:'output.b',kind:'b.older'})],versions:[{...version,count:999}]});}
   if(initialFailures-->0)return Response.json({error:{code:'initial-failed',message:'Initial page unavailable'}},{status:503});
   return Response.json({events:[event(2,'runtime.b',{thingId:'thing.b',outputId:'output.b',kind:'b.newest'})],versions:[version],nextBefore:2});
  }
  if(u.endsWith('/systems'))return Response.json({systems:[]});return Response.json({builds:[],production:null,history:[],events:[],versions:[],artifacts:[],evaluations:[],commits:[]});
 }));
 const bundle=fixtureBundle();bundle.model.things.push({...bundle.model.things[0]!,id:'thing.b',artifacts:[]});
 const app=renderApp(`/s/${SYSTEM}/r/head/things/thing.b/phenome?deployment=deploy.b&build=runtime.b&output=output.b&kind=health&commit=${COMMIT}&realization=rz.b`,undefined,qc=>qc.setQueryData(qk.model(SYSTEM,'head'),bundle));return {...app,paths};
}
it('loads older scoped events without duplicates or summed counts and resets on Thing navigation',async()=>{
 const {router,paths}=pageApi();expect(await screen.findByText('b.newest')).toBeTruthy();fireEvent.click(await screen.findByRole('button',{name:'Load older events'}));expect(await screen.findByText('b.older')).toBeTruthy();expect(screen.getAllByText('b.newest')).toHaveLength(1);
 expect(screen.getByText(/2 events/, {selector:'summary'})).toBeTruthy();expect(screen.queryByText(/999 events|1001 events/)).toBeNull();expect(screen.queryByRole('button',{name:'Load older events'})).toBeNull();
 const query=new URL(paths.find(p=>p.includes('before='))!,'https://example.com').searchParams;expect(Object.fromEntries(query)).toEqual({thing:'thing.b',deployment:'deploy.b',build:'runtime.b',output:'output.b',kind:'health',commit:COMMIT,realization:'rz.b',before:'2'});
 await router.navigate(`/s/${SYSTEM}/r/head/things/thing.webapp/phenome`);expect(await screen.findByText('No runtime events in this scope.')).toBeTruthy();expect(screen.queryByText('b.older')).toBeNull();
});
it('shows an initial event error with retry instead of a false empty state',async()=>{
 pageApi({initialError:true});expect(await screen.findByRole('button',{name:'Retry runtime events'})).toBeTruthy();expect(screen.queryByText('No runtime events in this scope.')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Retry runtime events'}));expect(await screen.findByText('b.newest')).toBeTruthy();
});
it('preserves loaded events when an older page fails and retries the same cursor',async()=>{
 const {paths}=pageApi({olderError:true});expect(await screen.findByText('b.newest')).toBeTruthy();fireEvent.click(await screen.findByRole('button',{name:'Load older events'}));expect(await screen.findByRole('button',{name:'Retry older events'})).toBeTruthy();expect(screen.getByText('b.newest')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Retry older events'}));expect(await screen.findByText('b.older')).toBeTruthy();expect(paths.filter(p=>p.includes('before=2'))).toHaveLength(2);
});

it('labels counts as loaded events when a version has no retained aggregate',async()=>{
 renderApp(PATH,undefined,qc=>{seed({events:[event(1,COMMIT)]})(qc);qc.setQueryData(qk.phenomePages(SYSTEM,{}),{pages:[{events:[event(1,COMMIT)],versions:[]}],pageParams:[undefined]});});
 expect(await screen.findByText(/1 loaded events/,{selector:'summary'})).toBeTruthy();
});

it('keeps legacy reused-build commits in separate groups with exact summaries across pages',async()=>{
 const newer=event(3,'runtime.reused',{commit:OTHER,kind:'new.commit'}),older=event(2,'runtime.reused',{commit:COMMIT,kind:'old.commit'});
 const versions=[{key:JSON.stringify(['runtime.reused',OTHER]),output:null,genomeCommit:null,buildId:'runtime.reused',commit:OTHER,deployment:'dep.new',systemCommit:'sc.new',count:1},{key:JSON.stringify(['runtime.reused',COMMIT]),output:null,genomeCommit:null,buildId:'runtime.reused',commit:COMMIT,deployment:'dep.old',systemCommit:'sc.old',count:2}];
 renderApp(PATH,undefined,qc=>{seed()(qc);qc.setQueryData(qk.phenomePages(SYSTEM,{}),{pages:[{events:[newer],versions,nextBefore:3},{events:[older,event(1,'runtime.reused',{commit:COMMIT,kind:'old.second'})],versions}],pageParams:[undefined,3]});});
 const groups=await screen.findAllByText(/events/,{selector:'summary'});expect(groups).toHaveLength(2);expect(groups[0].textContent).toContain('1 events');expect(groups[0].textContent).toContain('sc.new');expect(groups[1].textContent).toContain('2 events');expect(groups[1].textContent).toContain('sc.old');expect(groups[0].textContent).toContain('Source bbbbbbb');expect(groups[1].textContent).toContain('Source aaaaaaa');
});
