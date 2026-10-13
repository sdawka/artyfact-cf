import { env, exports } from "cloudflare:workers";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ApiError, BuildReportResponse, ChangelogResponse, CheckpointResponse, CreateEvolutionResponse, DeploymentsResponse, EditorCommitResponse, Evolution, PhenomeIngestResponse,
  PromoteResponse, SseEnvelope, StartWorkResponse, SystemSummary, SystemsResponse, TemplateUpgradeNoScaffold, TemplateUpgradePlan,
} from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { walkTree } from "../worker/artifacts/genome-source";
import { artyfactSystemId } from "../worker/artifacts/fake-seed-artyfact";
import { ensureFakePlatform, exampleSystemId, fakeSeed, resetFakePlatform } from "../worker/artifacts/fake-platform";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { resetPhenomeThrottle } from "../worker/phenome";
import { ADMIN, call, genomeAmendment, importFresh, passing, renameContact, type Flow } from "./helpers/flows";

const CI = { authorization: "Bearer test-ci-token" };

/** Collects a System's SSE envelopes in the background. */
async function listen(systemId: string) {
  const res = await exports.default.fetch(new Request(`http://example.com/api/systems/${systemId}/events`));
  const reader = res.body!.getReader();
  const seen: SseEnvelope[] = [];
  let buf = "";
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      buf += new TextDecoder().decode(value);
      const parts = buf.split("\n\n");
      buf = parts.pop()!;
      for (const p of parts) {
        const line = p.split("\n").find((l) => l.startsWith("data: "));
        if (line) seen.push(JSON.parse(line.slice(6)) as SseEnvelope);
      }
    }
  })();
  return {
    seen,
    /** The next event of `type` after the current mark (waits briefly for the stream). */
    async next<T extends SseEnvelope["type"]>(type: T, from: number): Promise<Extract<SseEnvelope, { type: T }>> {
      for (let i = 0; i < 100; i++) {
        const hit = seen.slice(from).find((e) => e.type === type);
        if (hit) return hit as Extract<SseEnvelope, { type: T }>;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`no ${type} after #${from}; saw ${seen.slice(from).map((e) => e.type).join(", ")}`);
    },
    close: () => reader.cancel().catch(() => {}),
  };
}

const listed = async (systemId: string) => (await call<SystemsResponse>("GET", "/systems")).json.systems.find((s) => s.systemId === systemId)!;

beforeEach(() => {
  setHooks({ runner: () => passing });
  resetPhenomeThrottle();
});
afterEach(() => {
  resetHooks();
  setArtifactsOverride(undefined);
});

