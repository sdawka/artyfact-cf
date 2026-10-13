/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { loadGenome, validateTaskDefinitions, type SystemModel } from "@artyfact/model";
import { metaTemplates } from "@artyfact/templates";
import type { Evolution, SystemCommit, SystemManifest } from "../../shared/api";
import {
  asCreated, assembleDraft, buildDraft, draftScope, fallbackGroups, nodeArtifact, planContext, realizedOn, stepsOf, validateReply,
  type DraftInput, type ScopeRequest,
} from "../../worker/tasks/planner";
import {
  fakePlanner, offPlanner, openRouterPlanner, parsePlanReply, plannerFromEnv, setPlannerOverride, type Planner, type PlanReplyTask,
} from "../../worker/tasks/planner-llm";

const raw = (g: Record<string, string>, root: string) =>
  Object.fromEntries(Object.entries(g).map(([p, t]) => [p.slice(p.indexOf(root) + root.length), t] as const));
const genome = raw(import.meta.glob("../../../../examples/peopling-system/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>, "peopling-system/");
const app = raw(import.meta.glob(["../../../../examples/peopling-app/**/*", "!**/node_modules/**", "!**/.wrangler/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>, "peopling-app/");

const m: SystemModel = loadGenome(genome, { templates: metaTemplates });
const tree = Object.keys(app);
const manifest: SystemManifest = { genomeCommit: "g1", artifacts: { "artifact.webapp": { repo: "app", commit: "a1" } }, templateVersions: {}, hookVersions: {} };
/** The example's Evolutions as if each had been accepted as a Genome amendment. */
const accepted: Evolution[] = m.evolutions.map((e) => ({ ...e, state: "promoted", kind: "genome-amendment" }) as Evolution);
/** Evolution 2 as most tests use it: one domain section and one UI section. */
const evo2: Evolution = { ...accepted.find((e) => e.id === "evolution.2")!, affectedNodes: ["entity.RelationshipGoal", "operation.goal.save", "screen.goal", "screen.logContact", "screen.today"] };
const custom = (affectedNodes: string[], acceptanceCriteria: string[] = []): Evolution =>
  ({ ...evo2, id: "evolution.9", title: "Custom", intent: "Do it.", affectedNodes, acceptanceCriteria });

function input(req: ScopeRequest, evolutions: Evolution[] = [evo2], history: SystemCommit[] = []) {
  const s = draftScope(m, manifest, history, evolutions, req);
  const i: DraftInput = {
    model: m, manifest, trees: { "artifact.webapp": tree }, genomeCommit: "g1",
    evolutions: s.evolutions, nodes: s.nodes, artifactOf: s.artifactOf, criteria: s.criteria,
    ...(req.hint && { hint: req.hint }), ...(req.title && { title: req.title }),
  };
  return { i, problems: s.problems };
}
const of = (e: Evolution, hint?: string) => input({ evolutionIds: [e.id], ...(hint && { hint }) }, [e]);
const fallback = async (e: Evolution) => { const x = of(e); return buildDraft(x.i, offPlanner(), x.problems); };
/** The request is one main's create accepts: unique ids, steps, write scope, matching identity, no cycle. */
const valid = (i: DraftInput, d: { request: { tasks: Parameters<typeof asCreated>[1] } }) => validateTaskDefinitions(asCreated(i, d.request.tasks));

describe("draftScope", () => {
  it("takes named accepted Evolutions and reports unknown, unaccepted and unbound scope", () => {
    const proposed = { ...custom(["screen.goal"]), id: "evolution.8", state: "proposed" } as Evolution;
    const s = draftScope(m, manifest, [], [evo2, proposed], { evolutionIds: [evo2.id, "evolution.8", "evolution.77"], nodes: ["no.such", "screen.person"] });
    expect(s.evolutions.map((e) => e.id)).toEqual(["evolution.2"]);
    expect(s.nodes).toEqual([...evo2.affectedNodes, "screen.person"]);
    expect(Object.values(s.artifactOf)).toEqual(s.nodes.map(() => "artifact.webapp"));
    expect(s.problems).toEqual(expect.arrayContaining([
      { severity: "error", message: expect.stringContaining("evolution.8 is a genome-amendment Evolution in state proposed") },
      { severity: "error", message: "unknown Evolution evolution.77; skipped" },
      { severity: "error", message: "unknown node no.such; dropped" },
    ]));
    // Explicit nodes bring the Genome's criteria about them; the Evolution brings its own.
    expect(s.criteria).toEqual(expect.arrayContaining(evo2.acceptanceCriteria));
  });

  it("with no Evolutions and no nodes takes every accepted Evolution; nothing in scope is a missing problem", () => {
    const s = draftScope(m, manifest, [], accepted, {});
    expect(s.evolutions.map((e) => e.id)).toEqual(accepted.map((e) => e.id));
    const none = draftScope(m, manifest, [], [], {});
    expect(none.nodes).toEqual([]);
    expect(none.problems).toContainEqual({ severity: "missing", message: expect.stringContaining("nothing to implement") });
  });

  it("skips an Evolution its binding realized at or after the commit that accepted it", () => {
    const commit = (id: string, genomeCommit: string, evolutions: string[] = []) => ({ id, genomeCommit, evolutions }) as unknown as SystemCommit;
    // Newest first: c3 realized g2 (accepted in c2 with evolution.2).
    const history = [commit("c3", "g2"), commit("c2", "g2", ["evolution.2"]), commit("c1", "g1")];
    const realized = { ...manifest, artifacts: { "artifact.webapp": { repo: "app", commit: "a2", realizedGenome: "g2" } } };
    expect(realizedOn(history, realized, "evolution.2", "artifact.webapp")).toBe(true);
    const older = { ...manifest, artifacts: { "artifact.webapp": { repo: "app", commit: "a2", realizedGenome: "g1" } } };
    expect(realizedOn(history, older, "evolution.2", "artifact.webapp")).toBe(false);
    expect(realizedOn(history, manifest, "evolution.2", "artifact.webapp")).toBe(false);
    const s = draftScope(m, realized, history, [evo2], { evolutionIds: ["evolution.2"] });
    expect(s.nodes).toEqual([]);
    expect(s.problems).toContainEqual({ severity: "warning", message: "evolution.2 is already realized on artifact.webapp; skipped" });
    expect(draftScope(m, realized, history, [evo2], {}).problems).not.toContainEqual(expect.objectContaining({ message: expect.stringContaining("already realized") }));
  });

  it("binds a node through its Thing's artifacts, and a System-level node to the only binding", () => {
    expect(nodeArtifact(m, manifest, "screen.people")).toBe("artifact.webapp");
    expect(nodeArtifact(m, manifest, "commitment.no-engagement-mechanics")).toBe("artifact.webapp");
    expect(nodeArtifact(m, { ...manifest, artifacts: {} }, "screen.people")).toBeNull();
  });
});

describe("fallback partition", () => {
  it("groups by binding and Thing, then nearest section", () => {
    const { i } = of(evo2);
    expect(fallbackGroups(i, i.nodes)).toEqual([
      ["entity.RelationshipGoal", "operation.goal.save"],
      ["screen.goal", "screen.logContact", "screen.today"],
    ]);
  });

  it("merges groups of one Thing whose footprints share files, never across Things or bindings", () => {
    const { i } = of(custom(["policy.ownerOnly", "operation.contact.save", "commitment.no-engagement-mechanics"]));
    // policy.ownerOnly (authorization) and the save operation (domain) share src/worker/routes/contacts.ts.
    expect(fallbackGroups(i, i.nodes)).toEqual([["policy.ownerOnly", "operation.contact.save"], ["commitment.no-engagement-mechanics"]]);
    const split = { ...i, artifactOf: { ...i.artifactOf, "operation.contact.save": "artifact.model-kit" } };
    expect(fallbackGroups(split, i.nodes)).toHaveLength(3);
  });

  it("drafts a request create accepts: ids, steps, write and read nodes, checks, derived dependencies, waves", async () => {
    const d = await fallback(evo2);
    const { i } = of(evo2);
    expect(d.request).toMatchObject({ title: `Implement ${evo2.title}`, genomeCommit: "g1" });
    expect(d.request.tasks.map((t) => [t.id, t.artifactId, t.writeNodes, t.checks])).toEqual([
      ["t1", "artifact.webapp", ["entity.RelationshipGoal", "operation.goal.save"], ["C.webapp.schedule.correct"]],
      ["t2", "artifact.webapp", ["screen.goal", "screen.logContact", "screen.today"], ["C.webapp.prompts.bounded"]],
    ]);
    // The screens invoke the goal operation: create's contract dependency is in the draft.
    expect(d.request.tasks[1].dependsOn).toEqual(["t1"]);
    expect(d.request.tasks[1].readNodes).toContain("operation.goal.save");
    expect(d.request.tasks.every((t) => t.steps.length > 0 && t.steps.every((s) => s.length <= 200))).toBe(true);
    expect(d.analysis.waves).toEqual([["t1"], ["t2"]]);
    expect(d.analysis.conflicts).toContainEqual(expect.objectContaining({ tasks: ["t1", "t2"], kind: "dependency" }));
    expect(d.provenance).toEqual({ planner: { provider: "fallback", model: "fallback" }, genomeCommit: "g1", evolutionIds: ["evolution.2"], nodes: evo2.affectedNodes, fake: false, fallback: true });
    expect(() => valid(i, d)).not.toThrow();
  });

  it("reports unscoped tasks; an empty scope drafts no tasks", async () => {
    const d = await fallback(custom(["commitment.no-engagement-mechanics"]));
    expect(d.request.tasks).toHaveLength(1);
    expect(d.problems).toContainEqual({ taskId: "t1", severity: "missing", message: expect.stringContaining("unscoped") });
    const empty = await fallback(custom(["no.such.node"]));
    expect(empty.request.tasks).toEqual([]);
    expect(empty.problems).toContainEqual({ severity: "missing", message: expect.stringContaining("nothing to implement") });
  });

  it("is deterministic", async () => {
    expect(JSON.stringify(await fallback(evo2))).toBe(JSON.stringify(await fallback(evo2)));
    const e1 = accepted.find((e) => e.id === "evolution.1")!;
    expect(JSON.stringify(await fallback(e1))).toBe(JSON.stringify(await fallback(e1)));
    const x = of(evo2, "#plan:split");
    expect(JSON.stringify(await buildDraft(x.i, fakePlanner()))).toBe(JSON.stringify(await buildDraft(x.i, fakePlanner())));
  });
});

describe("validateReply", () => {
  const { i } = of(evo2);
  const t = (title: string, nodes: string[], extra: Partial<PlanReplyTask> = {}): PlanReplyTask =>
    ({ title, intent: `Do ${title}.`, nodes, dependsOn: [], acceptanceCriteria: [], ...extra });
  const domain = ["entity.RelationshipGoal", "operation.goal.save"];
  const ui = ["screen.goal", "screen.logContact", "screen.today"];

  it("drops unknown and out-of-scope nodes, and removes a duplicate from the later task", () => {
    const { drafts, problems } = validateReply(i, [t("A", [...domain, "no.such", "screen.person"]), t("B", ["operation.goal.save", ...ui])]);
    expect(drafts.map((d) => d.nodes)).toEqual([domain, ui]);
    expect(problems).toEqual(expect.arrayContaining([
      { severity: "error", message: expect.stringContaining("unknown node no.such") },
      { severity: "warning", message: expect.stringContaining("screen.person is not in the draft's scope") },
      { severity: "warning", message: expect.stringContaining("operation.goal.save is already in an earlier task") },
    ]));
  });

  it("splits a task spanning Things into one per Thing", () => {
    const x = of(custom(["entity.DigestEdition", "commitment.no-engagement-mechanics"]));
    const { drafts, problems } = validateReply(x.i, [t("Both", x.i.nodes)]);
    expect(drafts.map((d) => d.nodes)).toEqual([["entity.DigestEdition"], ["commitment.no-engagement-mechanics"]]);
    expect(problems).toContainEqual({ severity: "warning", message: expect.stringContaining("spans 2 Things or source bindings") });
  });

  it("plans uncovered nodes with the fallback grouping", () => {
    const { drafts, problems } = validateReply(i, [t("A", domain)]);
    expect(drafts.map((d) => [d.nodes, d.origin])).toEqual([[domain, "llm"], [ui, "fallback"]]);
    expect(problems).toContainEqual({ severity: "missing", message: expect.stringContaining("screen.goal") });
  });

  it("keeps a criterion on the task it is about when the reply moves it elsewhere", () => {
    const { drafts } = validateReply(i, [
      t("A", domain, { acceptanceCriteria: ["C.webapp.schedule.correct", "C.webapp.prompts.bounded"] }),
      t("B", ui, { acceptanceCriteria: [] }),
    ]);
    // prompts.bounded is about screen.today (task B): the reply may add it to A, never take it from B.
    expect(drafts[1].checks).toContain("C.webapp.prompts.bounded");
    expect(drafts[0].checks).toEqual(["C.webapp.schedule.correct", "C.webapp.prompts.bounded"]);
  });

  it("restores a criterion the reply omits and drops criteria outside the draft's", () => {
    const { drafts, problems } = validateReply(i, [
      t("A", domain, { acceptanceCriteria: ["C.webapp.contact.save"] }),
      t("B", ui, { acceptanceCriteria: ["C.webapp.prompts.bounded"] }),
    ]);
    expect(drafts.map((d) => d.checks)).toEqual([["C.webapp.schedule.correct"], ["C.webapp.prompts.bounded"]]);
    expect(problems).toContainEqual({ severity: "warning", message: expect.stringContaining("C.webapp.contact.save is not one of the draft's criteria") });
  });

  it("maps dependsOn titles, ignores self-dependencies and warns on duplicate titles", () => {
    const { drafts, problems } = validateReply(i, [t("A", domain, { dependsOn: ["A"] }), t("B", ui, { dependsOn: ["A", "Missing"] })]);
    expect(drafts.map((d) => d.dependsOn)).toEqual([[], [0]]);
    expect(problems).toContainEqual({ severity: "warning", message: expect.stringContaining('unknown task "Missing"') });
    expect(validateReply(i, [t("A", domain), t("A", ui)]).problems).toContainEqual({ severity: "warning", message: expect.stringContaining('two tasks are titled "A"') });
  });

  it("drops the edges closing a reply cycle with an error problem; the request stays valid", async () => {
    const cyclic: Planner = { mode: "http", model: "m", plan: async () => ({ provider: "openrouter", model: "m", tasks: [t("A", domain, { dependsOn: ["B"] }), t("B", ui, { dependsOn: ["A"] })] }) };
    const d = await buildDraft(i, cyclic);
    expect(d.problems).toContainEqual({ severity: "error", message: expect.stringContaining("form a cycle") });
    expect(() => valid(i, d)).not.toThrow();
    // A kept "A after B" contradicts the screens' invokes link to the goal operation: dropped, so B runs after A.
    expect(d.problems).toContainEqual({ severity: "warning", message: expect.stringContaining("contradicts the Genome's links") });
    expect(d.analysis.waves).toEqual([["t1"], ["t2"]]);
  });
});

describe("assembleDraft", () => {
  it("merges same-binding tasks that Genome links make depend on each other", () => {
    const { i } = of(evo2);
    // An extra contract link back from the goal operation to the Today screen closes a cycle with the screens' invokes.
    const linksOut = { ...m.index.linksOut, "operation.goal.save": [...(m.index.linksOut["operation.goal.save"] ?? []), { from: "operation.goal.save", rel: "reads", to: "screen.today" }] };
    const looped = { ...i, model: { ...m, index: { ...m.index, linksOut } } as SystemModel };
    const drafts = [
      { title: "A", intent: "A.", artifactId: "artifact.webapp", nodes: ["entity.RelationshipGoal", "operation.goal.save"], dependsOn: [], checks: [], origin: "llm" as const },
      { title: "B", intent: "B.", artifactId: "artifact.webapp", nodes: ["screen.goal", "screen.logContact", "screen.today"], dependsOn: [], checks: [], origin: "llm" as const },
    ];
    const d = assembleDraft(looped, drafts, []);
    expect(d.request.tasks.map((t) => t.writeNodes)).toEqual([[...drafts[0].nodes, ...drafts[1].nodes]]);
    expect(d.problems).toContainEqual({ severity: "warning", message: expect.stringContaining("merged into one task") });
    expect(() => valid(looped, d)).not.toThrow();
  });

  it("splits intents into steps within create's limits", () => {
    expect(stepsOf("First do this. Then that!", "x")).toEqual(["First do this.", "Then that!"]);
    const long = stepsOf(`${"word ".repeat(120)}end.`, "x");
    expect(long.length).toBeGreaterThan(1);
    expect(long.every((s) => s.length > 0 && s.length <= 200)).toBe(true);
    expect(stepsOf("  ", "Implement X")).toEqual(["Implement X"]);
  });
});

describe("planContext and the fake planner", () => {
  it("gives each node its kind, path, Thing, artifact, section, files, links, criteria and neighbours", () => {
    const x = of(accepted.find((e) => e.id === "evolution.1")!, "keep it small");
    const ctx = planContext(x.i);
    const n = ctx.nodes.find((y) => y.id === "affordance.AddContactDialog.save")!;
    expect(n).toMatchObject({ thing: "thing.webapp", artifact: "artifact.webapp", section: "section.ui" });
    expect(n.linksOut).toContainEqual({ rel: "invokes", to: "operation.contact.save" });
    expect(n.neighbours).toContain("operation.contact.save");
    expect(n.files.length).toBeGreaterThan(0);
    expect(ctx.hint).toBe("keep it small");
    expect(ctx.evolutions.map((e) => e.id)).toEqual(["evolution.1"]);
    expect(ctx.criteria).toContainEqual({ id: "C.webapp.contact.save", claim: expect.any(String), subject: "affordance.AddContactDialog.save" });
  });

  it("fake: one task per section, #plan:split one per node, #plan:dep a chain", async () => {
    const plain = await buildDraft(of(evo2).i, fakePlanner());
    expect(plain.request.tasks).toHaveLength(2);
    expect(plain.provenance).toMatchObject({ planner: { provider: "fake", model: "fake" }, fake: true, fallback: false });
    const split = await buildDraft(of(evo2, "#plan:split").i, fakePlanner());
    expect(split.request.tasks).toHaveLength(5);
    const dep = await buildDraft(of(custom(["entity.DigestEdition", "commitment.no-engagement-mechanics"]), "#plan:dep").i, fakePlanner());
    expect(dep.request.tasks[1].dependsOn).toEqual(["t1"]);
    expect(dep.analysis.waves).toEqual([["t1"], ["t2"]]);
  });

  it("falls back when the planner is off or fails", async () => {
    const off = await buildDraft(of(evo2).i, offPlanner());
    expect(off.provenance).toMatchObject({ planner: { provider: "fallback" }, fallback: true });
    const broken: Planner = { mode: "http", model: "m", plan: async () => ({ provider: "error", model: "m", error: "boom" }) };
    const d = await buildDraft(of(evo2).i, broken);
    expect(d.request.tasks).toEqual(off.request.tasks);
    expect(d.problems).toContainEqual({ severity: "warning", message: expect.stringContaining("boom") });
  });
});

describe("plannerFromEnv", () => {
  it("selects off, fake, http in order; the override wins", () => {
    expect(plannerFromEnv({ TRANSLATE: "0", FAKE_S1: "1", OPENROUTER_API_KEY: "k" }).mode).toBe("off");
    expect(plannerFromEnv({ FAKE_S1: "1", OPENROUTER_API_KEY: "k" }).mode).toBe("fake");
    expect(plannerFromEnv({ OPENROUTER_API_KEY: "k", OPENROUTER_PLAN_MODEL: "a/b" })).toMatchObject({ mode: "http", model: "a/b" });
    expect(plannerFromEnv({ OPENROUTER_API_KEY: "k", OPENROUTER_TRANSLATE_MODEL: "c/d" })).toMatchObject({ mode: "http", model: "c/d" });
    expect(plannerFromEnv({}).mode).toBe("off");
    const mine = fakePlanner();
    setPlannerOverride(mine);
    try { expect(plannerFromEnv({ TRANSLATE: "0" })).toBe(mine); } finally { setPlannerOverride(undefined); }
  });
});

describe("openRouterPlanner", () => {
  const ctx = planContext(of(evo2).i);
  const ok = (content: string) => new Response(JSON.stringify({ model: "x/y", choices: [{ message: { content } }] }));

  it("parses a fenced JSON reply at temperature 0 and caps reply text", async () => {
    let sent: { temperature?: number; messages?: { role: string }[] } = {};
    const f = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return ok("```json\n" + JSON.stringify({ tasks: [{ title: "A".repeat(300), intent: "i".repeat(3000), nodes: ["screen.goal"] }] }) + "\n```");
    }) as unknown as typeof fetch;
    const out = await openRouterPlanner({ apiKey: "sekret", fetch: f }).plan(ctx);
    expect(out).toMatchObject({ provider: "openrouter", model: "x/y", tasks: [{ nodes: ["screen.goal"], dependsOn: [], acceptanceCriteria: [] }] });
    expect(out.tasks![0].title).toHaveLength(200);
    expect(out.tasks![0].intent).toHaveLength(2000);
    expect(sent.temperature).toBe(0);
    expect(sent.messages?.[0].role).toBe("system");
  });

  it("retries 429 and 5xx a bounded number of times, then returns a redacted error", async () => {
    let calls = 0;
    const flaky = (async () => (++calls === 1 ? new Response("{}", { status: 429 }) : ok(JSON.stringify({ tasks: [{ title: "A", nodes: ["screen.goal"] }] })))) as unknown as typeof fetch;
    expect((await openRouterPlanner({ apiKey: "k", fetch: flaky, backoffMs: 0 }).plan(ctx)).tasks).toHaveLength(1);
    expect(calls).toBe(2);
    calls = 0;
    const down = (async () => { calls++; return new Response(JSON.stringify({ error: { message: "down sekret" } }), { status: 503 }); }) as unknown as typeof fetch;
    const out = await openRouterPlanner({ apiKey: "sekret", fetch: down, retries: 2, backoffMs: 0 }).plan(ctx);
    expect(calls).toBe(3);
    expect(out.provider).toBe("error");
    expect(out.error).not.toContain("sekret");
    expect(parsePlanReply("nope")).toEqual({ error: "planner reply is not JSON" });
    expect(parsePlanReply('{"tasks":[]}')).toHaveProperty("error");
  });
});
