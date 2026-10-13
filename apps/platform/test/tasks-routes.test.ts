/// <reference types="vite/client" />
/**
 * Task routes on Peopling (FakeArtifacts, the example's v2 Genome and app). Plan section: POST/GET/PUT
 * `/evolutions/:eid/plan`. W5 appends the task and wave routes below.
 */
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routes, type ApiError, type ImportSystemResponse, type TaskPlan } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { systemStub } from "../worker/service";
import { fakePlanner, setPlannerOverride } from "../worker/tasks/planner-llm";
import { FakeArtifacts } from "./helpers/fake-artifacts";
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

interface Sys { ns: FakeArtifacts; systemId: string }

let n = 0;
async function importSystem(): Promise<Sys> {
  const ns = new FakeArtifacts();
  const tag = `${++n}${Math.random().toString(36).slice(2, 6)}`;
  const systemId = `system.tasks${tag}`;
  const files = Object.fromEntries(Object.entries(genome).map(([p, t]) => [p, t.replaceAll("system.peopling", systemId)]));
  ns.create(`tasks-genome-${tag}`).commit(files, "genome");
  ns.create(`tasks-app-${tag}`).commit(app, "app");
  setArtifactsOverride(ns);
  const imp = await call<ImportSystemResponse>("POST", "/api/systems/import", { systemId, genomeRepo: `tasks-genome-${tag}`, appRepo: `tasks-app-${tag}` });
  expect(imp.status, JSON.stringify(imp.json)).toBe(201);
  return { ns, systemId };
}

const api = (p: string) => `/api${p.replace(/^\/api/, "")}`;
const plan = (s: Sys, e = "evolution.1") => api(routes.plan(s.systemId, e));

beforeEach(() => { setHooks({ runner: () => passing }); });
afterEach(() => { setArtifactsOverride(undefined); resetHooks(); setPlannerOverride(undefined); });