describe("System summary across the lifecycle", () => {
  it("GET /api/systems tracks every step and each step publishes system.updated", async () => {
    const f: Flow = await importFresh();
    const id = f.systemId;
    let s = await listed(id);
    expect(s).toMatchObject({ built: false, openCandidates: 0, realizationCounts: { evolving: 0, pending: 0, awaitingAdmin: 0, awaitingReview: 0 }, deployState: "none", phenome: { events: 0 } });
    expect(s.appCommit).toBe(f.imp.appCommit);
    expect(s.readiness).toEqual({ errors: expect.any(Number), missing: expect.any(Number) });
    expect(s.signifiers).toContain("not-fully-built");
    expect(s.signifiers).toContain("unrealized");

    const sse = await listen(id);
    const step = async <T>(fn: () => Promise<T>): Promise<{ out: T; system: SystemSummary }> => {
      const mark = sse.seen.length;
      const out = await fn();
      await sse.next("system.updated", mark);
      await new Promise((r) => setTimeout(r, 30)); // a step may refresh more than once; the last one is current
      const ups = sse.seen.slice(mark).filter((e): e is Extract<SseEnvelope, { type: "system.updated" }> => e.type === "system.updated");
      return { out, system: ups[ups.length - 1]?.system as SystemSummary };
    };

    // start + checkpoint
    const start = await step(() => call<StartWorkResponse>("POST", `/systems/${id}/evolutions/evolution.1/realizations`, { agentLabel: "claude" }));
    expect(start.out.status, JSON.stringify(start.out.json)).toBe(201);
    expect(start.system.realizationCounts?.evolving).toBe(1);
    expect(start.system.signifiers).toContain("evolving");
    const rid = start.out.json.realization.id;
    expect(start.out.json.realization.origin).toBe("cli");
    const cp = await step(() => call<CheckpointResponse>("POST", `/systems/${id}/realizations/${rid}/checkpoints`, { summary: "wip" }));
    expect(cp.out.status).toBe(201);
    expect((await listed(id)).realizationCounts?.evolving).toBe(1);

    // submit
    const fork = f.ns.repo(start.out.json.realization.workspace.fork);
    const base = await walkTree(fork, start.out.json.realization.workspace.baseCommit);
    const commit1 = fork.commit({ ...Object.fromEntries(base), "src/ui/people/list.ts": "export const list = [1]" }, "people");
    const sub = await step(() => call<{ candidate: { id: string } }>("POST", `/systems/${id}/realizations/${rid}/submit`, { commit: commit1 }));
    expect(sub.out.status, JSON.stringify(sub.out.json)).toBe(201);
    s = await listed(id);
    expect(s.openCandidates).toBe(1);
    // An app candidate waits for review like an amendment does (the rail's count).
    expect(s.realizationCounts?.awaitingReview).toBe(1);
    expect(s.signifiers).toContain("pending-realization");
    expect(s.signifiers).not.toContain("unrealized");

    // genome submit (not accepted)
    const g = await step(() => genomeAmendment(f, renameContact("Contact card"), { accept: false }));
    expect(g.system.realizationCounts?.awaitingAdmin).toBe(1);
    expect(g.system.realizationCounts?.awaitingReview).toBe(2);
    expect(g.system.signifiers).toContain("awaiting-admin");

    // promote
    const head1 = (await call<SystemSummary>("GET", `/systems/${id}`)).json.head;
    const p1 = await step(() => call<PromoteResponse>("POST", `/systems/${id}/promote`, { candidates: [sub.out.json.candidate.id], expectedHead: head1, rationale: "ship" }, ADMIN));
    expect(p1.out.status, JSON.stringify(p1.out.json)).toBe(200);
    expect(p1.system).toMatchObject({ built: true, appCommit: commit1, deployState: "pending" });
    expect(p1.system.signifiers).toContain("built");

    // production report → live
    const pending = (await call<DeploymentsResponse>("GET", `/systems/${id}/deployments`)).json.history[0];
    const rep1 = await step(() => call<BuildReportResponse>("POST", `/systems/${id}/builds`,
      { status: "passed", kind: "production", commit: commit1, url: "https://peopling-app.dawka.workers.dev", buildId: commit1, deploymentId: pending.id }, CI));
    expect(rep1.out.status, JSON.stringify(rep1.out.json)).toBe(200);
    expect(rep1.system.deployState).toBe("live");
    expect(rep1.system.signifiers).toContain("deployed");
    expect((await listed(id)).latestBuild?.commit).toBe(commit1);
    // The changelog row of that System commit carries B3's build and deployment.
    const rows = (await call<ChangelogResponse>("GET", `/systems/${id}/changelog`)).json.rows;
    const row = rows.find((r) => r.id === p1.out.json.commit.id)!;
    expect(row.builds.map((b) => b.commit)).toContain(commit1);
    expect(row.deployment).toMatchObject({ id: pending.id, status: "live", systemCommit: p1.out.json.commit.id });

    // second promote → live production is behind
    const start2 = await call<StartWorkResponse>("POST", `/systems/${id}/evolutions/evolution.3/realizations`, { agentLabel: "claude" });
    const fork2 = f.ns.repo(start2.json.realization.workspace.fork);
    const base2 = await walkTree(fork2, start2.json.realization.workspace.baseCommit);
    const commit2 = fork2.commit({ ...Object.fromEntries(base2), "src/ui/people/list.ts": "export const list = [2]" }, "people 2");
    const sub2 = await call<{ candidate: { id: string } }>("POST", `/systems/${id}/realizations/${start2.json.realization.id}/submit`, { commit: commit2 });
    expect(sub2.status, JSON.stringify(sub2.json)).toBe(201);
    const head2 = (await call<SystemSummary>("GET", `/systems/${id}`)).json.head;
    const p2 = await step(() => call<PromoteResponse>("POST", `/systems/${id}/promote`, { candidates: [sub2.json.candidate.id], expectedHead: head2, rationale: "again" }, ADMIN));
    expect(p2.out.status, JSON.stringify(p2.out.json)).toBe(200);
    expect(p2.system.appCommit).toBe(commit2);
    expect(["behind", "pending"]).toContain(p2.system.deployState);

    // build report for the second commit → live again
    const pending2 = (await call<DeploymentsResponse>("GET", `/systems/${id}/deployments`)).json.history.find((d) => d.commit === commit2 && d.status === "pending");
    const rep2 = await step(() => call<BuildReportResponse>("POST", `/systems/${id}/builds`,
      { status: "passed", kind: "production", commit: commit2, url: "https://peopling-app.dawka.workers.dev", buildId: commit2, ...(pending2 && { deploymentId: pending2.id }) }, CI));
    expect(rep2.out.status, JSON.stringify(rep2.out.json)).toBe(200);
    expect(rep2.system.deployState).toBe("live");
    expect(rep2.system.signifiers).toContain("deployed");
    expect(rep2.system.signifiers).not.toContain("behind");

    // ingest
    const ev = { systemId: id, thingId: "thing.webapp", artifactId: "artifact.webapp", buildId: commit2, commit: commit2, emittedAt: new Date().toISOString(), kind: "journey.step", payload: {} };
    const ing = await step(() => call<PhenomeIngestResponse>("POST", `/systems/${id}/phenome/events`, { events: [ev] }, ADMIN));
    expect(ing.out.json.accepted, JSON.stringify(ing.out.json)).toBe(1);
    expect(ing.system.phenome?.events).toBe(1);
    expect(ing.system.signifiers).toContain("observed");
    expect((await listed(id)).phenome).toMatchObject({ events: 1, lastEmittedAt: ev.emittedAt });
    await sse.close();
  });
});

