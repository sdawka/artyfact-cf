/// <reference types="vite/client" />
/**
 * `POST …/realization-plans/draft` on Peopling: a proposal accepted through intents (fake System One and translator)
 * gives an accepted Genome Evolution; its draft persists nothing and its `request` posts unchanged to create (201).
 */
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGenome } from "@artyfact/model";
import { fakeSystemOne, fakeTranslator } from "@artyfact/ontology";
import { metaTemplates } from "@artyfact/templates";
import { routes, type ImportSystemResponse, type IntentAcceptResponse, type Proposal } from "../shared/api";
import { lifecyclePaths, type DraftRealizationPlanResponse, type ImplementationReview, type PlanPromoteResponse, type RealizationPlan, type TaskStartResponse, type TaskSubmitResponse } from "../shared/lifecycle";
import { walkTree } from "../worker/artifacts/genome-source";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { setEditorTransport } from "../worker/editor";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { setIntentProviders } from "../worker/intents";
import { systemStub } from "../worker/service";
import { fakePlanner, setPlannerOverride } from "../worker/tasks/planner-llm";
import { FakeArtifacts } from "./helpers/fake-artifacts";
import { fakeReceivePack } from "./helpers/fake-receive-pack";
import { ADMIN, passing } from "./helpers/flows";

const raw = (g: Record<string, string>, root: string) =>
  Object.fromEntries(Object.entries(g).map(([p, t]) => [p.slice(p.indexOf(root) + root.length), t] as const));
