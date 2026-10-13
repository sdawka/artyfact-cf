/**
 * Task planner (backend.md B.9): splits an Evolution into Tasks with footprints, conflicts and waves.
 *
 * Pure part: `planContext` (what an LLM planner sees), `fallbackPlan` (deterministic: group by Thing → nearest section →
 * union-find of groups sharing footprint paths or globs; `dependsOn` derived from cross-task links), `validateReply`
 * (an LLM reply checked like ops; fixes become `problems`), `assemblePlan` (footprints, conflicts, waves) and
 * `revisePlan` (a whole-list edit from `PUT …/plan`). Env part: `makePlan`, `getPlan`, `updatePlan` for the routes.
 */
import { schema, type SystemModel } from "@artyfact/model";
import type { PlanRequest, PlanUpdateRequest, Task, TaskPlan, TaskPlanProblem } from "../../shared/api";
import { artifactsFor, withRepo } from "../artifacts/client";
import { listTree } from "../artifacts/genome-source";
import { badRequest, conflict, fromRpc, HttpError, notFound, unprocessable } from "../errors";
import { genomeAt, systemStub } from "../service";
import { nowIso } from "../util";
import { taskFootprint } from "./footprint";
import { derivedDependencies, PlanError, taskConflicts, waves } from "./independence";
import { plannerFromEnv, type PlanContext, type Planner, type PlannerEnv, type PlanReplyTask } from "./planner-llm";

/** The Evolution as the planner needs it (the DO's Evolution DTO fits). */
export interface PlanEvolution {
  id: string;
  title: string;
  intent: string;
  kind?: string;
  affectedNodes: string[];
  acceptanceCriteria: string[];
}

export interface PlanInput {
  model: SystemModel;
  evolution: PlanEvolution;
  /** App head tree paths (the footprint globs expand over it). */
  tree: string[];
  appCommit: string | null;
  genomeCommit: string;
  hint?: string;
}

/** A task before ids, footprints and status: what planners and edits produce. */
export interface TaskDraft {
  id?: string;
  title: string;
  intent: string;
  nodes: string[];
  /** Task ids once assembled; titles in an LLM reply (mapped by `validateReply`). */
  dependsOn: string[];
  acceptanceCriteria: string[];
  origin: Task["origin"];
}

/** Planning is allowed in these Evolution states. */
export const PLANNABLE_STATES = ["genome-approved", "actionable", "realizing"] as const;

const uniq = <T>(xs: Iterable<T>) => [...new Set(xs)];

// ------------------------------------------------------------------ model helpers

/** The Thing on a node's containment path (a Thing is its own); null for System-level and unknown nodes. */
export function nodeThing(m: SystemModel, id: string): string | null {
  return m.index.path(id).find((x) => m.index.byId[x]?.type === "thing") ?? null;
}

const nameOf = (m: SystemModel, id: string) => m.index.byId[id]?.name || id;

/** `task.<evolution id without "evolution.">.t<n>`. */
export function taskId(evolutionId: string, n: number): string {
  return `task.${evolutionId.replace(/^evolution\./, "")}.t${n}`;
}

/**
 * Acceptance criteria of a task: the Evolution's criteria whose subject is one of `nodes` or lies under one of them,
 * plus the System-owned ones. Unknown criteria are skipped (`criteriaProblems` reports them).
 */
export function criteriaFor(m: SystemModel, evolutionCriteria: string[], nodes: string[]): string[] {
  const set = new Set(nodes);
  return evolutionCriteria.filter((cid) => {
    const c = m.criteria.find((x) => x.id === cid);
    if (!c) return false;
    return c.ownerKind === "system" || set.has(c.subjectId) || m.index.path(c.subjectId).some((p) => set.has(p));
  });
}

/** Evolution criteria no task carries go to every task of their subject's Thing (all tasks when none matches). */
function coverCriteria(m: SystemModel, evolutionCriteria: string[], drafts: TaskDraft[]): void {
  const carried = new Set(drafts.flatMap((d) => d.acceptanceCriteria));
  for (const cid of evolutionCriteria) {
    const c = m.criteria.find((x) => x.id === cid);
    if (!c || carried.has(cid)) continue;
    const thing = nodeThing(m, c.subjectId) ?? (c.ownerKind === "thing" ? c.ownerId : null);
    const targets = drafts.filter((d) => d.nodes.some((n) => nodeThing(m, n) === thing));
    for (const d of targets.length ? targets : drafts) d.acceptanceCriteria.push(cid);
  }
}