describe("POST /api/systems/:id/evolutions", () => {
  it("creates an actionable Evolution (admin, 201) and announces it", async () => {
    const f = await importFresh();
    const sse = await listen(f.systemId);
    const mark = sse.seen.length;
    const res = await call<CreateEvolutionResponse>("POST", `/systems/${f.systemId}/evolutions`,
      { title: "Birthday reminders", intent: "Remind owners of birthdays", affectedNodes: ["screen.people"], risk: "low" }, ADMIN);
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json.evolution).toMatchObject({ title: "Birthday reminders", state: "actionable", kind: "implementation", risk: "low", affectedNodes: ["screen.people"] });
    expect(res.json.evolution.id).toMatch(/^evolution\.\d+$/);
    expect((await sse.next("evolution.created", mark)).evolution.id).toBe(res.json.evolution.id);
    const work = await call<{ evolutions: Evolution[] }>("GET", `/systems/${f.systemId}/work`);
    expect(work.json.evolutions.map((e) => e.id)).toContain(res.json.evolution.id);
    // Work can start on it.
    const start = await call<StartWorkResponse>("POST", `/systems/${f.systemId}/evolutions/${res.json.evolution.id}/realizations`, {});
    expect(start.status, JSON.stringify(start.json)).toBe(201);
    await sse.close();
  });

  it("defaults absent acceptance criteria to the System's criteria matching the Evolution's target", async () => {
    const f = await importFresh();
    const create = async (kind: string) => (await call<CreateEvolutionResponse>("POST", `/systems/${f.systemId}/evolutions`, { title: "t", intent: "i", kind }, ADMIN)).json.evolution;
    const app = await create("implementation");
    expect(app.acceptanceCriteria).toContain("C.people.list");
    expect(app.acceptanceCriteria).not.toContain("C.system.promotion");
    // C.thing.webapp.checks is the webapp template's model criterion (checks@1 on changed nodes).
    expect((await create("genome-amendment")).acceptanceCriteria).toEqual(["C.system.promotion", "C.thing.webapp.checks"]);
    // An unknown target (no kind, or mixed) keeps only model criteria: app ones could never pass on a Genome candidate.
    expect((await create("mixed")).acceptanceCriteria).toEqual(["C.system.promotion", "C.thing.webapp.checks"]);
    const unknown = await call<CreateEvolutionResponse>("POST", `/systems/${f.systemId}/evolutions`, { title: "t", intent: "i" }, ADMIN);
    expect(unknown.json.evolution).toMatchObject({ kind: "implementation", acceptanceCriteria: ["C.system.promotion", "C.thing.webapp.checks"] });
    const explicit = await call<CreateEvolutionResponse>("POST", `/systems/${f.systemId}/evolutions`, { title: "t", intent: "i", acceptanceCriteria: [] }, ADMIN);
    expect(explicit.json.evolution.acceptanceCriteria).toEqual([]);
  });

  it("is 401 without and 403 with a wrong admin bearer", async () => {
    const f = await importFresh();
    const body = { title: "t", intent: "i" };
    expect((await call<ApiError>("POST", `/systems/${f.systemId}/evolutions`, body, {})).status).toBe(401);
    expect((await call<ApiError>("POST", `/systems/${f.systemId}/evolutions`, body, { authorization: "Bearer nope" })).status).toBe(403);
  });

  it.each([
    ["missing title", { intent: "i" }],
    ["missing intent", { title: "t" }],
    ["bad kind", { title: "t", intent: "i", kind: "rewrite" }],
    ["bad risk", { title: "t", intent: "i", risk: "extreme" }],
    ["unknown node", { title: "t", intent: "i", affectedNodes: ["screen.nope"] }],
    ["unknown criterion", { title: "t", intent: "i", acceptanceCriteria: ["C.nope"] }],
    ["non-array nodes", { title: "t", intent: "i", affectedNodes: "screen.people" }],
  ])("is 400 for %s", async (_name, body) => {
    const f = await importFresh();
    expect((await call<ApiError>("POST", `/systems/${f.systemId}/evolutions`, body, ADMIN)).status).toBe(400);
  });
});

