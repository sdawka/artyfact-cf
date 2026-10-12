import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ApiError, BuildReportResponse, BuildsResponse, CandidatesResponse, CiBuildParams, DeploymentCreated, DeploymentsResponse, ImportSystemResponse,
  IngestTokenResponse, PromoteResponse, RealizationResponse, StartWorkResponse, SubmitResponse, SystemSummary,
} from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { ensurePushSubscription, removePushSubscription, setSubscriptionsOverride, subscriptionBody } from "../worker/artifacts/subscriptions";
import { previewWorkerName, productionWorkerName, setCiOverride, workflowInstanceId, type CiBinding } from "../worker/deployments";
import type { SystemAuthority } from "../worker/do/system-authority";
import type { Evaluation as HookEvaluation, HookRunner, SubmissionContext } from "../worker/hooks/contract";
import { noopHookRunner, resetHooks, setHooks } from "../worker/hooks/index";
import { sha256Hex } from "../worker/util";
import { appFiles, genomeFiles } from "./fixtures/genome";
import { FakeArtifacts } from "./helpers/fake-artifacts";

const ADMIN = { authorization: "Bearer test-admin-token" };
const CI = { authorization: "Bearer test-ci-token" };
let seq = 0;

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: T }> {
  const res = await exports.default.fetch(new Request(`http://example.com/api${path}`, {
    method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }),
  }));
  return { status: res.status, json: (await res.json()) as T };
}

// ---------------------------------------------------------------- hooks: pass everything; C.webapp.health only with a preview

const REQUIRED = ["C.people.audit", "C.people.list", "C.people.sorted", "C.system.promotion", "C.webapp.exists"];
const seen: SubmissionContext[] = [];
const hookEval = (ctx: SubmissionContext, criterion: string, verdict: HookEvaluation["verdict"] = "pass"): HookEvaluation => {
  const at = new Date().toISOString();
  return {
    id: `${ctx.candidate.id}:hook:${criterion}:${seen.length}`, candidate: ctx.candidate.id, hook: `hook:${criterion}`, criterion, ownerId: "o", subjectId: "s",
    targetRef: criterion === "C.webapp.health" ? ctx.candidate.previewUrl! : ctx.candidate.commit, execution: "completed", verdict, verifier: "artyfact-platform",
    startedAt: at, finishedAt: at, observations: [], limitations: [], provenance: {},
  };
};
const runner: HookRunner = {
  async runSubmission(ctx) {
    seen.push(ctx);
    const out = REQUIRED.map((c) => (c === "C.system.promotion" && !ctx.promotionFacts
      ? { ...hookEval(ctx, c, "unknown"), execution: "not-run" as const, finishedAt: undefined } : hookEval(ctx, c)));
    return ctx.candidate.previewUrl ? [...out, hookEval(ctx, "C.webapp.health")] : out;
  },
  runGenome: (ctx) => noopHookRunner.runGenome(ctx),
  conflicts: async () => [],
};

// ---------------------------------------------------------------- fakes: CI Workflow and Cloudflare API

const created: { id: string; params: CiBuildParams }[] = [];
const fakeCi: CiBinding = {
  create: async (opts) => {
    created.push(opts as { id: string; params: CiBuildParams });
    return { id: opts!.id! } as WorkflowInstance;
  },
};
const apiCalls: { url: string; method: string; body: unknown; auth: string | null }[] = [];
const fakeApi = async (url: string, init: RequestInit) => {
  apiCalls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init.headers).get("authorization") });
  return init.method === "DELETE" ? Response.json({ success: true, result: null }) : Response.json({ success: true, result: { id: `sub-${apiCalls.length}` } });
};

beforeEach(() => {
  seen.length = 0;
  created.length = 0;
  apiCalls.length = 0;
  setHooks({ runner: () => runner });
  setCiOverride(null);
});
afterEach(() => {
  setArtifactsOverride(undefined);
  setCiOverride(undefined);
  setSubscriptionsOverride(undefined);
  resetHooks();
});