const genome = raw(import.meta.glob("../../../examples/peopling-system/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>, "peopling-system/");
const app = raw(import.meta.glob(["../../../examples/peopling-app/**/*", "!**/node_modules/**", "!**/.wrangler/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>, "peopling-app/");

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = ADMIN) {
  const res = await exports.default.fetch(new Request(`http://example.com${path}`, {
    method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }),
  }));
  return { status: res.status, json: (await res.json()) as T };
}

let n = 0;
/** The Artifacts namespace of the last `importSystem`. */
let lastNs: FakeArtifacts;
async function importSystem(edit: (files: Record<string, string>) => Record<string, string> = (f) => f) {
  const ns = new FakeArtifacts();
  const tag = `${++n}${Math.random().toString(36).slice(2, 6)}`;
  const systemId = `system.draft${tag}`;
  ns.create(`draft-genome-${tag}`).commit(edit(Object.fromEntries(Object.entries(genome).map(([p, t]) => [p, t.replaceAll("system.peopling", systemId)]))), "genome");
  ns.create(`draft-app-${tag}`).commit(app, "app");
  setArtifactsOverride(ns);
  setEditorTransport({ fetch: fakeReceivePack(ns).fetch });
  lastNs = ns;
  const imp = await call<ImportSystemResponse>("POST", "/api/systems/import", { systemId, genomeRepo: `draft-genome-${tag}`, appRepo: `draft-app-${tag}`, review: false });
  expect(imp.status, JSON.stringify(imp.json)).toBe(201);
  return systemId;
}

/** Accepts a fake-translated proposal: an accepted Genome Evolution touching the screen the message names. */
async function acceptChange(systemId: string, message: string) {
  const created = await call<Proposal>("POST", routes.intents(systemId), { message });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const p = created.json;
  const r = await call<IntentAcceptResponse>("POST", routes.intentAccept(systemId, p.id), { opIds: ["op.1"] });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.evolution;
}

const draft = (systemId: string, body: unknown, headers: Record<string, string> = ADMIN) => call<DraftRealizationPlanResponse & { code?: string }>("POST", lifecyclePaths.draft(systemId), body, headers);

beforeEach(() => {
  setHooks({ runner: () => ({ ...passing, async runGenome(ctx) { const out = await passing.runGenome(ctx); const exemplar = out.evaluations[0]!; return { ...out, evaluations: [...out.evaluations, ...(ctx.evolution?.acceptanceCriteria ?? []).filter((c) => !out.evaluations.some((e) => e.criterion === c)).map((c) => ({ ...exemplar, id: `${ctx.candidate.id}:${c}`, criterion: c, hook: `hook:${c}`, verdict: "pass" as const, execution: "completed" as const, targetRef: ctx.candidate.commit }))] }; } }) });
  setIntentProviders({ s1: fakeSystemOne(), translator: fakeTranslator() });
});
afterEach(() => { setArtifactsOverride(undefined); setEditorTransport(undefined); resetHooks(); setIntentProviders(undefined); setPlannerOverride(undefined); });

describe("POST /realization-plans/draft", () => {
  it("drafts an accepted Evolution, persists nothing, and the request posts unchanged to create", async () => {
    const systemId = await importSystem();
    const evolution = await acceptChange(systemId, "Change what the People screen says");
    expect(evolution).toMatchObject({ state: "promoted", kind: "genome-amendment" });
    expect((await draft(systemId, { evolutionIds: [evolution.id] }, {})).status).toBe(401);

    const d = await draft(systemId, { evolutionIds: [evolution.id] });
    expect(d.status, JSON.stringify(d.json)).toBe(200);
    const state = await systemStub(env, systemId).state();
    expect(d.json.request.genomeCommit).toBe(state!.genomeCommit);
    expect(d.json.request.tasks.length).toBeGreaterThan(0);
    expect(d.json.request.tasks.flatMap((t) => t.writeNodes)).toEqual(evolution.affectedNodes);
    expect(d.json.request.tasks.every((t) => t.artifactId === "artifact.webapp" && t.steps.length > 0)).toBe(true);
    expect(d.json.analysis.waves.flat().sort()).toEqual(d.json.request.tasks.map((t) => t.id).sort());
    expect(d.json.provenance).toMatchObject({ planner: { provider: "fallback" }, fallback: true, evolutionIds: [evolution.id], genomeCommit: state!.genomeCommit });
    expect(d.json.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(await systemStub(env, systemId).realizationPlans()).toEqual([]);

    const created = await call<RealizationPlan>("POST", lifecyclePaths.plans(systemId), d.json.request);
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    expect(created.json.tasks.map((t) => t.id)).toEqual(d.json.request.tasks.map((t) => t.id));
    expect(created.json.analysis).toEqual(d.json.analysis);
    expect(created.json.tasks.map((t) => t.footprint)).toEqual(created.json.tasks.map((t) => expect.objectContaining({ artifactId: "artifact.webapp", repo: state!.manifest!.artifacts["artifact.webapp"].repo })));

    // The open plan holds the Evolution's nodes from the default draft; naming the Evolution drafts them again.
    const again = await draft(systemId, {});
    expect(again.json.request.tasks).toEqual([]);
    expect(again.json.problems).toContainEqual({ severity: "warning", message: expect.stringContaining(`in open plan ${created.json.id}; skipped (name ${evolution.id}`) });
    const named = await draft(systemId, { evolutionIds: [evolution.id] });
    expect(named.json.request.tasks).toEqual(d.json.request.tasks);
    // Create applies the CLI's task-id rule to an edited draft.
    const bad = { ...d.json.request, tasks: d.json.request.tasks.map((t, k) => (k ? t : { ...t, id: "--platform=https://x" })) };
    const refused = await call("POST", lifecyclePaths.plans(systemId), bad);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.json)).toContain("task ids use letters");
  });

  it("drafts with the fake planner from explicit nodes, and the split draft posts to create", async () => {
    const systemId = await importSystem();
    setPlannerOverride(fakePlanner());
    const d = await draft(systemId, { nodes: ["screen.goal", "screen.today", "operation.goal.save"], hint: "#plan:split", title: "Goals" });
    expect(d.status, JSON.stringify(d.json)).toBe(200);
    expect(d.json.request.title).toBe("Goals");
    expect(d.json.request.tasks.map((t) => t.writeNodes)).toEqual([["screen.goal"], ["screen.today"], ["operation.goal.save"]]);
    expect(d.json.provenance).toMatchObject({ planner: { provider: "fake", model: "fake" }, fake: true, fallback: false, evolutionIds: [] });
    const created = await call<RealizationPlan>("POST", lifecyclePaths.plans(systemId), d.json.request);
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    expect(created.json.analysis).toEqual(d.json.analysis);
  });

  it("reports unknown and unaccepted scope as problems; a malformed body is 400", async () => {
    const systemId = await importSystem();
    const d = await draft(systemId, { evolutionIds: ["evolution.1", "evolution.99"], nodes: ["no.such"] });
    expect(d.status, JSON.stringify(d.json)).toBe(200);
    expect(d.json.request.tasks).toEqual([]);
    expect(d.json.problems).toEqual(expect.arrayContaining([
      { severity: "error", message: expect.stringContaining("evolution.1 is a") },
      { severity: "error", message: "unknown Evolution evolution.99; skipped" },
      { severity: "error", message: "unknown node no.such; dropped" },
      { severity: "missing", message: expect.stringContaining("nothing to implement") },
    ]));
    expect((await draft(systemId, { evolutionIds: "evolution.1" })).status).toBe(400);
    expect((await draft(systemId, { tasks: [] })).status).toBe(400);
    expect((await draft("system.nope", {})).status).toBe(404);
  });

  it("an accepted Evolution seeded from the Genome at import counts as realized by the imported app", async () => {
    // evolution.5 ships accepted, and names a node the Genome no longer has (removed before import).
    const systemId = await importSystem((f) => ({ ...f, "evolutions/evolution.5.yaml": f["evolutions/evolution.5.yaml"].replace("state: proposed", "state: promoted").replace("- section.domain", "- section.domain\n- screen.gone") }));
    const seeded = (await systemStub(env, systemId).evolution("evolution.5"))!;
    expect(seeded).toMatchObject({ state: "promoted", kind: "genome-amendment" });
    const none = await draft(systemId, {});
    expect(none.status, JSON.stringify(none.json)).toBe(200);
    expect(none.json.provenance.evolutionIds).toEqual([]);
    expect(none.json.problems.filter((p) => p.message.includes("evolution.5"))).toEqual([]);
    const evolution = await acceptChange(systemId, "Change what the Today screen says");
    expect((await draft(systemId, {})).json.provenance.evolutionIds).toEqual([evolution.id]);
    // Named, it is reported as realized rather than planned.
    const named = await draft(systemId, { evolutionIds: ["evolution.5"] });
    expect(named.json.request.tasks).toEqual([]);
    expect(named.json.problems).toContainEqual({ severity: "warning", message: "evolution.5 is already realized; skipped" });
  });

  it("after its plan is promoted, an empty-body draft has no tasks for the Evolution", async () => {
    const systemId = await importSystem();
    const ns = lastNs;
    const evolution = await acceptChange(systemId, "Change what the People screen says");
    // Task candidates pass every criterion of the Genome, so the plan promotes.
    const ids = loadGenome(genome, { templates: metaTemplates }).criteria.map((c) => c.id);
    setHooks({ runner: () => ({ ...passing, async runSubmission(ctx) {
      const at = new Date().toISOString();
      return ids.map((criterion) => ({
        id: `${ctx.candidate.id}:${criterion}`, candidate: ctx.candidate.id, hook: `hook:${criterion}`, criterion, ownerId: "o", subjectId: "s",
        targetRef: ctx.candidate.commit, execution: "completed" as const, verdict: "pass" as const, verifier: "artyfact-platform", startedAt: at, finishedAt: at,
        observations: [], limitations: [], provenance: {},
      }));
    } }) });
    const d = await draft(systemId, {});
    expect(d.json.provenance.evolutionIds).toEqual([evolution.id]);
    const created = await call<RealizationPlan>("POST", lifecyclePaths.plans(systemId), d.json.request);
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const plan = created.json;
    // Every task, wave by wave: claim, commit a file in its footprint, submit, select.
    for (const id of plan.analysis.waves.flat()) {
      const start = await call<TaskStartResponse>("POST", lifecyclePaths.action(systemId, plan.id, id, "claim"), {});
      expect(start.status, JSON.stringify(start.json)).toBe(201);
      const { task, attempt, secret } = start.json;
      const repo = ns.repo(task.forkRepo);
      const files = await walkTree(repo, task.base.commit);
      const path = task.footprint.paths[0] ?? `${task.footprint.globs[0]!.replace(/\*\*.*$/, "").replace(/\/?$/, "/")}draft.txt`;
      files.set(path, `${files.get(path) ?? ""}\n// ${id}`);
      const sub = await call<TaskSubmitResponse>("POST", lifecyclePaths.action(systemId, plan.id, id, "submit"), { attemptId: attempt.id, generation: attempt.generation, commit: repo.commit(files, id) }, { authorization: `Bearer ${secret}` });
      expect(sub.status, JSON.stringify(sub.json)).toBe(201);
      const sel = await call<RealizationPlan>("POST", lifecyclePaths.action(systemId, plan.id, id, "select"), { candidateId: sub.json.candidate.id });
      expect(sel.status, JSON.stringify(sel.json)).toBe(200);
    }
    const review = await call<ImplementationReview>("POST", lifecyclePaths.integrate(systemId, plan.id), {});
    expect(review.status, JSON.stringify(review.json)).toBe(200);
    const promoted = await call<PlanPromoteResponse>("POST", lifecyclePaths.promote(systemId, plan.id), { expectedHead: review.json.expectedHead, rationale: "Reviewed", candidateIds: review.json.bindings.map((b) => b.candidateId) });
    expect(promoted.status, JSON.stringify(promoted.json)).toBe(200);

    const after = await draft(systemId, {});
    expect(after.status, JSON.stringify(after.json)).toBe(200);
    expect(after.json.provenance.evolutionIds).not.toContain(evolution.id);
    expect(after.json.request.tasks).toEqual([]);
    // Not merely held by an open plan (naming it would draft it again): realized.
    const named = await draft(systemId, { evolutionIds: [evolution.id] });
    expect(named.json.request.tasks).toEqual([]);
    expect(named.json.problems).toContainEqual({ severity: "warning", message: `${evolution.id} is already realized; skipped` });
  });

  it("with an empty body drafts every accepted, unrealized Evolution", async () => {
    const systemId = await importSystem();
    const evolution = await acceptChange(systemId, "Change what the Today screen says");
    const d = await draft(systemId, {});
    expect(d.status, JSON.stringify(d.json)).toBe(200);
    expect(d.json.provenance.evolutionIds).toEqual([evolution.id]);
    expect((await call("POST", lifecyclePaths.plans(systemId), d.json.request)).status).toBe(201);
  });
});