// ------------------------------------------------------------------ context

/** What an LLM planner gets per affected node: id, kind, title, path, Thing, section, files, links, criteria, neighbours. */
export function planContext(m: SystemModel, e: PlanEvolution, hint?: string): PlanContext {
  const nodes = uniq(e.affectedNodes).filter((id) => m.index.byId[id]).map((id) => {
    const out = m.index.linksOut[id] ?? [];
    const into = m.index.linksIn[id] ?? [];
    return {
      id,
      kind: m.index.byId[id].kind,
      title: nameOf(m, id),
      path: m.index.path(id),
      thing: nodeThing(m, id),
      section: m.index.layer(id) ?? null,
      files: (m.files[id] ?? []).map((g) => g.glob),
      linksOut: out.map((l) => ({ rel: l.rel, to: l.to })),
      criteria: m.index.criteriaBySubject[id] ?? [],
      neighbours: uniq([...out.map((l) => l.to), ...into.map((l) => l.from), ...(m.index.children[id] ?? [])]).filter((x) => x !== id).sort(),
    };
  });
  const acceptanceCriteria = e.acceptanceCriteria.map((cid) => {
    const c = m.criteria.find((x) => x.id === cid);
    return { id: cid, claim: c?.claim ?? "", subject: c?.subjectId ?? "" };
  });
  return {
    evolution: { id: e.id, title: e.title, intent: e.intent, ...(e.kind && { kind: e.kind }), acceptanceCriteria },
    nodes,
    ...(hint && { hint }),
  };
}

// ------------------------------------------------------------------ fallback

/**
 * Partitions `nodes` (order kept): one group per (Thing, nearest section); groups of one Thing whose single-node
 * footprints share a path or a glob are merged (union-find). Never merges across Things.
 */
export function fallbackGroups(m: SystemModel, nodes: string[], tree: string[]): string[][] {
  const ns = uniq(nodes);
  const parent = ns.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const thing = ns.map((n) => nodeThing(m, n));
  const key = ns.map((n, i) => `${thing[i] ?? ""}|${m.index.layer(n) ?? ""}`);
  const fp = ns.map((n) => taskFootprint({ model: m, nodes: [n], tree }));
  for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
    if (thing[i] !== thing[j]) continue;
    if (key[i] === key[j]) { union(i, j); continue; }
    const paths = new Set(fp[i].paths), globs = new Set(fp[i].globs);
    if (fp[j].paths.some((p) => paths.has(p)) || fp[j].globs.some((g) => globs.has(g))) union(i, j);
  }
  const groups = new Map<number, string[]>();
  ns.forEach((n, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), n]);
  });
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
}

/** A group's label: its sections' names, else its Thing's name, else "System". */
function groupLabel(m: SystemModel, nodes: string[]): string {
  const sections = uniq(nodes.map((n) => m.index.layer(n)).filter((s): s is string => !!s));
  if (sections.length) return sections.map((s) => nameOf(m, s)).join(" + ");
  const t = nodeThing(m, nodes[0]);
  return t ? nameOf(m, t) : "System";
}

function fallbackDrafts(i: PlanInput, nodes: string[]): TaskDraft[] {
  const m = i.model;
  return fallbackGroups(m, nodes, i.tree).map((g) => ({
    title: `${i.evolution.title}: ${groupLabel(m, g)}`,
    intent: `${i.evolution.intent} Scope: ${g.map((n) => nameOf(m, n)).join(", ")}.`.trim(),
    nodes: g,
    dependsOn: [],
    acceptanceCriteria: criteriaFor(m, i.evolution.acceptanceCriteria, g),
    origin: "fallback" as const,
  }));
}