async function imported() {
  const ns = new FakeArtifacts();
  const n = ++seq;
  const systemId = `system.bkit${n}`;
  const genomeRepo = `bkit-system-${n}`, appRepo = `bkit-app-${n}`;
  ns.create(genomeRepo).commit({
    ...genomeFiles, "system.yaml": genomeFiles["system.yaml"].replace("system.kit", systemId), "criteria.yaml": genomeFiles["criteria.yaml"].replaceAll("system.kit", systemId),
  }, "genome");
  ns.create(appRepo).commit(appFiles, "scaffold");
  setArtifactsOverride(ns);
  const imp = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, genomeRepo, appRepo }, ADMIN);
  expect(imp.status, JSON.stringify(imp.json)).toBe(201);
  return { ns, systemId, appRepo, genomeRepo, imp: imp.json };
}

async function started(ctx: Awaited<ReturnType<typeof imported>>, evolution = "evolution.1") {
  const s = await call<StartWorkResponse>("POST", `/systems/${ctx.systemId}/evolutions/${evolution}/realizations`, { agentLabel: "a" }, ADMIN);
  expect(s.status, JSON.stringify(s.json)).toBe(201);
  return { rid: s.json.realization.id, secret: s.json.secret, fork: ctx.ns.repo(s.json.realization.workspace.fork), forkName: s.json.realization.workspace.fork };
}

async function submitted(ctx: Awaited<ReturnType<typeof imported>>) {
  const w = await started(ctx);
  const commit = w.fork.commit({ ...appFiles, "src/ui/people/list.ts": `export const list = [${seq}]` }, "people list");
  const sub = await call<SubmitResponse>("POST", `/systems/${ctx.systemId}/realizations/${w.rid}/submit`, { commit }, { authorization: `Bearer ${w.secret}` });
  expect(sub.status, JSON.stringify(sub.json)).toBe(201);
  return { ...w, commit, sub: sub.json };
}

const summary = async (systemId: string) => (await call<SystemSummary>("GET", `/systems/${systemId}`)).json;
const inDo = <T>(systemId: string, fn: (i: SystemAuthority, state: DurableObjectState) => T | Promise<T>) => runInDurableObject(env.SYSTEMS.getByName(systemId), fn);

// ---------------------------------------------------------------- store

