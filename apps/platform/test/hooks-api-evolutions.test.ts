import { env } from 'cloudflare:workers';
import { lifecyclePaths, type RealizationPlan, type TaskStartResponse, type TaskSubmitResponse } from '../shared/lifecycle';
import { walkTree } from '../worker/artifacts/genome-source';
/** Hook selection for Evolutions created through the API (they live only in the DO, not in the Genome). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSystemOne } from "@artyfact/semantic";
import type { CreateEvolutionResponse, Evaluation, SubmitResponse } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { createHookRunner } from "../worker/hooks/run";
import { ADMIN, call, importFresh, submitApp } from "./helpers/flows";

/** The preview's `/health` answer; `null` makes the fake fetch throw (no preview should be contacted). */
let buildId: string | null = null;
const fetched: string[] = [];
const fakeFetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  fetched.push(url);
  if (buildId === null) throw new Error("no preview expected");
  return Response.json({ status: "ok", buildId });
}) as typeof fetch;

beforeEach(() => {
  buildId = null;
  fetched.length = 0;
  setHooks({ runner: () => createHookRunner({ s1: createSystemOne({}), fetch: fakeFetch, previewEnv: {} }) });
});
afterEach(() => { setArtifactsOverride(undefined); resetHooks(); });

const by = (evs: Evaluation[], criterion: string) => evs.filter((e) => e.criterion === criterion);
const PEOPLE = { "src/ui/people/index.html": "<main>people</main>" };

describe("hook selection: realization plans and legacy evolutions", () => {
  it("evaluates pinned task check criteria: C.webapp.health not-run without a preview, pass once it answers", async () => {
    const f = await importFresh();
    const created=await call<RealizationPlan>('POST',lifecyclePaths.plans(f.systemId).replace(/^\/api/,''),{title:'Health',tasks:[{id:'health',title:'Health',artifactId:'artifact.webapp',steps:['Answer health'],dependsOn:[],readNodes:[],writeNodes:['screen.people'],checks:['C.webapp.health']}]},ADMIN);expect(created.status,JSON.stringify(created.json)).toBe(201);
    const pid=created.json.id,tid='health',started=await call<TaskStartResponse>('POST',lifecyclePaths.action(f.systemId,pid,tid,'claim').replace(/^\/api/,''),{},ADMIN);expect(started.status).toBe(201);const start=started.json,repo=f.ns.repo(start.task.forkRepo),files=await walkTree(repo,start.task.base.commit);for(const [path,text] of Object.entries(PEOPLE))files.set(path,text);const commit=repo.commit(files,'people');
    const submit=(previewUrl?:string)=>call<TaskSubmitResponse>('POST',lifecyclePaths.action(f.systemId,pid,tid,'submit').replace(/^\/api/,''),{attemptId:start.attempt.id,generation:start.attempt.generation,commit,...(previewUrl&&{previewUrl})},{authorization:`Bearer ${start.secret}`});
    const first=await submit();expect(first.status,JSON.stringify(first.json)).toBe(201);
    expect(first.json.evaluations.some(e=>e.criterion.startsWith('C.evolution-missing'))).toBe(false);
    expect(by(first.json.evaluations,'C.webapp.health')).toEqual([expect.objectContaining({hook:'hook.webapp.health',execution:'not-run',verdict:'unknown',provenance:expect.objectContaining({selectedBy:'acceptance'})})]);expect(fetched).toEqual([]);
    buildId=commit;const url='https://peopling-app-r1.acct.workers.dev',again=await submit(url);expect(again.status,JSON.stringify(again.json)).toBe(201);expect(fetched).toEqual([`${url}/health`]);expect(by(again.json.evaluations,'C.webapp.health')).toContainEqual(expect.objectContaining({hook:'hook.webapp.health',execution:'completed',verdict:'pass',targetRef:url}));

  });

  it("a Genome-declared Evolution selects exactly what it did before", async () => {
    const f = await importFresh();
    const s = await submitApp(f, PEOPLE);
    const sub = await call<SubmitResponse>("POST", `/systems/${f.systemId}/realizations/${s.rid}/submit`, { commit: s.commit });
    const pairs = sub.json.evaluations.map((e) => `${e.criterion}|${e.hook}|${e.provenance.selectedBy}`);
    // Recorded against main before the DO fallback existed.
    expect(pairs).toEqual([
      "C.people.audit|hook.people.audit|subject",
      "C.people.lint|hook.people.lint|subject",
      "C.people.list|hook.people.list|acceptance",
      "C.people.sorted|none|acceptance",
      "C.system.promotion|hook.system.scope|system-gate",
    ]);
  });
});