/** Affected nodes the model does not know: reported, never planned. */
function unknownNodes(i: PlanInput): { known: string[]; problems: TaskPlanProblem[] } {
  const all = uniq(i.evolution.affectedNodes);
  const known = all.filter((n) => i.model.index.byId[n]);
  const problems = all.filter((n) => !i.model.index.byId[n])
    .map((n): TaskPlanProblem => ({ severity: "warning", message: `affected node ${n} is not in the Genome; no task covers it` }));
  if (!known.length) problems.push({ severity: "missing", message: `${i.evolution.id} names no affected nodes in the Genome; there is nothing to plan` });
  return { known, problems };
}

function criteriaProblems(i: PlanInput): TaskPlanProblem[] {
  return i.evolution.acceptanceCriteria.filter((cid) => !i.model.criteria.some((c) => c.id === cid))
    .map((cid) => ({ severity: "warning", message: `acceptance criterion ${cid} is not in the Genome` }));
}

type Provenance = TaskPlan["provenance"];

/** The deterministic plan; derived dependencies that would form a cycle are dropped with a warning. */
export function fallbackPlan(i: PlanInput, provenance?: Provenance, extra: TaskPlanProblem[] = []): TaskPlan {
  const { known, problems } = unknownNodes(i);
  const drafts = fallbackDrafts(i, known);
  coverCriteria(i.model, i.evolution.acceptanceCriteria, drafts);
  return assemblePlan(i, drafts, [...extra, ...problems, ...criteriaProblems(i)], provenance ?? { planner: { provider: "fallback", model: "fallback" }, fake: false, ...(i.hint && { hint: i.hint }) }, { derive: "acyclic" });
}

// ------------------------------------------------------------------ LLM reply validation

/**
 * Checks an LLM reply against the Evolution like ops: unknown and unaffected nodes are dropped, a node in two tasks
 * stays only in the first, a task spanning Things is split per Thing, uncovered affected nodes get fallback tasks,
 * unknown criteria are dropped (a task left without criteria gets `criteriaFor`), `dependsOn` titles become task ids.
 * Every fix is a problem. A cycle among the reply's own dependencies throws `PlanError("plan-cycle")`.
 */