describe("builds store (DO)", () => {
  const C1 = "1".repeat(40), C2 = "2".repeat(40);

  it("upserts idempotently and never lets a late running report replace a terminal status", async () => {
    await inDo(`system.store${++seq}`, (i) => {
      const base = { id: "b1", realization: "r1", candidate: null, commit: C1, kind: "preview" as const, reporter: "ci" as const };
      expect(i.upsertBuild({ ...base, status: "queued" }).changed).toBe(true);
      expect(i.upsertBuild({ ...base, status: "queued" }).changed).toBe(false);
      expect(i.upsertBuild({ ...base, status: "running", externalId: "inst" }).build).toMatchObject({ status: "running", externalId: "inst" });
      const failed = i.upsertBuild({ ...base, status: "failed", error: "tests failed" }).build;
      expect(failed).toMatchObject({ status: "failed", error: "tests failed", externalId: "inst" });
      expect(failed.finishedAt).toBeTruthy();
      const late = i.upsertBuild({ ...base, status: "running" });
      expect([late.changed, late.build.status]).toEqual([false, "failed"]);
      // A terminal status may be corrected by another terminal report; a passed report clears the error.
      const passed = i.upsertBuild({ ...base, status: "passed", url: "https://x.workers.dev" }).build;
      expect(passed).toMatchObject({ status: "passed", url: "https://x.workers.dev" });
      expect(passed.error).toBeUndefined();
      expect(i.builds({ realization: "r1" })).toHaveLength(1);
    });
  });

  it("latestBuild is per commit (and kind); candidate builds fall back to the realization's preview at that commit", async () => {
    await inDo(`system.store${++seq}`, (i) => {
      i.upsertBuild({ id: "a", realization: "r1", candidate: null, commit: C1, kind: "preview", status: "failed", reporter: "agent" });
      i.upsertBuild({ id: "b", realization: "r1", candidate: null, commit: C1, kind: "preview", status: "passed", reporter: "ci", url: "https://p" });
      i.upsertBuild({ id: "c", realization: null, candidate: null, commit: C2, kind: "production", status: "running", reporter: "ci" });
      expect(i.latestBuild(C1)?.id).toBe("b");
      expect(i.latestBuild(C2, "preview")).toBeNull();
      expect(i.latestBuild(C2, "production")?.status).toBe("running");
      expect(i.candidateBuilds([{ id: "cand", realization: "r1", commit: C1 }, { id: "none", realization: "r2", commit: C1 }])).toEqual({
        cand: { id: "b", status: "passed", kind: "preview", commit: C1, url: "https://p", finishedAt: expect.any(String) },
      });
      expect(i.builds({ commit: C2, kind: "production" }).map((b) => b.id)).toEqual(["c"]);
    });
  });

  it("a live deployment supersedes the previous live one of its scope; deployState follows the app commit", async () => {
    await inDo(`system.store${++seq}`, (i) => {
      expect(i.buildsSummary(C1)).toEqual({ latestBuild: null, deployment: { production: null, previews: 0 }, deployState: "none" });
      const d1 = i.createDeployment({ kind: "production", repo: "app", commit: C1, by: "admin" });
      expect(d1).toMatchObject({ id: "deployment.1", status: "pending" });
      expect(i.buildsSummary(C1).deployState).toBe("pending");
      expect(i.setDeploymentResult(d1.id, { status: "live", url: "https://app" })).toMatchObject({ status: "live", url: "https://app" });
      expect(i.buildsSummary(C1)).toMatchObject({ deployState: "live", deployment: { production: { id: d1.id } } });
      // The app commit moves on: production is behind until the new one is live.
      expect(i.buildsSummary(C2).deployState).toBe("behind");
      const d2 = i.createDeployment({ kind: "production", repo: "app", commit: C2, by: "admin" });
      expect(i.buildsSummary(C2).deployState).toBe("pending");
      i.setDeploymentResult(d2.id, { status: "failed" });
      expect(i.buildsSummary(C2).deployState).toBe("failed");
      const d3 = i.createDeployment({ kind: "production", status: "live", repo: "app", commit: C2, by: "admin" });
      expect(i.deployment(d1.id)!.status).toBe("superseded");
      expect(i.liveProduction()!.id).toBe(d3.id);
      expect(i.buildsSummary(C2).deployState).toBe("live");
      // A superseded deployment stays superseded; previews supersede per realization only.
      expect(i.setDeploymentResult(d1.id, { status: "live" })!.status).toBe("superseded");
      const p1 = i.createDeployment({ kind: "preview", status: "live", repo: "f1", commit: C1, realization: "r1", by: "ci" });
      const p2 = i.createDeployment({ kind: "preview", status: "live", repo: "f2", commit: C1, realization: "r2", by: "ci" });
      expect(i.buildsSummary(C2).deployment.previews).toBe(2);
      i.createDeployment({ kind: "preview", status: "live", repo: "f1", commit: C2, realization: "r1", by: "ci" });
      expect([i.deployment(p1.id)!.status, i.deployment(p2.id)!.status]).toEqual(["superseded", "live"]);
      expect(i.liveProduction()!.id).toBe(d3.id);
    });
  });
});

// ---------------------------------------------------------------- routes