// ------------------------------------------------------------------ plan
describe("plan routes", () => {
  it("POST plans an actionable Evolution into tasks and waves; GET returns it", async () => {
    const s = await importSystem();
    expect((await call<ApiError>("GET", plan(s))).json.error.code).toBe("no-plan");
    const r = await call<TaskPlan>("POST", plan(s), {});
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const p = r.json;
    expect(p.tasks.length).toBeGreaterThanOrEqual(2);
    expect(p.waves.flat().sort()).toEqual(p.tasks.map((t) => t.id).sort());
    expect(p.tasks.map((t) => t.id)).toEqual(p.tasks.map((_, i) => `task.1.t${i + 1}`));
    expect(p.tasks.every((t) => t.status === "planned" && t.evolutionId === "evolution.1")).toBe(true);
    expect(p.tasks.some((t) => t.footprint.paths.length > 0)).toBe(true);
    expect(p.provenance.planner.provider).toBe("fallback");
    expect(p.appCommit).toMatch(/^[0-9a-f]{40}$/);
    const g = await call<TaskPlan>("GET", plan(s), undefined, {});
    expect(g.status).toBe(200);
    expect(g.json.tasks.map((t) => t.id)).toEqual(p.tasks.map((t) => t.id));
    expect(g.json.waves).toEqual(p.waves);
    const evo = await call<{ plan?: { tasks: number } }>("GET", `/api/systems/${s.systemId}/evolutions/evolution.1`, undefined, {});
    expect(evo.json.plan?.tasks).toBe(p.tasks.length);
  });

  it("plans with the configured planner and its hint (fake #plan:dep)", async () => {
    setPlannerOverride(fakePlanner());
    const s = await importSystem();
    const r = await call<TaskPlan>("POST", plan(s), { hint: "#plan:dep" });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.provenance).toEqual({ planner: { provider: "fake", model: "fake" }, fake: true, hint: "#plan:dep" });
    expect(r.json.tasks.every((t) => t.origin === "llm")).toBe(true);
    expect(r.json.tasks[1].dependsOn).toContain(r.json.tasks[0].id);
    expect(r.json.waves.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses non-admins, Evolutions not ready to plan, and replans only with force", async () => {
    const s = await importSystem();
    expect((await call<ApiError>("POST", plan(s), {}, {})).status).toBe(401);
    const proposed = await call<ApiError>("POST", plan(s, "evolution.2"), {});
    expect(proposed.status).toBe(409);
    expect(proposed.json.error.code).toBe("invalid-state");
    expect((await call<ApiError>("POST", plan(s, "evolution.99"), {})).status).toBe(404);
    expect((await call<TaskPlan>("POST", plan(s), {})).status).toBe(201);
    const again = await call<ApiError>("POST", plan(s), {});
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("plan-in-progress");
    expect((await call<TaskPlan>("POST", plan(s), { force: true })).status).toBe(201);
    expect((await call<ApiError>("POST", plan(s), { force: "yes" })).status).toBe(400);
  });

  it("PUT recomputes footprints, conflicts and waves for a merged task list", async () => {
    const s = await importSystem();
    const p = (await call<TaskPlan>("POST", plan(s), {})).json;
    const [a, b, ...rest] = p.tasks;
    const merged = { ...a, nodes: [...a.nodes, ...b.nodes], acceptanceCriteria: [...a.acceptanceCriteria, ...b.acceptanceCriteria], title: "Merged" };
    delete (merged as { footprint?: unknown }).footprint;
    const r = await call<TaskPlan>("PUT", plan(s), { tasks: [merged, ...rest] });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.tasks).toHaveLength(p.tasks.length - 1);
    expect(r.json.tasks[0]).toMatchObject({ id: a.id, title: "Merged", origin: "user" });
    expect(r.json.tasks[0].footprint.globs).toEqual(expect.arrayContaining([...a.footprint.globs, ...b.footprint.globs]));
    expect(r.json.waves.flat().sort()).toEqual(r.json.tasks.map((t) => t.id).sort());
    expect((await call<TaskPlan>("GET", plan(s))).json.tasks[0].title).toBe("Merged");

    const cyc = await call<ApiError>("PUT", plan(s), { tasks: [{ ...r.json.tasks[0], dependsOn: [rest[0].id] }, { ...rest[0], dependsOn: [a.id] }, ...rest.slice(1)] });
    expect(cyc.status).toBe(422);
    expect(cyc.json.error.code).toBe("plan-cycle");
    const bad = await call<ApiError>("PUT", plan(s), { tasks: [{ ...r.json.tasks[0], nodes: ["no.such.node"] }] });
    expect(bad.status).toBe(422);
    expect((await call<ApiError>("PUT", plan(s, "evolution.2"), { tasks: [] })).json.error.code).toBe("no-plan");
  });

  it("emits plan.updated on the System's SSE stream", async () => {
    const s = await importSystem();
    const res = await exports.default.fetch(new Request(`http://example.com/api/systems/${s.systemId}/events`));
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    await reader.read();
    expect((await call<TaskPlan>("POST", plan(s), {})).status).toBe(201);
    let text = "";
    while (!text.includes("plan.updated")) text += dec.decode((await reader.read()).value);
    expect(text).toMatch(/"type":"plan.updated","evolution":"evolution.1","plan":\{"tasks":\d+/);
    await reader.cancel();
  });

  it("409 plan-in-progress once a task is claimed, for POST (even with force) and PUT", async () => {
    const s = await importSystem();
    const p = (await call<TaskPlan>("POST", plan(s), {})).json;
    const first = p.waves[0][0];
    const claim = await systemStub(env, s.systemId).claimTask(first, "agent-1");
    expect(claim).toHaveProperty("claimed");
    const post = await call<ApiError>("POST", plan(s), { force: true });
    expect(post.status).toBe(409);
    expect(post.json.error.code).toBe("plan-in-progress");
    expect(post.json.error.details).toEqual({ tasks: [first] });
    const put = await call<ApiError>("PUT", plan(s), { tasks: p.tasks });
    expect(put.status).toBe(409);
    expect(put.json.error.code).toBe("plan-in-progress");
  });
});