export function validateReply(i: PlanInput, reply: PlanReplyTask[]): { drafts: TaskDraft[]; problems: TaskPlanProblem[] } {
  const m = i.model;
  const { known, problems } = unknownNodes(i);
  const affected = new Set(known);
  const used = new Set<string>();
  // Reply criteria must be the Evolution's (and in the Genome): the reply is untrusted and may only add, never remove.
  const genomeCrits = new Set(m.criteria.map((c) => c.id));
  const crits = new Set(i.evolution.acceptanceCriteria.filter((c) => genomeCrits.has(c)));
  // Each reply task becomes zero or more drafts (split per Thing); `pieces[k]` are the draft indexes of reply task k.
  const drafts: (TaskDraft & { deps: string[] })[] = [];
  const pieces: number[][] = [];
  const titleIndex = new Map<string, number>();
  reply.forEach((t, k) => {
    if (!titleIndex.has(t.title)) titleIndex.set(t.title, k);
    else problems.push({ severity: "warning", message: `two tasks are titled "${t.title}"; dependencies on it mean the first` });
    const nodes: string[] = [];
    for (const n of t.nodes) {
      if (!m.index.byId[n]) { problems.push({ severity: "error", message: `task "${t.title}": unknown node ${n} dropped` }); continue; }
      if (!affected.has(n)) { problems.push({ severity: "warning", message: `task "${t.title}": node ${n} is not affected by ${i.evolution.id}; dropped` }); continue; }
      if (used.has(n) || nodes.includes(n)) { problems.push({ severity: "warning", message: `task "${t.title}": node ${n} is already in an earlier task; removed` }); continue; }
      nodes.push(n);
    }
    nodes.forEach((n) => used.add(n));
    const criteria = t.acceptanceCriteria.filter((c) => {
      if (crits.has(c)) return true;
      problems.push({ severity: "warning", message: `task "${t.title}": criterion ${c} is not one of ${i.evolution.id}'s; dropped` });
      return false;
    });
    if (!nodes.length) {
      problems.push({ severity: "warning", message: `task "${t.title}" has no nodes left; dropped` });
      pieces.push([]);
      return;
    }
    const byThing = new Map<string, string[]>();
    for (const n of nodes) {
      const th = nodeThing(m, n) ?? "";
      byThing.set(th, [...(byThing.get(th) ?? []), n]);
    }
    if (byThing.size > 1) {
      problems.push({ severity: "warning", message: `task "${t.title}" spans ${byThing.size} Things; split into one task per Thing` });
    }
    const idx: number[] = [];
    for (const [th, ns] of byThing) {
      const own = criteria.filter((c) => criteriaFor(m, [c], ns).length || byThing.size === 1);
      idx.push(drafts.length);
      drafts.push({
        title: byThing.size > 1 ? `${t.title} (${th ? nameOf(m, th) : "System"})` : t.title,
        intent: t.intent,
        nodes: ns,
        dependsOn: [],
        deps: t.dependsOn,
        // The task's own criteria always stand; the reply can only add Evolution criteria to them.
        acceptanceCriteria: uniq([...criteriaFor(m, i.evolution.acceptanceCriteria, ns), ...own]),
        origin: "llm",
      });
    }
    pieces.push(idx);
  });

  const uncovered = known.filter((n) => !used.has(n));
  if (uncovered.length) {
    problems.push({ severity: "missing", message: `no task covered ${uncovered.join(", ")}; planned by the fallback` });
    for (const d of fallbackDrafts(i, uncovered)) drafts.push({ ...d, deps: [] });
  }

  // Titles → draft indexes (every piece of a split task).
  const deps: number[][] = drafts.map((d, j) => uniq(d.deps.flatMap((title) => {
    const k = titleIndex.get(title);
    if (k !== undefined && pieces[k].includes(j)) return []; // a task naming itself (or a split task its own pieces)
    if (k === undefined) { problems.push({ severity: "warning", message: `task "${d.title}" depends on unknown task "${title}"; dropped` }); return []; }
    return pieces[k].filter((x) => x !== j);
  })));
  const cycle = findCycle(deps);
  if (cycle) throw new PlanError("plan-cycle", cycle.map((j) => drafts[j].title));
  return {
    drafts: drafts.map(({ deps: _d, ...d }, j) => ({ ...d, dependsOn: deps[j].map(String) })),
    problems,
  };
}

/** Indexes on a dependency cycle (sorted), or null. */
function findCycle(deps: number[][]): number[] | null {
  const state = deps.map(() => 0);
  const stack: number[] = [];
  const visit = (v: number): number[] | null => {
    state[v] = 1;
    stack.push(v);
    for (const w of deps[v]) {
      if (state[w] === 1) return stack.slice(stack.indexOf(w)).sort((a, b) => a - b);
      if (state[w] === 0) { const c = visit(w); if (c) return c; }
    }
    stack.pop();
    state[v] = 2;
    return null;
  };
  for (let v = 0; v < deps.length; v++) if (state[v] === 0) { const c = visit(v); if (c) return c; }
  return null;
}

// ------------------------------------------------------------------ assembly

/**
 * Tasks from drafts: ids (minted `task.<n>.t<k>` unless set), Thing, footprints over the app tree; then dependencies,
 * conflicts and waves. Draft `dependsOn` are draft indexes (as strings) unless `opts.ids` says they are task ids.
 * `opts.derive`: "acyclic" adds derived dependencies that keep the graph acyclic (fallback and LLM plans); "none"
 * keeps the drafts' own (edits). Unscoped tasks are problems. A cycle throws `PlanError("plan-cycle")`.
 */
