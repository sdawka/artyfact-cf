/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import type { SystemModel } from "@artyfact/model";
import { loadGenome } from "../../worker/hooks/model-rules";
import { PlanError } from "../../worker/tasks/independence";
import {
  assemblePlan, buildPlan, fallbackGroups, fallbackPlan, nodeThing, planContext, revisePlan, taskId, validateReply, type PlanEvolution, type PlanInput,
} from "../../worker/tasks/planner";
import {
  fakePlanner, offPlanner, openRouterPlanner, parsePlanReply, plannerFromEnv, setPlannerOverride, type Planner, type PlanReplyTask,
} from "../../worker/tasks/planner-llm";

const raw = (g: Record<string, string>, root: string) =>
  Object.fromEntries(Object.entries(g).map(([p, t]) => [p.slice(p.indexOf(root) + root.length), t] as const));
const genome = raw(import.meta.glob("../../../../examples/peopling-system/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>, "peopling-system/");
const app = raw(import.meta.glob(["../../../../examples/peopling-app/**/*", "!**/node_modules/**", "!**/.wrangler/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>, "peopling-app/");

const m: SystemModel = loadGenome(genome, "r1");
const tree = Object.keys(app);
const evo = (id: string): PlanEvolution => {
  const e = m.evolutions.find((x) => x.id === id)!;
  return { id: e.id, title: e.title, intent: e.intent, kind: e.kind, affectedNodes: e.affectedNodes, acceptanceCriteria: e.acceptanceCriteria };
};
/** Evolution 2 as these tests use it: one domain section (goal) and one UI section. The real evolution.2 spans three sections (below). */
const evo2: PlanEvolution = { ...evo("evolution.2"), affectedNodes: ["entity.RelationshipGoal", "operation.goal.save", "screen.goal", "screen.logContact", "screen.today"] };
const input = (e: PlanEvolution, hint?: string): PlanInput => ({ model: m, evolution: e, tree, appCommit: "app1", genomeCommit: "g1", ...(hint && { hint }) });
const custom = (affectedNodes: string[], acceptanceCriteria: string[] = []): PlanEvolution =>
  ({ id: "evolution.9", title: "Custom", intent: "Do it", affectedNodes, acceptanceCriteria });

describe("fallbackPlan", () => {
  it("groups by Thing, then nearest section", () => {
    const groups = fallbackGroups(m, evo2.affectedNodes, tree);
    expect(groups).toEqual([
      ["entity.RelationshipGoal", "operation.goal.save"],
      ["screen.goal", "screen.logContact", "screen.today"],
    ]);
    // A System-level node never shares a group with a Thing's nodes.
    const five = fallbackGroups(m, evo("evolution.5").affectedNodes, tree);
    expect(five).toContainEqual(["commitment.no-engagement-mechanics"]);
    expect(nodeThing(m, "commitment.no-engagement-mechanics")).toBeNull();
  });

  it("merges groups of one Thing whose footprints share files (union-find)", () => {
    // The ownerOnly policy (authorization) and the save operation (domain) share src/worker/routes/contacts.ts.
    expect(fallbackGroups(m, ["policy.ownerOnly", "operation.contact.save"], tree)).toHaveLength(1);
    const groups = fallbackGroups(m, evo("evolution.1").affectedNodes, tree);
    // policy.ownerOnly (authorization) and entity.ContactRecord (domain) both own src/worker/routes/contacts.ts.
    expect(groups).toContainEqual(["policy.ownerOnly", "entity.ContactRecord"]);
    expect(groups).toContainEqual(["screen.people", "affordance.AddContactDialog.save", "section.ui"]);
    expect(groups).toContainEqual(["thing.webapp"]);
    expect(groups).toHaveLength(3);
  });

  it("makes a plan with ids, footprints, criteria per group, waves and fallback provenance", () => {
    const p = fallbackPlan(input(evo2));
    expect(p.tasks.map((t) => t.id)).toEqual(["task.2.t1", "task.2.t2"]);
    expect(p.tasks.every((t) => t.origin === "fallback" && t.status === "planned" && t.thing === "thing.webapp")).toBe(true);
    expect(p.tasks[0].acceptanceCriteria).toEqual(["C.webapp.schedule.correct"]);
    expect(p.tasks[1].acceptanceCriteria).toEqual(["C.webapp.prompts.bounded"]);
    expect(p.tasks[0].footprint.globs).toContain("src/worker/routes/goals.ts");
    expect(p.tasks[0].footprint.appCommit).toBe("app1");
    expect(p.waves.flat().sort()).toEqual(["task.2.t1", "task.2.t2"]);
    expect(p.provenance).toEqual({ planner: { provider: "fallback", model: "fallback" }, fake: false });
    expect(p).toMatchObject({ version: 1, evolutionId: "evolution.2", genomeCommit: "g1", appCommit: "app1" });
  });

  it("derives dependsOn from cross-task links (reads)", () => {
    const p = fallbackPlan(input(custom(["component.SchedulePreview", "entity.RelationshipGoal"])));
    const ui = p.tasks.find((t) => t.nodes.includes("component.SchedulePreview"))!;
    const op = p.tasks.find((t) => t.nodes.includes("entity.RelationshipGoal"))!;
    expect(ui.dependsOn).toEqual([op.id]);
    expect(p.waves).toEqual([[op.id], [ui.id]]);
    expect(p.conflicts).toContainEqual(expect.objectContaining({ kind: "declared" }));
  });

  it("reports unscoped tasks and unknown nodes as problems", () => {
    const p = fallbackPlan(input(custom(["ext.device", "no.such.node"])));
    expect(p.tasks).toHaveLength(1);
    expect(p.problems).toContainEqual(expect.objectContaining({ task: p.tasks[0].id, severity: "missing", message: expect.stringContaining("unscoped") }));
    expect(p.problems).toContainEqual(expect.objectContaining({ severity: "warning", message: expect.stringContaining("no.such.node") }));
    expect(p.tasks[0].footprint.globs).toEqual([]);
    const empty = fallbackPlan(input(custom([])));
    expect(empty.tasks).toEqual([]);
    expect(empty.problems).toContainEqual({ severity: "missing", message: expect.stringContaining("names no affected nodes") });
  });
});

describe("planContext", () => {
  it("gives each affected node its kind, title, path, Thing, section, files, links, criteria and neighbours", () => {
    const ctx = planContext(m, evo("evolution.1"), "keep it small");
    const n = ctx.nodes.find((x) => x.id === "affordance.AddContactDialog.save")!;
    expect(n).toMatchObject({ thing: "thing.webapp", section: "section.ui" });
    expect(n.path.at(-1)).toBe("affordance.AddContactDialog.save");
    expect(n.linksOut).toContainEqual({ rel: "invokes", to: "operation.contact.save" });
    expect(n.neighbours).toContain("operation.contact.save");
    expect(n.criteria).toContain("C.webapp.contact.save");
    expect(n.files.length).toBeGreaterThan(0);
    expect(ctx.hint).toBe("keep it small");
    expect(ctx.evolution.acceptanceCriteria).toContainEqual({ id: "C.webapp.contact.save", claim: expect.any(String), subject: "affordance.AddContactDialog.save" });
  });
});

describe("Peopling evolution.2", () => {
  it("plans into goals, events and Today: goals and events run together, Today after both", () => {
    const p = fallbackPlan(input(evo("evolution.2")));
    expect(p.tasks.map((t) => t.nodes)).toEqual([
      ["operation.goal.save"],
      ["entity.ContactEvent", "operation.contact.log"],
      ["screen.goal", "screen.logContact", "screen.today", "component.TodayList", "affordance.Today.refresh"],
    ]);
    expect(p.tasks.map((t) => t.dependsOn)).toEqual([[], [], ["task.2.t1", "task.2.t2"]]);
    expect(p.conflicts.filter((c) => c.kind === "file")).toEqual([]);
    expect(p.waves).toEqual([["task.2.t1", "task.2.t2"], ["task.2.t3"]]);
  });
});

describe("validateReply", () => {
  const e2 = evo2;
  const t = (title: string, nodes: string[], extra: Partial<PlanReplyTask> = {}): PlanReplyTask =>
    ({ title, intent: `do ${title}`, nodes, dependsOn: [], acceptanceCriteria: [], ...extra });
  const domain = ["entity.RelationshipGoal", "operation.goal.save"];
  const ui = ["screen.goal", "screen.logContact", "screen.today"];

  it("drops unknown nodes with an error problem", () => {
    const { drafts, problems } = validateReply(input(e2), [t("A", [...domain, "no.such"]), t("B", ui)]);
    expect(drafts.map((d) => d.nodes)).toEqual([domain, ui]);
    expect(problems).toContainEqual({ severity: "error", message: expect.stringContaining("unknown node no.such") });
  });

  it("splits a task spanning Things into one per Thing", () => {
    const e = custom(["entity.DigestEdition", "commitment.no-engagement-mechanics"]);
    const { drafts, problems } = validateReply(input(e), [t("Both", e.affectedNodes)]);
    expect(drafts.map((d) => d.nodes)).toEqual([["entity.DigestEdition"], ["commitment.no-engagement-mechanics"]]);
    expect(problems).toContainEqual({ severity: "warning", message: expect.stringContaining("spans 2 Things") });
  });

  it("plans uncovered nodes with the fallback grouping", () => {
    const { drafts, problems } = validateReply(input(e2), [t("A", domain)]);
    expect(drafts).toHaveLength(2);
    expect(drafts[1]).toMatchObject({ nodes: ui, origin: "fallback" });
    expect(problems).toContainEqual({ severity: "missing", message: expect.stringContaining("screen.goal") });
  });

  it("removes a duplicate node from the later task", () => {
    const { drafts, problems } = validateReply(input(e2), [t("A", domain), t("B", ["operation.goal.save", ...ui])]);
    expect(drafts[1].nodes).toEqual(ui);
    expect(problems).toContainEqual({ severity: "warning", message: expect.stringContaining("operation.goal.save is already in an earlier task") });
  });

  it("maps dependsOn titles to task ids and keeps the reply's criteria", () => {
    const p = assemblePlan(input(e2), validateReply(input(e2), [
      t("A", domain, { acceptanceCriteria: ["C.webapp.schedule.correct", "C.nope"] }),
      t("B", ui, { dependsOn: ["A", "Missing"] }),
    ]).drafts, [], { planner: { provider: "x", model: "y" }, fake: false });
    expect(p.tasks[1].dependsOn).toEqual([taskId("evolution.2", 1)]);
    expect(p.tasks[0].acceptanceCriteria).toEqual(["C.webapp.schedule.correct"]);
    expect(p.tasks[1].acceptanceCriteria).toEqual(["C.webapp.prompts.bounded"]);
    expect(p.tasks.every((x) => x.origin === "llm")).toBe(true);
    expect(p.waves).toEqual([["task.2.t1"], ["task.2.t2"]]);
  });

  it("keeps a criterion on the task it is about when the reply moves it elsewhere", () => {
    const { drafts } = validateReply(input(e2), [
      t("A", domain, { acceptanceCriteria: ["C.webapp.schedule.correct", "C.webapp.prompts.bounded"] }),
      t("B", ui, { acceptanceCriteria: [] }),
    ]);
    // prompts.bounded is about screen.today (task B): the reply may add it to A, never take it from B.
    expect(drafts[1].acceptanceCriteria).toContain("C.webapp.prompts.bounded");
    expect(drafts[0].acceptanceCriteria).toContain("C.webapp.schedule.correct");
  });

  it("restores a criterion the reply omits, and drops criteria outside the Evolution", () => {
    const { drafts, problems } = validateReply(input(e2), [
      t("A", domain, { acceptanceCriteria: ["C.webapp.contact.save"] }),
      t("B", ui, { acceptanceCriteria: ["C.webapp.prompts.bounded"] }),
    ]);
    expect(drafts[0].acceptanceCriteria).toEqual(["C.webapp.schedule.correct"]);
    expect(drafts[1].acceptanceCriteria).toEqual(["C.webapp.prompts.bounded"]);
    expect(problems).toContainEqual({ severity: "warning", message: expect.stringContaining("C.webapp.contact.save is not one of evolution.2's") });
  });

  it("ignores a task naming itself, even when it is split, and warns on duplicate titles", () => {
    const e = custom(["entity.DigestEdition", "commitment.no-engagement-mechanics"]);
    const { drafts } = validateReply(input(e), [t("Both", e.affectedNodes, { dependsOn: ["Both"] })]);
    expect(drafts.map((d) => d.dependsOn)).toEqual([[], []]);
    const dup = validateReply(input(e2), [t("A", domain), t("A", ui)]);
    expect(dup.problems).toContainEqual({ severity: "warning", message: expect.stringContaining('two tasks are titled "A"') });
  });

  it("throws plan-cycle on a dependency cycle", () => {
    expect(() => validateReply(input(e2), [t("A", domain, { dependsOn: ["B"] }), t("B", ui, { dependsOn: ["A"] })])).toThrow(PlanError);
  });
});

describe("buildPlan", () => {
  it("falls back when the planner is off or fails", async () => {
    const off = await buildPlan(input(evo2), offPlanner());
    expect(off.provenance.planner.provider).toBe("fallback");
    const broken: Planner = { mode: "http", model: "m", plan: async () => ({ provider: "error", model: "m", error: "boom" }) };
    const p = await buildPlan(input(evo2), broken);
    expect(p.tasks.every((x) => x.origin === "fallback")).toBe(true);
    expect(p.problems).toContainEqual({ severity: "warning", message: expect.stringContaining("boom") });
  });

  it("fake planner: one task per section, #plan:split per node, #plan:dep a chain", async () => {
    const plain = await buildPlan(input(evo2), fakePlanner());
    expect(plain.tasks).toHaveLength(2);
    expect(plain.provenance).toEqual({ planner: { provider: "fake", model: "fake" }, fake: true });
    const split = await buildPlan(input(evo2, "#plan:split"), fakePlanner());
    expect(split.tasks).toHaveLength(5);
    expect(split.provenance.hint).toBe("#plan:split");
    const dep = await buildPlan(input(evo2, "#plan:dep"), fakePlanner());
    expect(dep.tasks[1].dependsOn).toContain(dep.tasks[0].id);
    expect(dep.waves).toHaveLength(2);
  });
});

describe("plannerFromEnv", () => {
  it("selects off, fake, http in order; the override wins", () => {
    expect(plannerFromEnv({ TRANSLATE: "0", FAKE_S1: "1", OPENROUTER_API_KEY: "k" }).mode).toBe("off");
    expect(plannerFromEnv({ FAKE_S1: "1", OPENROUTER_API_KEY: "k" }).mode).toBe("fake");
    expect(plannerFromEnv({ OPENROUTER_API_KEY: "k", OPENROUTER_PLAN_MODEL: "a/b" })).toMatchObject({ mode: "http", model: "a/b" });
    expect(plannerFromEnv({}).mode).toBe("off");
    const mine = fakePlanner();
    setPlannerOverride(mine);
    try { expect(plannerFromEnv({ TRANSLATE: "0" })).toBe(mine); } finally { setPlannerOverride(undefined); }
  });
});

describe("openRouterPlanner", () => {
  const ctx = planContext(m, evo2);
  const reply = (content: string, status = 200) => async () => new Response(JSON.stringify({ model: "x/y", choices: [{ message: { content } }] }), { status });

  it("parses a fenced JSON reply at temperature 0", async () => {
    let sent: { temperature?: number; messages?: { role: string }[] } = {};
    const f = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return reply("```json\n" + JSON.stringify({ tasks: [{ title: "A", nodes: ["screen.goal"] }] }) + "\n```")();
    }) as unknown as typeof fetch;
    const out = await openRouterPlanner({ apiKey: "sekret", fetch: f }).plan(ctx);
    expect(out).toMatchObject({ provider: "openrouter", model: "x/y", tasks: [{ title: "A", nodes: ["screen.goal"], dependsOn: [], acceptanceCriteria: [] }] });
    expect(sent.temperature).toBe(0);
    expect(sent.messages?.[0].role).toBe("system");
  });

  it("returns errors redacted, never throws", async () => {
    const f = (async () => new Response(JSON.stringify({ error: { code: 401, message: "bad key sekret" } }), { status: 401 })) as unknown as typeof fetch;
    const out = await openRouterPlanner({ apiKey: "sekret", fetch: f }).plan(ctx);
    expect(out.provider).toBe("error");
    expect(out.error).not.toContain("sekret");
    expect(parsePlanReply("nope")).toEqual({ error: "planner reply is not JSON" });
    expect(parsePlanReply('{"tasks":[]}')).toHaveProperty("error");
  });
});

describe("revisePlan", () => {
  const base = () => fallbackPlan(input(evo2));

  it("recomputes footprints and waves for merged tasks; changed tasks become user tasks", () => {
    const p = base();
    const [a, b] = p.tasks;
    const merged = { ...a, nodes: [...a.nodes, ...b.nodes], acceptanceCriteria: [...a.acceptanceCriteria, ...b.acceptanceCriteria], footprint: undefined };
    const out = revisePlan(input(evo2), p, { tasks: [merged] });
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0]).toMatchObject({ id: a.id, origin: "user", status: "planned" });
    expect(out.tasks[0].footprint.globs).toEqual(expect.arrayContaining(["src/ui/**", "src/worker/routes/goals.ts"]));
    expect(out.waves).toEqual([[a.id]]);
    expect(out.createdAt).toBe(p.createdAt);
  });

  it("keeps the origin of unchanged tasks and refuses invalid lists", () => {
    const p = base();
    const keep = revisePlan(input(evo2), p, { tasks: p.tasks });
    expect(keep.tasks.map((t) => t.origin)).toEqual(["fallback", "fallback"]);
    const [a, b] = p.tasks;
    const bad = (tasks: unknown[]) => { try { revisePlan(input(evo2), p, { tasks }); return null; } catch (e) { return e as { status: number; code: string }; } };
    expect(bad([{ ...a, nodes: ["no.such"] }, b])).toMatchObject({ status: 422, code: "invalid-plan" });
    expect(bad([a, { ...b, nodes: [...b.nodes, a.nodes[0]] }])).toMatchObject({ status: 422, code: "invalid-plan" });
    expect(bad([a, { ...b, dependsOn: ["task.2.t9"] }])).toMatchObject({ status: 422, code: "invalid-plan" });
    expect(bad([{ ...a, nodes: ["commitment.no-engagement-mechanics", ...a.nodes] }, b])).toMatchObject({ status: 422, code: "invalid-plan" });
    expect(bad([{ title: "x" }])).toMatchObject({ status: 400 });
    expect(bad([{ ...a, nodes: [...a.nodes, "entity.Connection"] }, b])).toMatchObject({ status: 422, code: "invalid-plan" });
    expect(bad([{ ...a, acceptanceCriteria: ["C.webapp.contact.save"] }, b])).toMatchObject({ status: 422, code: "invalid-plan" });
    expect(() => revisePlan(input(evo2), p, { tasks: [{ ...a, dependsOn: [b.id] }, { ...b, dependsOn: [a.id] }] })).toThrow(PlanError);
  });
});
