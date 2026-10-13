import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ApiError, BuildReportResponse, BuildsResponse, CandidatesResponse, CiBuildParams, DeploymentCreated, DeploymentsResponse, EvaluateCandidateResponse, ImportSystemResponse,
  IngestTokenResponse, PromoteResponse, RealizationResponse, RealizedArtifactsResponse, StartWorkResponse, SubmitResponse, SystemSummary,
} from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { ensurePushSubscription, removePushSubscription, setSubscriptionsOverride, subscriptionBody } from "../worker/artifacts/subscriptions";
import { ALLOWED_COMMANDS, assertAllowedCommands, previewWorkerName, productionWorkerName, setCiOverride, workflowInstanceId, type CiBinding } from "../worker/deployments";
import type { SystemAuthority } from "../worker/do/system-authority";
import type { Evaluation as HookEvaluation, HookRunner, SubmissionContext } from "../worker/hooks/contract";
import { httpHealth } from "../worker/hooks/http-health";
import { noopHookRunner, resetHooks, setHooks } from "../worker/hooks/index";
import { sha256Hex } from "../worker/util";
import { appFiles, genomeFiles, genomeFor } from "./fixtures/genome";
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
    ...genomeFor(systemId),
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

  it("records one independently identified realized artifact per build while preserving shared source lineage", async () => {
    await inDo(`system.outputs${++seq}`, (i) => {
      const lineage = {
        realization: null, candidate: null, commit: C1, kind: "production" as const, status: "passed" as const, reporter: "ci" as const,
        sourceRepo: "kit-app", genomeCommit: C2, thingId: "thing.webapp", artifactId: "artifact.webapp",
      };
      const first = i.upsertBuild({ id: "build.one", ...lineage, output: { locator: "workers-version:v1", digest: "sha256:one" } }).build;
      const second = i.upsertBuild({ id: "build.two", ...lineage, output: { locator: "workers-version:v2", digest: "sha256:two" } }).build;

      expect(first.output).toMatchObject({
        id: "output.build.one", build: "build.one", thingId: "thing.webapp", artifactId: "artifact.webapp",
        source: { repo: "kit-app", commit: C1 }, genomeCommit: C2, locator: "workers-version:v1", digest: "sha256:one",
      });
      expect(second.output).toMatchObject({ id: "output.build.two", build: "build.two", source: { repo: "kit-app", commit: C1 } });
      expect(i.realizedArtifacts().map((x) => x.id).sort()).toEqual(["output.build.one", "output.build.two"]);
      expect(i.realizedArtifactForBuild("build.one")).toEqual(first.output);
      expect(i.realizedArtifact("output.build.two")).toEqual(second.output);
    });
  });

  it("does not invent outputs and refuses output mutation or ownership drift on replay", async () => {
    await inDo(`system.output-replay${++seq}`, (i) => {
      const base = {
        id: "build.same", realization: null, candidate: null, commit: C1, kind: "production" as const, status: "passed" as const, reporter: "ci" as const,
        sourceRepo: "kit-app", genomeCommit: C2, thingId: "thing.webapp", artifactId: "artifact.webapp",
      };
      expect(i.upsertBuild(base).build.output).toBeUndefined();
      expect(i.realizedArtifacts()).toEqual([]);
      const created = i.upsertBuild({ ...base, output: { digest: "sha256:same" } }).build.output;
      expect(created).toMatchObject({ id: "output.build.same", digest: "sha256:same" });
      expect(i.upsertBuild({ ...base, output: { digest: "sha256:same" } }).build.output).toEqual(created);
      expect(() => i.upsertBuild({ ...base, output: { digest: "sha256:different" } })).toThrow(/cannot change/i);
      expect(() => i.upsertBuild({ ...base, thingId: "thing.other", output: { digest: "sha256:same" } })).toThrow(/lineage/i);
    });
  });

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
    // Reads are public.
    const listed = await call<BuildsResponse>("GET", path);
    expect([listed.status, listed.json.builds.length]).toEqual([200, 3]);

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

  it("System reports check the CI token and the admin bearer directly: 401 without a bearer, 403 for any other", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    const sys = `/systems/${ctx.systemId}/builds`;
    const report = { status: "running", commit: a.commit };
    const codes = async (headers: Record<string, string>) => {
      const r = await call<ApiError & BuildReportResponse>("POST", sys, report, headers);
      return [r.status, r.json.error?.code ?? r.json.build.reporter];
    };
    expect(await codes({})).toEqual([401, "unauthorized"]);
    expect(await codes({ authorization: "Basic test-admin-token" })).toEqual([401, "unauthorized"]);
    expect(await codes({ authorization: "Bearer test-admin-tokenX" })).toEqual([403, "forbidden"]);
    expect(await codes({ authorization: `Bearer ${a.secret}` })).toEqual([403, "forbidden"]);
    expect(await codes(ADMIN)).toEqual([200, "admin"]);
    expect(await codes(CI)).toEqual([200, "ci"]);
  });

  it("an agent reports only its candidates' commits or its fork head", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    const path = `/systems/${ctx.systemId}/realizations/${a.rid}/builds`;
    const agent = { authorization: `Bearer ${a.secret}` };
    const head = a.fork.commit({ ...appFiles, "src/ui/people/next.ts": "next" }, "unsubmitted head");
    const stranger = "f".repeat(40);
    // A candidate commit (no longer the head) and the unsubmitted head are both fine.
    expect((await call<BuildReportResponse>("POST", path, { status: "running", commit: a.commit }, agent)).status).toBe(200);
    expect((await call<BuildReportResponse>("POST", path, { status: "running", commit: head }, agent)).status).toBe(200);
    // Any other commit is refused before anything is recorded.
    const refused = await call<ApiError>("POST", path, { status: "passed", commit: stranger, url: "https://x.workers.dev" }, agent);
    expect([refused.status, refused.json.error.code]).toEqual([422, "unknown-commit"]);
    expect((await call<BuildsResponse>("GET", `/systems/${ctx.systemId}/builds?commit=${stranger}`)).json.builds).toEqual([]);
    // The CI token and the admin are not limited this way (CI builds what the platform dispatched).
    expect((await call<BuildReportResponse>("POST", path, { status: "running", commit: stranger }, CI)).status).toBe(200);
  });

  it("an agent cannot name CI's build row or a deployment, and cannot overwrite a CI-reported row", async () => {
    setCiOverride(fakeCi);
    const ctx = await imported();
    const a = await submitted(ctx);
    const { params } = created[0];
    const path = `/systems/${ctx.systemId}/realizations/${a.rid}/builds`;
    const agent = { authorization: `Bearer ${a.secret}` };
    const own = `build.${a.rid}.${a.commit.slice(0, 7)}.agent`;
    // A client id and deployment id are ignored: the report lands on the agent's own row.
    const r = await call<BuildReportResponse>("POST", path, { id: params.buildId, status: "failed", commit: a.commit, deploymentId: params.deploymentId }, agent);
    expect([r.status, r.json.build.id, r.json.build.reporter]).toEqual([200, own, "agent"]);
    const after = await inDo(ctx.systemId, (i) => ({ ci: i.build(params.buildId), dep: i.deployment(params.deploymentId!) }));
    expect(after.ci).toMatchObject({ status: "queued", reporter: "ci" });
    expect(after.dep).toMatchObject({ status: "pending" });
    // A row CI reported is never updated by the agent.
    const head = a.fork.commit({ ...appFiles, "src/ui/people/head.ts": "h" }, "head");
    await inDo(ctx.systemId, (i) => i.upsertBuild({ id: `build.${a.rid}.${head.slice(0, 7)}.agent`, realization: a.rid, candidate: null, commit: head, kind: "preview", status: "running", reporter: "ci" }));
    const denied = await call<ApiError>("POST", path, { status: "passed", commit: head }, agent);
    expect([denied.status, denied.json.error.code]).toEqual([403, "forbidden"]);
  });

  it("a passed production report without a deployment id needs the app commit or a pending deployment (409 not-promoted)", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    const sys = `/systems/${ctx.systemId}/builds`;
    for (const headers of [CI, ADMIN]) {
      const r = await call<ApiError>("POST", sys, { status: "passed", commit: a.commit, url: "https://evil.workers.dev" }, headers);
      expect([r.status, r.json.error.code]).toEqual([409, "not-promoted"]);
    }
    let deps = await call<DeploymentsResponse>("GET", `/systems/${ctx.systemId}/deployments`);
    expect(deps.json.production).toBeNull();
    expect((await call<BuildsResponse>("GET", `${sys}?commit=${a.commit}&kind=production`)).json.builds).toEqual([]);
    // Non-passed reports for that commit are only build records.
    expect((await call<BuildReportResponse>("POST", sys, { status: "failed", commit: a.commit }, CI)).status).toBe(200);
    // The head's app commit may be recorded live.
    const ok = await call<BuildReportResponse>("POST", sys, { status: "passed", commit: ctx.imp.appCommit, url: "https://app.workers.dev" }, CI);
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    deps = await call<DeploymentsResponse>("GET", `/systems/${ctx.systemId}/deployments`);
    expect(deps.json.production).toMatchObject({ commit: ctx.imp.appCommit, status: "live", url: "https://app.workers.dev", repo: ctx.appRepo });
    // Once promoted (without CI: a pending deployment), the candidate's commit may go live too.
    const promoted = await call<PromoteResponse>("POST", `/systems/${ctx.systemId}/promote`,
      { candidateIds: [a.sub.candidate.id], expectedHead: ctx.imp.head, rationale: "ok" }, ADMIN);
    expect(promoted.status).toBe(200);
    const live = await call<BuildReportResponse>("POST", sys, { status: "passed", commit: a.commit, url: "https://app.workers.dev" }, CI);
    expect(live.status, JSON.stringify(live.json)).toBe(200);
    expect((await call<DeploymentsResponse>("GET", `/systems/${ctx.systemId}/deployments`)).json.production).toMatchObject({ commit: a.commit, status: "live" });
  });

  it("validates reports and refuses to overwrite another realization's build", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    const path = `/systems/${ctx.systemId}/realizations/${a.rid}/builds`;
    for (const bad of [{ status: "done", commit: a.commit }, { status: "passed", commit: "abc" }, { status: "passed", commit: a.commit, url: "javascript:x" },
      { status: "passed", commit: a.commit, steps: [{ name: "x" }] }, { status: "passed", commit: a.commit, id: "../x" },
      { status: "passed", commit: a.commit, output: {} }, { status: "running", commit: a.commit, output: { digest: "sha256:x" } }]) {
      expect((await call<ApiError>("POST", path, bad, CI)).status, JSON.stringify(bad)).toBe(400);
    }
    await call("POST", `/systems/${ctx.systemId}/builds`, { id: "build.shared", status: "running", commit: a.commit }, CI);
    const clash = await call<ApiError>("POST", path, { id: "build.shared", status: "passed", commit: a.commit }, CI);
    expect([clash.status, clash.json.error.code]).toEqual([409, "build-mismatch"]);
    expect((await call<ApiError>("POST", path, { status: "passed", commit: a.commit, deploymentId: "deployment.99" }, CI)).status).toBe(404);
  });

  it("cannot attribute a Genome realization build to an application artifact", async () => {
    const ctx = await imported();
    const secret = "genome-output-secret";
    const hash = await sha256Hex(secret);
    const rid = await inDo(ctx.systemId, (i) => {
      const r = i.reserveRealization({ evolutionId: "evolution.1", target: "genome", agentLabel: "genome" });
      i.activateRealization(r.realization.id, { tokenId: "genome-token", tokenExpires: new Date(Date.now() + 1e6).toISOString(), remote: "x", packet: { hash: "h" } as never, secretHash: hash });
      i.recordCandidate({ realizationId: r.realization.id, commit: ctx.imp.genomeCommit, manifest: {}, changedPaths: [], changedNodes: [] });
      return r.realization.id;
    });
    const response = await call<ApiError>("POST", `/systems/${ctx.systemId}/realizations/${rid}/builds`, {
      status: "passed", commit: ctx.imp.genomeCommit, output: { locator: "workers-version:genome-is-not-app" },
    }, { authorization: `Bearer ${secret}` });
    expect(response.status, JSON.stringify(response.json)).toBe(409);
    expect(response.json.error.code).toBe("output-lineage-unknown");
    expect(await inDo(ctx.systemId, (i) => i.realizedArtifacts())).toEqual([]);
  });

  it("redeploys one realized output as distinct deployment instances with validated source ownership", async () => {
    const ctx = await imported();
    await inDo(ctx.systemId, (i) => {
      const state = i.state()!;
      i.upsertBuild({ id: "build.reusable", realization: null, candidate: null, kind: "production", status: "passed", reporter: "ci",
        commit: ctx.imp.appCommit!, sourceRepo: state.appSource!.repo, genomeCommit: state.genomeCommit,
        thingId: "thing.webapp", artifactId: "artifact.webapp", buildId: "runtime.reusable", output: { locator: "workers-version:reusable" } });
    });
    const path = `/systems/${ctx.systemId}/deployments`;
    const first = await call<DeploymentCreated>("POST", path, { outputId: "output.build.reusable", url: "https://one.workers.dev" }, ADMIN);
    const second = await call<DeploymentCreated>("POST", path, { outputId: "output.build.reusable", url: "https://two.workers.dev" }, ADMIN);
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    expect(second.status, JSON.stringify(second.json)).toBe(201);
    expect(first.json.id).not.toBe(second.json.id);
    expect(first.json.output).toBe("output.build.reusable");
    expect(second.json).toMatchObject({ output: "output.build.reusable", build: "build.reusable", buildId: "runtime.reusable" });
    expect((await call<ApiError>("POST", path, { outputId: "output.missing" }, ADMIN)).status).toBe(404);
    expect((await call<ApiError>("POST", path, { outputId: "output.build.reusable", commit: "f".repeat(40) }, ADMIN)).status).toBe(409);
    await inDo(ctx.systemId, (i) => {
      i.upsertBuild({ id: "build.foreign", realization: null, candidate: null, kind: "production", status: "passed", reporter: "ci",
        commit: ctx.imp.appCommit!, sourceRepo: "another-repo", genomeCommit: i.state()!.genomeCommit,
        thingId: "thing.webapp", artifactId: "artifact.webapp", output: { digest: "sha256:foreign" } });
    });
    expect((await call<ApiError>("POST", path, { outputId: "output.build.foreign" }, ADMIN)).status).toBe(409);
  });

  it("binds the first passed runtime build before hooks create its candidate", async () => {
    const ctx = await imported();
    const a = await started(ctx);
    const commit = a.fork.commit({ ...appFiles, "src/ui/people/list.ts": "export const first = true" }, "first candidate");
    const url = `https://${previewWorkerName(ctx.systemId, 1)}.dawka.workers.dev`;
    const response = await call<BuildReportResponse>("POST", `/systems/${ctx.systemId}/realizations/${a.rid}/builds`, {
      status: "passed", commit, url, buildId: "build.first.unique",
    }, { authorization: `Bearer ${a.secret}` });
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    expect(seen.at(-1)?.candidate).toMatchObject({ commit, previewUrl: url, expectedBuildId: "build.first.unique" });
  });

  it("passed + url stores the preview on the candidate, re-runs the hooks and returns the evaluations (C.webapp.health)", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    expect(seen).toHaveLength(1);
    const url = `https://${previewWorkerName(ctx.systemId, 1)}.dawka.workers.dev`;
    const out = await call<BuildReportResponse>("POST", `/systems/${ctx.systemId}/realizations/${a.rid}/builds`,
      { status: "passed", commit: a.commit, url, buildId: "build.preview.unique", steps: [{ name: "deploy", status: "passed", durationMs: 1200 }] }, { authorization: `Bearer ${a.secret}` });
    expect(out.status, JSON.stringify(out.json)).toBe(200);
    expect(out.json.build).toMatchObject({ status: "passed", url, candidate: a.sub.candidate.id, buildId: "build.preview.unique", steps: [{ name: "deploy", durationMs: 1200 }] });
    expect(out.json.candidate?.id).toBe(a.sub.candidate.id);
    expect(out.json.candidate?.build).toMatchObject({ status: "passed", url });
    expect(out.json.evaluations?.map((e) => e.criterion)).toContain("C.webapp.health");
    expect(seen).toHaveLength(2);
    expect(seen[1].candidate.previewUrl).toBe(url);
    expect(seen[1].candidate.expectedBuildId).toBe("build.preview.unique");
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

  it("keeps a preview output on the realization's starting Genome after the canonical Genome advances", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    const laterGenome = "e".repeat(40);
    await inDo(ctx.systemId, (_i, state) => state.storage.sql.exec("UPDATE head SET v = ? WHERE k = 'genome_commit'", laterGenome));
    const out = await call<BuildReportResponse>("POST", `/systems/${ctx.systemId}/realizations/${a.rid}/builds`, {
      id: "build.old-genome", status: "passed", commit: a.commit, output: { digest: "sha256:old-genome-output" },
    }, CI);
    expect(out.status, JSON.stringify(out.json)).toBe(200);
    expect(out.json.build.output).toMatchObject({ genomeCommit: ctx.imp.genomeCommit, source: { repo: a.forkName, commit: a.commit } });
    expect(out.json.build.output?.genomeCommit).not.toBe(laterGenome);
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

describe("candidate re-evaluation", () => {
  // The preview keeps serving the previous build past every health retry, then switches.
  let served = "build.previous";
  const preview = (async () => Response.json({ status: "ok", buildId: served })) as unknown as typeof fetch;
  const healthRunner: HookRunner = {
    ...runner,
    async runSubmission(ctx) {
      seen.push(ctx);
      if (!ctx.candidate.previewUrl) return [];
      const o = await httpHealth({ previewUrl: ctx.candidate.previewUrl, commit: ctx.candidate.commit, expectedBuildId: ctx.candidate.expectedBuildId, fetch: preview, sleep: async () => {} });
      return [{ ...hookEval(ctx, "C.webapp.health", o.verdict), execution: o.execution, observations: o.observations }];
    },
  };
  beforeEach(() => {
    served = "build.previous";
    setHooks({ runner: () => healthRunner });
  });
  const evaluatePath = (systemId: string, cid: string) => `/systems/${systemId}/candidates/${encodeURIComponent(cid)}/evaluate`;

  it("re-runs a candidate's hooks with its preview and passed build, replacing the failed health evaluation", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    const url = `https://${previewWorkerName(ctx.systemId, 1)}.dawka.workers.dev`;
    const rep = await call<BuildReportResponse>("POST", `/systems/${ctx.systemId}/realizations/${a.rid}/builds`, { status: "passed", commit: a.commit, url, buildId: "build.new" }, CI);
    expect(rep.json.evaluations).toMatchObject([{ criterion: "C.webapp.health", verdict: "fail", observations: [{ buildId: "build.previous", attempts: 4 }] }]);
    // Re-submitting the commit does not re-run anything.
    await call("POST", `/systems/${ctx.systemId}/realizations/${a.rid}/submit`, { commit: a.commit }, { authorization: `Bearer ${a.secret}` });
    const runs = seen.length;

    served = "build.new";
    const out = await call<EvaluateCandidateResponse>("POST", evaluatePath(ctx.systemId, a.sub.candidate.id), undefined, ADMIN);
    expect(out.status, JSON.stringify(out.json)).toBe(200);
    expect(seen).toHaveLength(runs + 1);
    expect(seen.at(-1)?.candidate).toMatchObject({ previewUrl: url, expectedBuildId: "build.new" });
    expect(out.json.candidate).toMatchObject({ id: a.sub.candidate.id, state: "evaluated" });
    expect(out.json.evaluations).toMatchObject([{ criterion: "C.webapp.health", verdict: "pass", observations: [{ buildId: "build.new", attempts: 1 }] }]);
    expect(out.json.realization.id).toBe(a.rid);
  });

  it("is admin only, 404 for an unknown candidate and 409 for a promoted one", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    const path = evaluatePath(ctx.systemId, a.sub.candidate.id);
    expect((await call<ApiError>("POST", path)).status).toBe(401);
    expect((await call<ApiError>("POST", path, undefined, { authorization: `Bearer ${a.secret}` })).status).toBe(403);
    expect((await call<ApiError>("POST", path, undefined, CI)).status).toBe(403);
    expect((await call<ApiError>("POST", evaluatePath(ctx.systemId, "candidate.nope"), undefined, ADMIN)).status).toBe(404);
    const runs = seen.length;
    await inDo(ctx.systemId, (_i, state) => state.storage.sql.exec("UPDATE candidates SET state = 'promoted' WHERE id = ?", a.sub.candidate.id));
    const refused = await call<ApiError>("POST", path, undefined, ADMIN);
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe("invalid-state");
    expect(seen).toHaveLength(runs);
  });

  it("refuses (409) when the candidate is promoted while its hooks re-run, keeping the promotion evidence", async () => {
    const ctx = await imported();
    const a = await submitted(ctx);
    const id = a.sub.candidate.id;
    const promotionEval = { ...hookEval(seen[0], "C.system.promotion"), id: `${id}:promotion` };
    setHooks({
      runner: () => ({
        ...healthRunner,
        async runSubmission(hctx) {
          // A promotion lands mid-run: it records its own evaluations and closes the candidate.
          await inDo(ctx.systemId, (i, state) => {
            i.recordEvaluations(id, [promotionEval]);
            state.storage.sql.exec("UPDATE candidates SET state = 'promoted' WHERE id = ?", id);
          });
          return [hookEval(hctx, "C.webapp.exists", "fail")];
        },
      }),
    });
    const out = await call<ApiError>("POST", evaluatePath(ctx.systemId, id), undefined, ADMIN);
    expect(out.status, JSON.stringify(out.json)).toBe(409);
    expect(out.json.error.code).toBe("invalid-state");
    const evals = await inDo(ctx.systemId, (i) => i.evaluations(id));
    expect(evals.find((e) => e.id === promotionEval.id)).toMatchObject({ criterion: "C.system.promotion", verdict: "pass" });
    expect(evals.some((e) => e.criterion === "C.webapp.exists" && e.verdict === "fail")).toBe(false);
    // The claim was released.
    expect(await inDo(ctx.systemId, (i) => i.claimEvaluation(id))).toBe(true);
  });

  it("promotion is refused (409) while a re-run holds the candidate's claim", async () => {
    setHooks({ runner: () => runner });
    const ctx = await imported();
    const a = await submitted(ctx);
    const id = a.sub.candidate.id;
    const promote = () => call<ApiError>("POST", `/systems/${ctx.systemId}/promote`, { candidateIds: [id], expectedHead: ctx.imp.head, rationale: "ok" }, ADMIN);
    expect(await inDo(ctx.systemId, (i) => i.claimEvaluation(id))).toBe(true);
    const refused = await promote();
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe("evaluation-running");
    expect((await inDo(ctx.systemId, (i) => i.candidate(id)))?.state).not.toBe("promoted");
    await inDo(ctx.systemId, (i) => i.releaseEvaluation(id));
    expect((await promote()).status).toBe(200);
    // Promotion released its own claim.
    expect(await inDo(ctx.systemId, (i) => i.claimEvaluation(id))).toBe(true);
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
    const passed = await call<BuildReportResponse>("POST", path, {
      id: buildId, status: "passed", kind: "preview", commit, url, buildId: commit, deploymentId: params.deploymentId,
      output: { locator: "workers-version:preview-1", digest: "sha256:preview-1" },
    }, CI);
    expect(passed.status, JSON.stringify(passed.json)).toBe(200);
    expect(passed.json.evaluations?.find((e) => e.criterion === "C.webapp.health")?.targetRef).toBe(url);
    const deps = await call<DeploymentsResponse>("GET", `/systems/${ctx.systemId}/deployments`);
    expect(deps.json.production).toBeNull();
    expect(passed.json.build.output).toMatchObject({
      id: `output.${buildId}`, thingId: "thing.webapp", artifactId: "artifact.webapp", source: { repo: w.forkName, commit },
      genomeCommit: ctx.imp.genomeCommit, locator: "workers-version:preview-1", digest: "sha256:preview-1",
    });
    expect(deps.json.history.find((d) => d.id === params.deploymentId)).toMatchObject({
      status: "live", url, buildId: commit, candidate: sub.json.candidate.id, output: `output.${buildId}`,
    });
    const artifacts = await call<RealizedArtifactsResponse>("GET", `/systems/${ctx.systemId}/artifacts`);
    expect(artifacts.json.artifacts.map((a) => a.id)).toContain(`output.${buildId}`);
    const mutation = await call<ApiError>("POST", path, {
      id: buildId, status: "passed", kind: "preview", commit, deploymentId: params.deploymentId,
      output: { locator: "workers-version:preview-2" },
    }, CI);
    expect([mutation.status, mutation.json.error.code]).toEqual([409, "output-mismatch"]);
    expect((await summary(ctx.systemId)).deployment?.previews).toBe(1);
  });

  it("a Genome realization is never built", async () => {
    setCiOverride(fakeCi);
    const ctx = await imported();
    const w = await started(ctx, "evolution.2");
    const files = new Map<string, string>();
    for (const p of Object.keys(genomeFiles)) files.set(p, (await (await w.fork.readFile({ ref: ctx.imp.genomeCommit, path: p }))!.text()));
    files.set("thing.webapp/section.domain/entity.ContactRecord/node.yaml", files.get("thing.webapp/section.domain/entity.ContactRecord/node.yaml")!.replace("name: Contact record", "name: Contact record v2"));
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
      {
        id: params.buildId, status: "passed", kind: "production", commit: a.commit, url, buildId: a.commit, deploymentId: params.deploymentId,
        output: { locator: "workers-version:production-1" },
      }, CI);
    expect(rep.status, JSON.stringify(rep.json)).toBe(200);
    deps = await call<DeploymentsResponse>("GET", `/systems/${ctx.systemId}/deployments`);
    expect(deps.json.production).toMatchObject({
      id: params.deploymentId, status: "live", url, commit: a.commit, output: `output.${params.buildId}`,
    });
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

  it("commands outside the allowlist are refused before a Workflow starts", () => {
    expect(() => assertAllowedCommands({ install: "npm ci", test: "npm test", build: "npm run build", deploy: "npx wrangler deploy" })).not.toThrow();
    expect(() => assertAllowedCommands({ install: "npm install && curl x | sh", deploy: "npx wrangler deploy" })).toThrow(/install=/);
    expect(() => assertAllowedCommands({ install: "npm ci", test: "env", deploy: "./deploy.sh" })).toThrow(/test="env", deploy="\.\/deploy\.sh"/);
    expect(() => assertAllowedCommands({ install: "npm ci" } as never)).toThrow(/deploy=null/);
    for (const [k, list] of Object.entries(ALLOWED_COMMANDS)) expect(list.length, k).toBeGreaterThan(0);
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