export function assemblePlan(
  i: PlanInput, drafts: TaskDraft[], problems: TaskPlanProblem[], provenance: Provenance,
  opts: { derive: "acyclic" | "none"; ids?: boolean; createdAt?: string } = { derive: "acyclic" },
): TaskPlan {
  const m = i.model;
  const ids = drafts.map((d, k) => d.id ?? taskId(i.evolution.id, k + 1));
  const tasks: Task[] = drafts.map((d, k) => ({
    id: ids[k],
    evolutionId: i.evolution.id,
    title: d.title,
    intent: d.intent,
    thing: nodeThing(m, d.nodes[0]),
    nodes: d.nodes,
    footprint: taskFootprint({ model: m, nodes: d.nodes, tree: i.tree, ...(i.appCommit && { appCommit: i.appCommit }) }),
    acceptanceCriteria: uniq(d.acceptanceCriteria),
    dependsOn: uniq(opts.ids ? d.dependsOn : d.dependsOn.map((x) => ids[Number(x)])).filter((x) => x !== ids[k]),
    status: "planned",
    origin: d.origin,
  }));
  const out = [...problems];
  if (opts.derive === "acyclic") {
    const derived = derivedDependencies(tasks, m);
    let dropped = 0;
    for (const t of tasks) for (const d of derived[t.id] ?? []) {
      if (t.dependsOn.includes(d)) continue;
      if (reaches(tasks, d, t.id)) { dropped++; continue; }
      t.dependsOn.push(d);
    }
    if (dropped) out.push({ severity: "warning", message: `${dropped} derived ${dropped === 1 ? "dependency was" : "dependencies were"} dropped to keep the plan acyclic` });
  }
  for (const t of tasks) {
    if (!t.footprint.globs.length) out.push({ task: t.id, severity: "missing", message: `unscoped: no files are bound to ${t.nodes.join(", ")}; the task has no footprint` });
  }
  const conflicts = taskConflicts(tasks, m);
  const ws = waves(tasks, conflicts);
  const at = nowIso();
  return {
    version: 1,
    evolutionId: i.evolution.id,
    genomeCommit: i.genomeCommit,
    appCommit: i.appCommit,
    tasks,
    conflicts,
    waves: ws,
    problems: out,
    provenance,
    createdAt: opts.createdAt ?? at,
    updatedAt: at,
  };
}

/** Whether `from` reaches `to` over `dependsOn`. */
function reaches(tasks: Task[], from: string, to: string): boolean {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const x = stack.pop()!;
    if (x === to) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    stack.push(...(byId.get(x)?.dependsOn ?? []));
  }
  return false;
}

// ------------------------------------------------------------------ planning

/**
 * Plans with `planner`: a valid reply is validated and assembled (origin `llm`); an off planner or a failed reply
 * gives the fallback plan (a failure is a warning). A cycle in the reply throws `PlanError`.
 */
export async function buildPlan(i: PlanInput, planner: Planner): Promise<TaskPlan> {
  const hint = i.hint ? { hint: i.hint } : {};
  if (planner.mode === "off") return fallbackPlan(i);
  const reply = await planner.plan(planContext(i.model, i.evolution, i.hint));
  const provenance: Provenance = { planner: { provider: reply.provider, model: reply.model }, fake: planner.mode === "fake", ...hint };
  if (!reply.tasks) {
    const why = reply.error ?? `planner ${reply.provider} gave no tasks`;
    return fallbackPlan(i, { planner: { provider: "fallback", model: "fallback" }, fake: planner.mode === "fake", ...hint }, [{ severity: "warning", message: `${why}; planned by the fallback` }]);
  }
  const { drafts, problems } = validateReply(i, reply.tasks);
  coverCriteria(i.model, i.evolution.acceptanceCriteria, drafts);
  return assemblePlan(i, drafts, [...problems, ...criteriaProblems(i)], provenance, { derive: "acyclic" });
}

// ------------------------------------------------------------------ whole-list edits

const EditTask = schema.Task.omit({ footprint: true }).extend({ footprint: schema.TaskFootprint.optional() });
const EditBody = EditTask.array().min(1);

const sameDefinition = (a: Task, b: Pick<Task, "title" | "intent" | "nodes" | "acceptanceCriteria" | "dependsOn">) =>
  a.title === b.title && a.intent === b.intent && JSON.stringify(a.nodes) === JSON.stringify(b.nodes)
  && JSON.stringify(a.acceptanceCriteria) === JSON.stringify(b.acceptanceCriteria) && JSON.stringify(a.dependsOn) === JSON.stringify(b.dependsOn);