describe("FAKE_ARTIFACTS=1 boot", () => {
  afterAll(() => resetFakePlatform());

  it("serves Peopling from examples/ and takes an editor commit through the fake receive-pack", async () => {
    await ensureFakePlatform(env);
    await ensureFakePlatform(env); // idempotent
    const s = await listed(exampleSystemId);
    expect(s).toMatchObject({ title: "Peopling", genomeRepo: "peopling.genome", appRepo: "peopling.app" });
    expect(s.signifiers).toContain("unrealized");

    const work = await call<{ evolutions: Evolution[] }>("GET", `/systems/${exampleSystemId}/work`);
    const evo = work.json.evolutions.find((e) => e.state === "actionable")!;
    const start = await call<StartWorkResponse>("POST", `/systems/${exampleSystemId}/evolutions/${evo.id}/realizations`,
      { agentLabel: "human:sam", role: "author", origin: "editor" }, ADMIN);
    expect(start.status, JSON.stringify(start.json)).toBe(201);
    expect(start.json.realization).toMatchObject({ origin: "editor", agent: { role: "author" } });
    const rid = start.json.realization.id;
    const res = await call<EditorCommitResponse>("POST", `/systems/${exampleSystemId}/realizations/${rid}/commit`,
      { message: "Edit README", why: "demo", changes: [{ path: "README.md", content: "# Peopling\nedited\n" }] }, ADMIN);
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(res.json.submitted.candidate.commit).toBe(res.json.commit);
    expect((await listed(exampleSystemId)).openCandidates).toBe(1);
  });

  it("seeds the platform repo, so the example app gets a template upgrade plan (no lock yet, nothing behind)", async () => {
    resetFakePlatform(); // the suite's afterEach uninstalled the namespace; boot again (same deterministic repos)
    await ensureFakePlatform(env);
    const p = await call<TemplateUpgradePlan>("GET", `/systems/${exampleSystemId}/template-upgrade`);
    expect(p.status, JSON.stringify(p.json)).toBe(200);
    expect(p.json).toMatchObject({ template: "thing/cloudflare-worker-webapp@1", from: null, locked: false, upToDate: false, files: [] });
  });

  it("answers 200 no-scaffold for a Thing template without a scaffold (the self-Genome)", async () => {
    const e = env as { FAKE_SEED?: string };
    resetFakePlatform();
    e.FAKE_SEED = "artyfact";
    try {
      await ensureFakePlatform(env);
      const p = await call<TemplateUpgradeNoScaffold>("GET", `/systems/${artyfactSystemId}/template-upgrade`);
      expect(p.status, JSON.stringify(p.json)).toBe(200);
      expect(p.json).toEqual({ status: "no-scaffold", template: "thing/cloudflare-worker-service@1" });
      expect((await call<ApiError>("POST", `/systems/${artyfactSystemId}/template-upgrade`, {}, ADMIN)).status).toBe(422);
    } finally {
      delete e.FAKE_SEED;
      resetFakePlatform();
    }
  });

  it("reads FAKE_SEED, defaulting to Peopling", () => {
    expect([undefined, "", "peopling", "nope"].map(fakeSeed)).toEqual(Array(4).fill("peopling"));
    expect([fakeSeed("artyfact"), fakeSeed("both")]).toEqual(["artyfact", "both"]);
  });

  it("rejects an unknown origin on start work", async () => {
    await ensureFakePlatform(env);
    const work = await call<{ evolutions: Evolution[] }>("GET", `/systems/${exampleSystemId}/work`);
    const evo = work.json.evolutions[0];
    const res = await call<ApiError>("POST", `/systems/${exampleSystemId}/evolutions/${evo.id}/realizations`, { origin: "robot" }, ADMIN);
    expect(res.status).toBe(400);
  });
});