describe("build report routes", () => {
  it("auth: realization reports take the CI token, the admin bearer or that realization's secret; System reports CI or admin", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    const b = await started(ctx);
    const path = `/systems/${ctx.systemId}/realizations/${a.rid}/builds`;
    const report = { status: "running", commit: a.commit };
    expect((await call<ApiError>("POST", path, report)).status).toBe(401);
    expect((await call<ApiError>("POST", path, report, { authorization: "Bearer nope" })).status).toBe(403);
    expect((await call<ApiError>("POST", path, report, { authorization: `Bearer ${b.secret}` })).status).toBe(403);
    const agent = await call<BuildReportResponse>("POST", path, report, { authorization: `Bearer ${a.secret}` });
    expect([agent.status, agent.json.build.reporter, agent.json.build.id]).toEqual([200, "agent", `build.${a.rid}.${a.commit.slice(0, 7)}.agent`]);
    expect((await call<BuildReportResponse>("POST", path, report, ADMIN)).json.build.reporter).toBe("admin");
    expect((await call<BuildReportResponse>("POST", path, report, CI)).json.build.reporter).toBe("ci");
    // An agent reports previews only.
    expect((await call<ApiError>("POST", path, { ...report, kind: "production" }, { authorization: `Bearer ${a.secret}` })).status).toBe(403);
    expect((await call<BuildsResponse>("GET", path, undefined, { authorization: `Bearer ${a.secret}` })).json.builds).toHaveLength(3);
    expect((await call<ApiError>("GET", path)).status).toBe(401);

    const sys = `/systems/${ctx.systemId}/builds`;
    expect((await call<ApiError>("POST", sys, report)).status).toBe(401);
    expect((await call<ApiError>("POST", sys, report, { authorization: `Bearer ${a.secret}` })).status).toBe(403);
    expect((await call<BuildReportResponse>("POST", sys, report, CI)).json.build).toMatchObject({ kind: "production", reporter: "ci", realization: null });
    expect((await call<BuildReportResponse>("POST", sys, report, ADMIN)).json.build.reporter).toBe("admin");
    // Reads are public, filtered by commit and kind.
    const reads = await call<BuildsResponse>("GET", `${sys}?commit=${a.commit}&kind=production`);
    expect(reads.json.builds.map((x) => x.reporter).sort()).toEqual(["admin", "ci"]);
    expect((await call<ApiError>("GET", `${sys}?commit=xyz`)).status).toBe(400);

    expect((await call<ApiError>("POST", `/systems/${ctx.systemId}/deployments`, {}, CI)).status).toBe(403);
    expect((await call<ApiError>("POST", `/systems/${ctx.systemId}/deployments/deployment.1/ingest-token`, {})).status).toBe(401);
  });

  it("validates reports and refuses to overwrite another realization's build", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    const path = `/systems/${ctx.systemId}/realizations/${a.rid}/builds`;
    for (const bad of [{ status: "done", commit: a.commit }, { status: "passed", commit: "abc" }, { status: "passed", commit: a.commit, url: "javascript:x" },
      { status: "passed", commit: a.commit, steps: [{ name: "x" }] }, { status: "passed", commit: a.commit, id: "../x" }]) {
      expect((await call<ApiError>("POST", path, bad, CI)).status, JSON.stringify(bad)).toBe(400);
    }
    await call("POST", `/systems/${ctx.systemId}/builds`, { id: "build.shared", status: "running", commit: a.commit }, CI);
    const clash = await call<ApiError>("POST", path, { id: "build.shared", status: "passed", commit: a.commit }, CI);
    expect([clash.status, clash.json.error.code]).toEqual([409, "build-mismatch"]);
    expect((await call<ApiError>("POST", path, { status: "passed", commit: a.commit, deploymentId: "deployment.99" }, CI)).status).toBe(404);
  });

  it("passed + url stores the preview on the candidate, re-runs the hooks and returns the evaluations (C.webapp.health)", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    expect(seen).toHaveLength(1);
    const url = `https://${previewWorkerName(ctx.systemId, 1)}.dawka.workers.dev`;
    const out = await call<BuildReportResponse>("POST", `/systems/${ctx.systemId}/realizations/${a.rid}/builds`,
      { status: "passed", commit: a.commit, url, buildId: a.commit, steps: [{ name: "deploy", status: "passed", durationMs: 1200 }] }, { authorization: `Bearer ${a.secret}` });
    expect(out.status, JSON.stringify(out.json)).toBe(200);
    expect(out.json.build).toMatchObject({ status: "passed", url, candidate: a.sub.candidate.id, buildId: a.commit, steps: [{ name: "deploy", durationMs: 1200 }] });
    expect(out.json.candidate?.id).toBe(a.sub.candidate.id);
    expect(out.json.candidate?.build).toMatchObject({ status: "passed", url });
    expect(out.json.evaluations?.map((e) => e.criterion)).toContain("C.webapp.health");
    expect(seen).toHaveLength(2);
    expect(seen[1].candidate.previewUrl).toBe(url);
    const manifest = await inDo(ctx.systemId, (i) => i.candidateManifest(a.sub.candidate.id));
    expect(manifest!.previewUrl).toBe(url);
    // Replaying the report changes nothing and runs no hooks.
    await call("POST", `/systems/${ctx.systemId}/realizations/${a.rid}/builds`, { status: "passed", commit: a.commit, url }, { authorization: `Bearer ${a.secret}` });
    expect(seen).toHaveLength(2);
    // Candidate lists and the realization view carry the build summary.
    const cands = await call<CandidatesResponse>("GET", `/systems/${ctx.systemId}/evolutions/evolution.1/candidates`);
    expect(cands.json.candidates[0].build?.status).toBe("passed");
    const view = await call<RealizationResponse>("GET", `/systems/${ctx.systemId}/realizations/${a.rid}`, undefined, ADMIN);
    expect(view.json.candidateDetail?.build?.url).toBe(url);
    expect((await summary(ctx.systemId)).latestBuild).toMatchObject({ status: "passed", commit: a.commit });
  });

  it("a failed report leaves the candidate untouched", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    const out = await call<BuildReportResponse>("POST", `/systems/${ctx.systemId}/realizations/${a.rid}/builds`,
      { status: "failed", commit: a.commit, url: "https://x.workers.dev", error: "npm test exited 1" }, CI);
    expect(out.json.build).toMatchObject({ status: "failed", error: "npm test exited 1" });
    expect(out.json.candidate).toBeUndefined();
    expect(seen).toHaveLength(1);
    expect((await inDo(ctx.systemId, (i) => i.candidateManifest(a.sub.candidate.id)))!.previewUrl).toBeUndefined();
  });
});