/**
 * A whole-list edit (`PUT …/plan`): tasks are checked (ids unique and of this Evolution, nodes known and of one Thing,
 * each node in one task, `dependsOn` among the list, criteria known; 400/422 otherwise), footprints, conflicts and
 * waves recomputed. Changed or new tasks get origin `user`; uncovered affected nodes are warnings.
 */
export function revisePlan(i: PlanInput, existing: TaskPlan, body: unknown): TaskPlan {
  const parsed = EditBody.safeParse((body as PlanUpdateRequest | undefined)?.tasks);
  if (!parsed.success) throw badRequest(`tasks: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ").slice(0, 300)}`);
  const m = i.model;
  const list = parsed.data;
  const invalid = (msg: string) => unprocessable("invalid-plan", msg);
  const ids = new Set<string>();
  const used = new Map<string, string>();
  const evoCrits = new Set(i.evolution.acceptanceCriteria);
  const affected = new Set(i.evolution.affectedNodes);
  for (const t of list) {
    if (t.evolutionId !== i.evolution.id) throw invalid(`task ${t.id} belongs to ${t.evolutionId}, not ${i.evolution.id}`);
    if (ids.has(t.id)) throw invalid(`task ${t.id} appears twice`);
    ids.add(t.id);
    for (const n of t.nodes) {
      if (!m.index.byId[n]) throw invalid(`task ${t.id}: unknown node ${n}`);
      if (affected.size && !affected.has(n)) throw invalid(`task ${t.id}: node ${n} is not affected by ${i.evolution.id}`);
      if (used.has(n)) throw invalid(`node ${n} is in both ${used.get(n)} and ${t.id}`);
      used.set(n, t.id);
    }
    const things = uniq(t.nodes.map((n) => nodeThing(m, n)));
    if (things.length > 1) throw invalid(`task ${t.id} spans ${things.map((x) => x ?? "the System").join(", ")}; a task belongs to one Thing`);
    for (const c of t.acceptanceCriteria) if (!evoCrits.has(c)) throw invalid(`task ${t.id}: criterion ${c} is not one of ${i.evolution.id}'s`);
  }
  for (const t of list) for (const d of t.dependsOn) if (!ids.has(d)) throw invalid(`task ${t.id} depends on ${d}, which is not in the plan`);
  const before = new Map(existing.tasks.map((t) => [t.id, t]));
  const drafts: TaskDraft[] = list.map((t) => {
    const prev = before.get(t.id);
    return {
      id: t.id, title: t.title, intent: t.intent, nodes: t.nodes, dependsOn: t.dependsOn, acceptanceCriteria: t.acceptanceCriteria,
      origin: prev && sameDefinition(prev, t) ? prev.origin : "user",
    };
  });
  const { known, problems } = unknownNodes(i);
  const uncovered = known.filter((n) => !used.has(n));
  if (uncovered.length) problems.push({ severity: "warning", message: `no task covers ${uncovered.join(", ")}` });
  return assemblePlan(i, drafts, [...problems, ...criteriaProblems(i)], existing.provenance, { derive: "none", ids: true, createdAt: existing.createdAt });
}

// ------------------------------------------------------------------ env: routes call these

const trees = new Map<string, string[]>();
const TREES_MAX = 8;

/** The app head tree's paths, memoised per `${repo}@${commit}`. */
async function appTree(env: Env, source: { repo: string; commit: string }): Promise<string[]> {
  const key = `${source.repo}@${source.commit}`;
  let t = trees.get(key);
  if (!t) {
    t = [...(await withRepo(artifactsFor(env), source.repo, (r) => listTree(r, source.commit))).keys()];
    trees.set(key, t);
    if (trees.size > TREES_MAX) trees.delete(trees.keys().next().value!);
  }
  return t;
}

async function rpc<T>(p: Promise<T> | T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    throw fromRpc(e) ?? e;
  }
}

/** `putPlan` through RPC; its `invalid-state` (a task was claimed meanwhile) is `plan-in-progress`. */
async function store(stub: ReturnType<typeof systemStub>, plan: TaskPlan): Promise<TaskPlan> {
  try {
    return await rpc(stub.putPlan(plan));
  } catch (e) {
    if (e instanceof HttpError && e.code === "invalid-state") throw conflict("plan-in-progress", e.message);
    throw e;
  }
}