describe("CI dispatch", () => {
  it("submit dispatches a preview build only with the CI binding; the CI report flips the preview deployment live", async () => {
    const ctx = await imported();
    // Without CI: no build at all.
    const plain = await submitted(ctx);
    expect(created).toEqual([]);
    expect(plain.sub.candidate.build).toBeUndefined();

    setCiOverride(fakeCi);
    const w = await started(ctx);
    const commit = w.fork.commit({ ...appFiles, "src/ui/people/x.ts": "x" }, "x");
    const sub = await call<SubmitResponse>("POST", `/systems/${ctx.systemId}/realizations/${w.rid}/submit`, { commit }, { authorization: `Bearer ${w.secret}` });
    expect(sub.status).toBe(201);
    expect(created).toHaveLength(1);
    const { id: instanceId, params } = created[0];
    const buildId = `build.${w.rid}.${commit.slice(0, 7)}.ci`;
    expect(instanceId).toMatch(new RegExp(`^${buildId.replaceAll(".", "-")}-[0-9a-f]{8}$`));
    expect(params).toMatchObject({
      buildId, systemId: ctx.systemId, realizationId: w.rid, candidateId: sub.json.candidate.id, namespace: "artyfact", repo: w.forkName, commit,
      kind: "preview", workerName: `bkit${seq}-app-r2`, commands: { install: "npm install", test: "npm test", deploy: "npx wrangler deploy" },
      reportUrl: `http://localhost:1337/api/systems/${ctx.systemId}/realizations/${w.rid}/builds`, deploymentId: expect.stringMatching(/^deployment\.\d+$/),
    });
    expect(params.vars).toMatchObject({ BUILD_ID: commit, ARTYFACT_SYSTEM_ID: ctx.systemId, ARTYFACT_PLATFORM_URL: "http://localhost:1337", ARTYFACT_DEPLOYMENT_ID: params.deploymentId });
    expect(params.vars.ARTYFACT_INGEST_TOKEN).toMatch(/^[0-9a-f]{64}$/);
    expect(sub.json.candidate.build).toMatchObject({ id: buildId, status: "queued", kind: "preview", commit });
    const stored = await inDo(ctx.systemId, (i) => ({ build: i.build(buildId), dep: i.deployment(params.deploymentId!) }));
    expect(stored.build).toMatchObject({ reporter: "ci", externalId: instanceId, candidate: sub.json.candidate.id });
    expect(stored.dep).toMatchObject({ kind: "preview", status: "pending", realization: w.rid, build: buildId });
    const hash = await inDo(ctx.systemId, async (_i, state) =>
      state.storage.sql.exec("SELECT ingest_token_hash AS h FROM deployments WHERE id = ?", params.deploymentId!).one().h);
    expect(hash).toBe(await sha256Hex(params.vars.ARTYFACT_INGEST_TOKEN));

    // Resubmitting the same commit dispatches nothing new.
    await call("POST", `/systems/${ctx.systemId}/realizations/${w.rid}/submit`, { commit }, { authorization: `Bearer ${w.secret}` });
    expect(created).toHaveLength(1);

    // The Workflow's reports: running, then passed with the workers.dev URL.
    const path = `/systems/${ctx.systemId}/realizations/${w.rid}/builds`;
    await call("POST", path, { id: buildId, status: "running", kind: "preview", commit, externalId: instanceId, deploymentId: params.deploymentId }, CI);
    const url = `https://${params.workerName}.dawka.workers.dev`;
    const passed = await call<BuildReportResponse>("POST", path, { id: buildId, status: "passed", kind: "preview", commit, url, buildId: commit, deploymentId: params.deploymentId }, CI);
    expect(passed.status, JSON.stringify(passed.json)).toBe(200);
    expect(passed.json.evaluations?.find((e) => e.criterion === "C.webapp.health")?.targetRef).toBe(url);
    const deps = await call<DeploymentsResponse>("GET", `/systems/${ctx.systemId}/deployments`);
    expect(deps.json.production).toBeNull();
    expect(deps.json.history.find((d) => d.id === params.deploymentId)).toMatchObject({ status: "live", url, buildId: commit, candidate: sub.json.candidate.id });
    expect((await summary(ctx.systemId)).deployment?.previews).toBe(1);
  });

  it("a Genome realization is never built", async () => {
    setCiOverride(fakeCi);
    const ctx = await imported();
    const w = await started(ctx, "evolution.2");
    const files = new Map<string, string>();
    for (const p of Object.keys(genomeFiles)) files.set(p, (await (await w.fork.readFile({ ref: ctx.imp.genomeCommit, path: p }))!.text()));
    files.set("things/webapp/ontology.yaml", files.get("things/webapp/ontology.yaml")!.replace("name: Contact record", "name: Contact record v2"));
    const commit = w.fork.commit(files, "amend");
    const sub = await call<SubmitResponse>("POST", `/systems/${ctx.systemId}/realizations/${w.rid}/submit`, { commit }, { authorization: `Bearer ${w.secret}` });
    expect(sub.status, JSON.stringify(sub.json)).toBe(201);
    expect(created).toEqual([]);
  });

  it("a Workflow that cannot start records an error build and a failed deployment; submit still succeeds", async () => {
    setCiOverride({ create: async () => { throw new Error("workflow not found"); } });
    const ctx = await imported();
    const a = await submitted(ctx);
    expect(a.sub.candidate.build).toMatchObject({ status: "error" });
    const b = await inDo(ctx.systemId, (i) => i.builds({ realization: a.rid })[0]);
    expect(b.error).toContain("workflow not found");
    expect((await call<DeploymentsResponse>("GET", `/systems/${ctx.systemId}/deployments`)).json.history[0].status).toBe("failed");
  });

  it("promote requests a production deploy with CI params; the CI report flips it live; summary shows deployState", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    setCiOverride(fakeCi);
    const promoted = await call<PromoteResponse>("POST", `/systems/${ctx.systemId}/promote`,
      { candidateIds: [a.sub.candidate.id], expectedHead: ctx.imp.head, rationale: "ok" }, ADMIN);
    expect(promoted.status, JSON.stringify(promoted.json)).toBe(200);
    expect(created).toHaveLength(1);
    const { params } = created[0];
    expect(params).toMatchObject({
      kind: "production", workerName: productionWorkerName(ctx.systemId), commit: a.commit, repo: a.forkName, realizationId: null, candidateId: null,
      reportUrl: `http://localhost:1337/api/systems/${ctx.systemId}/builds`, deploymentId: expect.any(String),
    });
    expect(params.workerName).toBe(`bkit${seq}-app`);
    expect(params.vars.BUILD_ID).toBe(a.commit);
    expect(params.vars.ARTYFACT_SYSTEM_COMMIT).toBe(promoted.json.commit.id);
    let deps = await call<DeploymentsResponse>("GET", `/systems/${ctx.systemId}/deployments`);
    expect(deps.json.history[0]).toMatchObject({ id: params.deploymentId, kind: "production", status: "pending", systemCommit: promoted.json.commit.id, realization: a.rid, build: params.buildId });
    expect((await summary(ctx.systemId)).deployState).toBe("pending");

    const url = `https://${params.workerName}.dawka.workers.dev`;
    const rep = await call<BuildReportResponse>("POST", `/systems/${ctx.systemId}/builds`,
      { id: params.buildId, status: "passed", kind: "production", commit: a.commit, url, buildId: a.commit, deploymentId: params.deploymentId }, CI);
    expect(rep.status, JSON.stringify(rep.json)).toBe(200);
    deps = await call<DeploymentsResponse>("GET", `/systems/${ctx.systemId}/deployments`);
    expect(deps.json.production).toMatchObject({ id: params.deploymentId, status: "live", url, commit: a.commit });
    const sum = await summary(ctx.systemId);
    expect(sum.deployState).toBe("live");
    expect(sum.deployment?.production?.id).toBe(params.deploymentId);
    // The registry copy (GET /systems) carries it too.
    const list = await call<{ systems: SystemSummary[] }>("GET", "/systems");
    expect(list.json.systems.find((s) => s.systemId === ctx.systemId)?.deployState).toBe("live");
  });

  it("without CI a promotion leaves a pending deployment; the admin records it live and gets the ingest token once", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    const promoted = await call<PromoteResponse>("POST", `/systems/${ctx.systemId}/promote`,
      { candidateIds: [a.sub.candidate.id], expectedHead: ctx.imp.head, rationale: "ok" }, ADMIN);
    expect(promoted.status).toBe(200);
    const pending = (await call<DeploymentsResponse>("GET", `/systems/${ctx.systemId}/deployments`)).json.history[0];
    expect(pending.status).toBe("pending");

    const rec = await call<DeploymentCreated>("POST", `/systems/${ctx.systemId}/deployments`, { url: "https://bkit-app.dawka.workers.dev" }, ADMIN);
    expect(rec.status, JSON.stringify(rec.json)).toBe(201);
    expect(rec.json).toMatchObject({ id: pending.id, status: "live", commit: a.commit, url: "https://bkit-app.dawka.workers.dev" });
    expect(rec.json.ingestToken).toMatch(/^[0-9a-f]{64}$/);
    const listed = await call<DeploymentsResponse>("GET", `/systems/${ctx.systemId}/deployments`);
    expect(JSON.stringify(listed.json)).not.toContain(rec.json.ingestToken);
    expect(await inDo(ctx.systemId, async (i) => i.deploymentByIngestHash(await sha256Hex(rec.json.ingestToken!))?.id)).toBe(pending.id);

    const rot = await call<IngestTokenResponse>("POST", `/systems/${ctx.systemId}/deployments/${pending.id}/ingest-token`, {}, ADMIN);
    expect(rot.status).toBe(200);
    expect(rot.json.ingestToken).not.toBe(rec.json.ingestToken);
    expect(await inDo(ctx.systemId, async (i) => i.deploymentByIngestHash(await sha256Hex(rec.json.ingestToken!)))).toBeNull();
    expect((await call<ApiError>("POST", `/systems/${ctx.systemId}/deployments/deployment.99/ingest-token`, {}, ADMIN)).status).toBe(404);

    // A second manual record supersedes the first.
    const again = await call<DeploymentCreated>("POST", `/systems/${ctx.systemId}/deployments`, {}, ADMIN);
    expect(again.json.id).not.toBe(pending.id);
    const after = await call<DeploymentsResponse>("GET", `/systems/${ctx.systemId}/deployments`);
    expect(after.json.production?.id).toBe(again.json.id);
    expect(after.json.history.find((d) => d.id === pending.id)?.status).toBe("superseded");
    expect((await call<ApiError>("POST", `/systems/${ctx.systemId}/deployments`, { commit: "nope" }, ADMIN)).status).toBe(400);
  });

  it("names: instance ids drop characters Workflows refuse; worker names are lower-case dashes", () => {
    expect(workflowInstanceId("build.realization.1.r2.abcdef0.ci")).toMatch(/^build-realization-1-r2-abcdef0-ci-[0-9a-f]{8}$/);
    expect(previewWorkerName("system.keep-in-touch", 3)).toBe("keep-in-touch-app-r3");
    expect(productionWorkerName("system.my_app.v2")).toBe("my-app-v2-app");
  });
});