async function inputFor(env: Env, systemId: string, evolutionId: string, hint?: string) {
  const stub = systemStub(env, systemId);
  const state = await stub.state();
  if (!state) throw notFound(`system ${systemId} is not imported`);
  const evolution = await stub.evolution(evolutionId);
  if (!evolution) throw notFound(`unknown evolution ${evolutionId}`);
  const { model } = await genomeAt(env, systemId, state.genomeCommit, state.genomeSource);
  const tree = state.appSource ? await appTree(env, state.appSource) : [];
  const input: PlanInput = { model, evolution, tree, appCommit: state.appSource?.commit ?? null, genomeCommit: state.genomeCommit, ...(hint && { hint }) };
  return { stub, evolution, input };
}

const noPlan = (evolutionId: string) => new HttpError(404, "no-plan", `${evolutionId} has no task plan`);
const started = (plan: TaskPlan) => plan.tasks.filter((t) => t.status !== "planned");

const planCycle = (e: unknown): never => {
  if (e instanceof PlanError) throw unprocessable("plan-cycle", `task dependencies form a cycle: ${e.ids.join(", ")}`, { tasks: e.ids });
  throw e;
};

/** `GET …/plan`: the stored plan; 404 `no-plan`. */
export async function getPlan(env: Env, systemId: string, evolutionId: string): Promise<TaskPlan> {
  const stub = systemStub(env, systemId);
  if (!(await stub.state())) throw notFound(`system ${systemId} is not imported`);
  const plan = await stub.plan(evolutionId);
  if (!plan) throw noPlan(evolutionId);
  return plan;
}

/**
 * `POST …/plan {hint?, force?}`: plans the Evolution (states genome-approved, actionable, realizing) and stores the
 * plan (`plan.updated`). 409 `plan-in-progress` when a plan exists, unless no task started and `force`.
 */
export async function makePlan(env: Env, systemId: string, evolutionId: string, body: Record<string, unknown>): Promise<TaskPlan> {
  const req = body as PlanRequest;
  if (req.hint !== undefined && typeof req.hint !== "string") throw badRequest("hint must be a string");
  if (req.force !== undefined && typeof req.force !== "boolean") throw badRequest("force must be a boolean");
  const hint = req.hint?.trim().slice(0, 2000) || undefined;
  const { stub, evolution, input } = await inputFor(env, systemId, evolutionId, hint);
  if (!(PLANNABLE_STATES as readonly string[]).includes(evolution.state)) {
    throw conflict("invalid-state", `${evolutionId} is ${evolution.state}; plan an Evolution that is ${PLANNABLE_STATES.join(", ")}`);
  }
  const existing = await stub.plan(evolutionId);
  if (existing) {
    const s = started(existing);
    if (s.length) throw conflict("plan-in-progress", `the plan of ${evolutionId} is in progress: ${s.map((t) => `${t.id} is ${t.status}`).join(", ")}`, { tasks: s.map((t) => t.id) });
    if (!req.force) throw conflict("plan-in-progress", `${evolutionId} already has a plan; pass force to replan`);
  }
  const plan = await buildPlan(input, plannerFromEnv(env as unknown as PlannerEnv)).catch(planCycle);
  return store(stub, plan);
}

/** `PUT …/plan {tasks}`: a whole-list edit; refused 409 `plan-in-progress` while any task is past `planned`. */
export async function updatePlan(env: Env, systemId: string, evolutionId: string, body: Record<string, unknown>): Promise<TaskPlan> {
  const { stub, input } = await inputFor(env, systemId, evolutionId);
  const existing = await stub.plan(evolutionId);
  if (!existing) throw noPlan(evolutionId);
  const s = started(existing);
  if (s.length) throw conflict("plan-in-progress", `tasks past planned cannot be edited: ${s.map((t) => `${t.id} is ${t.status}`).join(", ")}`, { tasks: s.map((t) => t.id) });
  let plan: TaskPlan;
  try { plan = revisePlan(input, existing, body); } catch (e) { plan = planCycle(e); }
  return store(stub, plan);
}