describe("push subscriptions", () => {
  const cfg = { token: "cf-token", queueId: "queue-1", accountId: "acc-1" };

  it("creates a repo-level pushed subscription to the events queue, and is a no-op without a token", async () => {
    setSubscriptionsOverride({ fetch: fakeApi, config: cfg });
    expect(await ensurePushSubscription(env, "kit.app--r1")).toBe("sub-1");
    expect(apiCalls[0]).toEqual({
      url: "https://api.cloudflare.com/client/v4/accounts/acc-1/event_subscriptions/subscriptions", method: "POST", auth: "Bearer cf-token",
      body: subscriptionBody("artyfact", "kit.app--r1", "queue-1"),
    });
    expect(apiCalls[0].body).toMatchObject({ source: { type: "artifacts.repo", namespace: "artyfact", repo_name: "kit.app--r1" }, events: ["pushed"], destination: { type: "queues.queue", queue_id: "queue-1" } });
    expect(await removePushSubscription(env, "sub-1")).toBe(true);
    expect(apiCalls[1]).toMatchObject({ method: "DELETE", url: "https://api.cloudflare.com/client/v4/accounts/acc-1/event_subscriptions/subscriptions/sub-1" });

    setSubscriptionsOverride({ fetch: fakeApi });
    expect(await ensurePushSubscription(env, "kit.app--r1")).toBeNull();
    expect(await removePushSubscription(env, "sub-1")).toBe(false);
    expect(apiCalls).toHaveLength(2);

    setSubscriptionsOverride({ fetch: async () => Response.json({ success: false, errors: [{ message: "nope" }] }, { status: 400 }), config: cfg });
    expect(await ensurePushSubscription(env, "kit.app--r1")).toBeNull();
  });

  it("start work stores the fork's subscription; reject and promotion remove theirs", async () => {
    setSubscriptionsOverride({ fetch: fakeApi, config: cfg });
    const ctx = await imported();
    const a = await submitted(ctx);
    const b = await started(ctx);
    const c = await started(ctx);
    expect(apiCalls.filter((x) => x.method === "POST").map((x) => (x.body as { source: { repo_name: string } }).source.repo_name)).toEqual([a.forkName, b.forkName, c.forkName]);
    const subOf = (rid: string) => inDo(ctx.systemId, (i) => i.realizationSubscription(rid));
    expect(await subOf(a.rid)).toBe("sub-1");

    expect((await call("POST", `/systems/${ctx.systemId}/realizations/${c.rid}/reject`, { reason: "no" }, ADMIN)).status).toBe(200);
    expect(apiCalls.at(-1)).toMatchObject({ method: "DELETE", url: expect.stringMatching(/\/sub-3$/) });
    expect(await subOf(c.rid)).toBeNull();

    const promoted = await call<PromoteResponse>("POST", `/systems/${ctx.systemId}/promote`,
      { candidateIds: [a.sub.candidate.id], expectedHead: ctx.imp.head, rationale: "ok" }, ADMIN);
    expect(promoted.status, JSON.stringify(promoted.json)).toBe(200);
    expect(apiCalls.filter((x) => x.method === "DELETE").map((x) => x.url.split("/").at(-1)).sort()).toEqual(["sub-1", "sub-3"]);
    expect(await subOf(a.rid)).toBeNull();
    // b had no candidate, so the promotion did not end it: its subscription stays.
    expect(await subOf(b.rid)).toBe("sub-2");
  });
});
