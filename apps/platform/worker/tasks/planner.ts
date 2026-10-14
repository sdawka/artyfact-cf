/**
 * Realization plan drafts (`POST /api/systems/:id/realization-plans/draft`, lifecycle.md). The planner turns accepted,
 * not-yet-realized Genome scope into a `CreateRealizationPlanRequest` that posts unchanged to the create route, plus the
 * analysis create would compute and every fix as a problem. It persists nothing.
 *
 * Pure part: `draftScope` (which Evolutions and nodes, each node's source binding, the criteria pool), `planContext`
 * (what an LLM planner sees), `fallbackGroups` (artifact → Thing → nearest section → union-find over shared footprint
 * paths or globs), `validateReply` (an LLM reply checked like ops; it may add criteria, never move or drop them) and
 * `assembleDraft` (ids, steps, read nodes, create's derived dependencies, and `analyzeTasks` over `taskDefinitions`, the
 * same definitions create stores).
 * Env part: `draftRealizationPlan` for the route.
 *
 * Problem severities: `error` means asked-for scope was lost or create will refuse the request; `missing` means part of
 * the scope has no task or no source files; `warning` means the planner's output was repaired and the request is usable.
 */
import { analyzeTasks, type SystemModel, type TaskAnalysis, type TaskDefinition } from "@artyfact/model";
import { z } from "zod";
import type { Evolution, SystemCommit, SystemManifest } from "../../shared/api";
import type { CreateRealizationPlanRequest, DraftPlanProblem, DraftRealizationPlanResponse, RealizationPlan } from "../../shared/lifecycle";
import { artifactsFor, withRepo } from "../artifacts/client";
import { listTree } from "../artifacts/genome-source";
import { badRequest, notFound } from "../errors";
import { genomeAt, systemStub } from "../service";
import { globMatch } from "../artifacts/source-map";
import { contractDependencies, expandNodes, taskDefinitions } from "./definitions";
import { taskFootprint } from "./footprint";
import { isHostedDemo } from "../demo";
import { demoPlanner, plannerFromEnv, type PlanContext, type Planner, type PlanReplyTask } from "./planner-llm";

/** Create's limits (`lifecycle-service.ts` planSchema): ids, titles and steps up to 200 characters, 100 tasks. */
const MAX_TEXT = 200;
const MAX_TASKS = 100;
const MAX_STEPS = 20;
/** Create's limit on each of a task's id lists. */
const MAX_LIST = 500;

const uniq = <T>(xs: Iterable<T>) => [...new Set(xs)];
const clip = (s: string, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** An accepted Genome Evolution as the planner needs it. */
export interface DraftEvolution { id: string; title: string; intent: string; affectedNodes: string[]; acceptanceCriteria: string[] }

/** Everything a draft is computed from; `draftScope` builds it from the request. */
export interface DraftInput {
  model: SystemModel;
  manifest: SystemManifest;
  /** App tree paths per source binding (footprint globs expand over them). */
  trees: Record<string, string[]>;
  genomeCommit: string;
  evolutions: DraftEvolution[];
  /** Known nodes to implement, in order. */
  nodes: string[];
  /** Node id → its source binding (a key of `manifest.artifacts`). */
  artifactOf: Record<string, string>;
  /** Criteria tasks may carry: the Evolutions' (in the Genome) plus, for explicit nodes, the Genome's about them. */
  criteria: string[];
  /** Removed nodes whose code a task on a surviving ancestor deletes. */
  removals?: DraftRemoval[];
  hint?: string;
  title?: string;
}

/** A task before ids, footprints and read nodes: what planners produce. `dependsOn` are draft indexes. */
export interface TaskDraft {
  title: string;
  intent: string;
  artifactId: string;
  nodes: string[];
  dependsOn: number[];
  checks: string[];
  origin: "llm" | "fallback";
}

// ------------------------------------------------------------------ model helpers

/** The Thing on a node's containment path (a Thing is its own); null for System-level and unknown nodes. */
export function nodeThing(m: SystemModel, id: string): string | null {
  return m.index.path(id).find((x) => m.index.byId[x]?.type === "thing") ?? null;
}

const nameOf = (m: SystemModel, id: string) => m.index.byId[id]?.name || id;

/**
 * The source binding whose code implements `id`: the binding its own source globs name (`sourceBinding`), else the
 * first of its Thing's artifacts in the manifest (worker-fullstack first), else, for a System-level node, the
 * System's only binding or its worker-fullstack one. Null when none is bound.
 */
export function nodeArtifact(m: SystemModel, manifest: SystemManifest, id: string): string | null {
  const bound = (a: string | undefined) => (a && manifest.artifacts[a] ? a : null);
  for (const g of m.files[id] ?? []) {
    const a = bound(g.bindingId ?? g.artifact);
    if (a) return a;
  }
  const order = (xs: { artifact: string; type: string }[]) => [...xs].sort((a, b) => Number(b.type === "worker-fullstack") - Number(a.type === "worker-fullstack"));
  const thing = nodeThing(m, id);
  if (thing) {
    const t = m.things.find((x) => x.id === thing);
    return order(t?.artifacts ?? []).map((a) => bound(a.artifact)).find((a) => a) ?? null;
  }
  const keys = Object.keys(manifest.artifacts);
  if (keys.length === 1) return keys[0];
  return order(m.things.flatMap((t) => t.artifacts)).map((a) => bound(a.artifact)).find((a) => a) ?? null;
}

/**
 * Criteria of a task: those of `pool` whose subject is one of `nodes` or lies under one of them, plus the
 * System-owned ones. Unknown criteria are skipped.
 */
export function criteriaFor(m: SystemModel, pool: string[], nodes: string[]): string[] {
  const set = new Set(nodes);
  return pool.filter((cid) => {
    const c = m.criteria.find((x) => x.id === cid);
    if (!c) return false;
    return c.ownerKind === "system" || set.has(c.subjectId) || m.index.path(c.subjectId).some((p) => set.has(p));
  });
}

/** Pool criteria no task carries go to every task of their subject's Thing (all tasks when none matches). */
function coverCriteria(m: SystemModel, pool: string[], drafts: TaskDraft[]): void {
  const carried = new Set(drafts.flatMap((d) => d.checks));
  for (const cid of pool) {
    const c = m.criteria.find((x) => x.id === cid);
    if (!c || carried.has(cid)) continue;
    const thing = nodeThing(m, c.subjectId) ?? (c.ownerKind === "thing" ? c.ownerId : null);
    const targets = drafts.filter((d) => d.nodes.some((n) => nodeThing(m, n) === thing));
    for (const d of targets.length ? targets : drafts) d.checks.push(cid);
  }
}


// ------------------------------------------------------------------ scope

/** What realization and removal checks read: System history (newest first), the plan store, when each Evolution was accepted. */
export interface ScopeHistory {
  history: SystemCommit[];
  plans: RealizationPlan[];
  /** Evolution id → index in `history` of the commit that accepted it, or that first carried it (seeded from Genome YAML). */
  acceptedAt: Record<string, number>;
  /** Evolution id → the Genome before its acceptance (the parent commit's), when one of its nodes was removed. */
  previous: Record<string, SystemModel | undefined>;
}

/** The binding `artifactId` in System commit `c` (composition first, else the model manifest). */
function bindingAt(c: SystemCommit, artifactId: string): { repo?: string; commit?: string; realizedGenome?: string; realizationPlan?: string } | undefined {
  const b = c.composition?.artifacts?.[artifactId];
  if (b) return b;
  const x = (c.manifest ?? []).find((y) => y.artifact === artifactId);
  return x && { repo: x.repo, commit: x.commit };
}

/** The oldest index in `history` whose System commit pins Genome `genome`; -1 when none does. */
function genomeIndex(history: SystemCommit[], genome: string): number {
  let k = -1;
  history.forEach((c, i) => { if (c.genomeCommit === genome) k = i; });
  return k;
}

/**
 * The history index of the Genome a binding realized before any realization plan, main's rule (`phenome.ts`): the newest
 * commit carrying the binding without `realizationPlan`; its `realizedGenome`, else the Genome of the oldest commit
 * carrying that same source commit. -1 when the binding never had one.
 */
export function legacyRealizedIndex(history: SystemCommit[], artifactId: string): number {
  for (let i = 0; i < history.length; i++) {
    const b = bindingAt(history[i], artifactId);
    if (!b || b.realizationPlan) continue;
    if (b.realizedGenome) return genomeIndex(history, b.realizedGenome);
    let j = i;
    for (let k = i + 1; k < history.length; k++) {
      const x = bindingAt(history[k], artifactId);
      if (!x || x.realizationPlan || x.repo !== b.repo || x.commit !== b.commit) break;
      j = k;
    }
    return genomeIndex(history, history[j].genomeCommit);
  }
  return -1;
}

/**
 * Whether `node` of an Evolution accepted at history index `accepted` is implemented on binding `artifactId`: a promoted
 * realization plan pinned at or after the acceptance wrote it, on any binding (create stores expanded write nodes),
 * or the binding's pre-plan realized Genome (`legacyRealizedIndex`) is at or after the acceptance. `realizedGenome`
 * alone is not used: promote records it for every binding of a plan, whatever the plan's scope.
 */
export function nodeRealized(h: ScopeHistory, accepted: number | undefined, artifactId: string, node: string): boolean {
  if (accepted === undefined || accepted < 0) return false;
  // Any binding: a plan may have put the node on a different binding than the one it maps to now.
  const byPlan = h.plans.some((p) => {
    if (p.status !== "promoted") return false;
    const pinned = genomeIndex(h.history, p.genome.commit);
    return pinned >= 0 && pinned <= accepted && p.tasks.some((t) => t.writeNodes.includes(node));
  });
  if (byPlan) return true;
  const legacy = legacyRealizedIndex(h.history, artifactId);
  return legacy >= 0 && legacy <= accepted;
}

/** The first plan not yet promoted (planned, implementing or integrated) whose tasks write `node`. */
export function openPlanHolding(h: ScopeHistory, node: string): RealizationPlan | undefined {
  return h.plans.find((p) => p.status !== "promoted" && p.tasks.some((t) => t.writeNodes.includes(node)));
}

/** An Evolution the draft may implement: a Genome amendment that was accepted. */
export const isAcceptedGenomeEvolution = (e: Pick<Evolution, "state" | "kind">) => e.state === "promoted" && e.kind === "genome-amendment";

export interface ScopeRequest { evolutionIds?: string[]; nodes?: string[]; hint?: string; title?: string }

/** A node an Evolution removed: its code goes with a task on its nearest surviving ancestor that maps to files. */
export interface DraftRemoval { evolutionId: string; node: string; title: string; ancestor: string; artifactId: string; globs: string[] }

export interface DraftScope {
  evolutions: DraftEvolution[];
  nodes: string[];
  artifactOf: Record<string, string>;
  criteria: string[];
  removals: DraftRemoval[];
  problems: DraftPlanProblem[];
}

/**
 * Picks the scope of a draft. Named Evolutions must be accepted Genome amendments; with neither `evolutionIds` nor
 * `nodes`, every accepted Evolution with an unrealized node is taken. Nodes already realized (`nodeRealized`) are
 * skipped; so are nodes an open plan holds, unless their Evolution is named. Explicit nodes are always taken. A removed node is resolved in the Genome before acceptance and becomes a
 * removal on its nearest surviving, file-mapped ancestor. The criteria pool holds the Evolutions' criteria about taken
 * nodes (and removal ancestors) plus System-owned ones, and the Genome's criteria about explicit nodes.
 */
export function draftScope(
  model: SystemModel, manifest: SystemManifest, h: ScopeHistory, all: Evolution[], req: ScopeRequest, trees: Record<string, string[]> = {},
): DraftScope {
  const problems: DraftPlanProblem[] = [];
  const known = (id: string) => !!model.index.byId[id];
  const isCriterion = (id: string) => model.criteria.some((c) => c.id === id);
  const artifactOf: Record<string, string> = {};
  const bind = (id: string) => (artifactOf[id] ??= nodeArtifact(model, manifest, id) ?? "") || null;

  const explicit = uniq(req.nodes ?? []);
  let chosen: Evolution[];
  if (req.evolutionIds?.length) {
    chosen = [];
    for (const id of uniq(req.evolutionIds)) {
      const e = all.find((x) => x.id === id);
      if (!e) { problems.push({ severity: "error", message: `unknown Evolution ${id}; skipped` }); continue; }
      if (!isAcceptedGenomeEvolution(e)) { problems.push({ severity: "error", message: `${id} is a ${e.kind} Evolution in state ${e.state}, not an accepted Genome change; skipped` }); continue; }
      chosen.push(e);
    }
  } else if (!explicit.length) {
    chosen = all.filter(isAcceptedGenomeEvolution);
  } else chosen = [];

  const nodes: string[] = [];
  const pool: string[] = [];
  const evolutions: DraftEvolution[] = [];
  const removals: DraftRemoval[] = [];
  const named = new Set(req.evolutionIds ?? []);
  for (const e of chosen) {
    const take: string[] = [];
    const gone: DraftRemoval[] = [];
    const realized: string[] = [];
    const held = new Map<string, string[]>();
    const hold = (n: string, writes: string) => {
      if (named.has(e.id)) return false;
      const p = openPlanHolding(h, writes);
      if (p) held.set(p.id, [...(held.get(p.id) ?? []), n]);
      return !!p;
    };
    const accepted = h.acceptedAt[e.id];
    if (accepted === undefined) problems.push({ severity: "warning", message: `the acceptance of ${e.id} was not found in System history; its nodes count as unrealized` });
    for (const n of e.affectedNodes ?? []) {
      if (isCriterion(n)) continue;
      if (!known(n)) {
        const r = removalOf(model, manifest, h.previous[e.id], e.id, n, trees);
        if ("problem" in r) {
          // Unresolvable, but every binding already realized the Genome that dropped it (an Evolution seeded at import).
          if (Object.keys(manifest.artifacts).every((a) => nodeRealized(h, accepted, a, n))) { realized.push(n); continue; }
          problems.push(r.problem);
          continue;
        }
        if (nodeRealized(h, accepted, r.artifactId, r.ancestor)) { realized.push(n); continue; }
        if (hold(n, r.ancestor)) continue;
        gone.push(r);
        continue;
      }
      const a = bind(n);
      if (!a) { problems.push({ severity: "error", message: `${e.id}: node ${n} has no source binding in the manifest; dropped` }); continue; }
      if (nodeRealized(h, accepted, a, n)) { realized.push(n); continue; }
      if (hold(n, n)) continue;
      take.push(n);
    }
    for (const [pid, ns] of held) {
      problems.push({ severity: "warning", message: `${e.id}: ${ns.join(", ")} ${ns.length === 1 ? "is" : "are"} in open plan ${pid}; skipped (name ${e.id} to draft ${ns.length === 1 ? "it" : "them"} again)` });
    }
    if (!take.length && !gone.length && held.size) continue;
    if (!take.length && !gone.length && realized.length) {
      if (named.has(e.id)) problems.push({ severity: "warning", message: `${e.id} is already realized; skipped` });
      continue;
    }
    if (realized.length) problems.push({ severity: "warning", message: `${e.id}: ${realized.join(", ")} already realized; skipped` });
    if (!take.length && !gone.length) {
      if (named.has(e.id)) problems.push({ severity: "missing", message: `${e.id} names no nodes to implement` });
      continue;
    }
    evolutions.push({ id: e.id, title: e.title, intent: e.intent, affectedNodes: [...take, ...gone.map((r) => r.node)], acceptanceCriteria: e.acceptanceCriteria ?? [] });
    nodes.push(...take);
    removals.push(...gone);
    const scoped = [...take, ...gone.map((r) => r.ancestor)];
    for (const c of uniq([...(e.acceptanceCriteria ?? []), ...(e.affectedNodes ?? []).filter(isCriterion)])) {
      if (!isCriterion(c)) { problems.push({ severity: "warning", message: `${e.id}: acceptance criterion ${c} is not in the Genome` }); continue; }
      // Only criteria about what this draft implements: one about a realized node would land on an unrelated task.
      if (criteriaFor(model, [c], scoped).length) pool.push(c);
    }
  }
  for (const n of explicit) {
    if (!known(n)) { problems.push({ severity: "error", message: `unknown node ${n}; dropped` }); continue; }
    if (!bind(n)) { problems.push({ severity: "error", message: `node ${n} has no source binding in the manifest; dropped` }); continue; }
    nodes.push(n);
    pool.push(...model.criteria.filter((c) => c.subjectId === n || model.index.path(c.subjectId).includes(n)).map((c) => c.id));
  }
  const scope = uniq(nodes);
  if (!scope.length && !removals.length) problems.push({ severity: "missing", message: "nothing to implement: no accepted, unrealized Genome change or node in scope" });
  return {
    evolutions, nodes: scope, criteria: uniq(pool), removals,
    artifactOf: Object.fromEntries(scope.map((n) => [n, artifactOf[n]])),
    problems,
  };
}

/**
 * Resolves a node the accepted Genome no longer has: in `before` (the Genome before acceptance) it must exist. The
 * removal goes to its nearest surviving, bound ancestor whose footprint (expanded, as create computes it) covers every
 * path the removed subtree's old globs match in the binding's tree, so submit accepts the deletions. Anything
 * unresolvable is a `missing` problem: the draft would otherwise leave the code in place silently.
 */
function removalOf(
  model: SystemModel, manifest: SystemManifest, before: SystemModel | undefined, eid: string, n: string, trees: Record<string, string[]>,
): DraftRemoval | { problem: DraftPlanProblem } {
  const missing = (message: string) => ({ problem: { severity: "missing" as const, message } });
  if (!before?.index.byId[n]) return missing(`${eid}: node ${n} is not in the accepted Genome and cannot be resolved in the Genome before it; its code is not planned`);
  const globs = uniq(expandNodes(before, [n]).flatMap((id) => (before.files[id] ?? []).map((g) => g.glob))).sort();
  for (const a of [...before.index.path(n)].reverse().slice(1)) {
    if (!model.index.byId[a]) continue;
    const artifactId = nodeArtifact(model, manifest, a);
    if (!artifactId) continue;
    const tree = trees[artifactId] ?? [];
    const old = tree.filter((p) => globs.some((g) => globMatch(g, p)));
    const fp = taskFootprint(model, expandNodes(model, [a]), tree, artifactId, manifest.artifacts[artifactId]?.repo ?? "");
    if (!fp.globs.length || !old.every((p) => fp.globs.some((g) => globMatch(g, p)))) continue;
    return { evolutionId: eid, node: n, title: before.index.byId[n].name || n, ancestor: a, artifactId, globs };
  }
  return missing(`${eid}: no surviving ancestor of removed node ${n} has a footprint covering its code; delete it (${globs.join(", ") || "no globs"}) by hand`);
}

// ------------------------------------------------------------------ context

/** What an LLM planner gets: the Evolutions, the criteria pool and, per node, kind, title, path, Thing, artifact, section, files, links, criteria, neighbours. */
export function planContext(i: DraftInput): PlanContext {
  const m = i.model;
  const nodes = i.nodes.map((id) => {
    const out = m.index.linksOut[id] ?? [];
    const into = m.index.linksIn[id] ?? [];
    return {
      id,
      kind: m.index.byId[id].kind,
      title: nameOf(m, id),
      path: m.index.path(id),
      thing: nodeThing(m, id),
      artifact: i.artifactOf[id],
      section: m.index.layer(id) ?? null,
      files: (m.files[id] ?? []).map((g) => g.glob),
      linksOut: out.map((l) => ({ rel: l.rel, to: l.to })),
      criteria: m.index.criteriaBySubject[id] ?? [],
      neighbours: uniq([...out.map((l) => l.to), ...into.map((l) => l.from), ...(m.index.children[id] ?? [])]).filter((x) => x !== id).sort(),
    };
  });
  const criteria = i.criteria.map((cid) => {
    const c = m.criteria.find((x) => x.id === cid);
    return { id: cid, claim: c?.claim ?? "", subject: c?.subjectId ?? "" };
  });
  return {
    evolutions: i.evolutions.map((e) => ({ id: e.id, title: e.title, intent: e.intent })),
    criteria,
    nodes,
    ...(i.hint && { hint: i.hint }),
  };
}

// ------------------------------------------------------------------ fallback

/**
 * Partitions `nodes` (order kept): one group per (artifact, Thing, nearest section); groups of one artifact and Thing
 * whose single-node footprints share a path or a glob are merged (union-find). Never merges across Things or bindings.
 */
export function fallbackGroups(i: DraftInput, nodes: string[]): string[][] {
  const m = i.model;
  const ns = uniq(nodes);
  const parent = ns.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const owner = ns.map((n) => `${i.artifactOf[n]}|${nodeThing(m, n) ?? ""}`);
  const key = ns.map((n, k) => `${owner[k]}|${m.index.layer(n) ?? ""}`);
  const fp = ns.map((n) => {
    const a = i.artifactOf[n];
    return taskFootprint(m, [n], i.trees[a] ?? [], a, i.manifest.artifacts[a]?.repo ?? "");
  });
  for (let a = 0; a < ns.length; a++) for (let b = a + 1; b < ns.length; b++) {
    if (owner[a] !== owner[b]) continue;
    if (key[a] === key[b]) { union(a, b); continue; }
    const paths = new Set(fp[a].paths), globs = new Set(fp[a].globs);
    if (fp[b].paths.some((p) => paths.has(p)) || fp[b].globs.some((g) => globs.has(g))) union(a, b);
  }
  const groups = new Map<number, string[]>();
  ns.forEach((n, k) => {
    const r = find(k);
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

/** The draft's overall intent: the Evolutions' intents, else a generic line. */
const scopeIntent = (i: DraftInput) => i.evolutions.map((e) => e.intent.trim()).filter(Boolean).join(" ") || "Implement the accepted Genome for these nodes.";

function fallbackDrafts(i: DraftInput, nodes: string[]): TaskDraft[] {
  const m = i.model;
  const lead = i.evolutions.length === 1 ? i.evolutions[0].title : "Implement";
  return fallbackGroups(i, nodes).map((g) => ({
    title: `${lead}: ${groupLabel(m, g)}`,
    intent: `${scopeIntent(i)} Scope: ${g.map((n) => nameOf(m, n)).join(", ")}.`,
    artifactId: i.artifactOf[g[0]],
    nodes: g,
    dependsOn: [],
    checks: criteriaFor(m, i.criteria, g),
    origin: "fallback" as const,
  }));
}

// ------------------------------------------------------------------ LLM reply validation

/**
 * Checks an LLM reply like ops: unknown and out-of-scope nodes are dropped, a node in two tasks stays only in the
 * first, a task spanning Things or bindings is split, uncovered nodes get fallback tasks, `dependsOn` titles become
 * draft indexes. Reply criteria outside the pool are dropped; every task always keeps `criteriaFor` its own nodes, so a
 * reply can add criteria but never move or drop them. Every fix is a `warning` (unknown nodes and a dependency cycle,
 * whose closing edges are dropped, included): the repaired request is usable.
 */
export function validateReply(i: DraftInput, reply: PlanReplyTask[]): { drafts: TaskDraft[]; problems: DraftPlanProblem[] } {
  const m = i.model;
  const problems: DraftPlanProblem[] = [];
  const scope = new Set(i.nodes);
  const used = new Set<string>();
  const pool = new Set(i.criteria);
  const drafts: (TaskDraft & { deps: string[] })[] = [];
  // `pieces[k]`: the draft indexes reply task k became (split per Thing and binding).
  const pieces: number[][] = [];
  const titleIndex = new Map<string, number>();
  reply.forEach((t, k) => {
    if (!titleIndex.has(t.title)) titleIndex.set(t.title, k);
    else problems.push({ severity: "warning", message: `two tasks are titled "${t.title}"; dependencies on it mean the first` });
    const nodes: string[] = [];
    for (const n of t.nodes) {
      if (!m.index.byId[n]) { problems.push({ severity: "warning", message: `task "${t.title}": unknown node ${n} dropped` }); continue; }
      if (!scope.has(n)) { problems.push({ severity: "warning", message: `task "${t.title}": node ${n} is not in the draft's scope; dropped` }); continue; }
      if (used.has(n) || nodes.includes(n)) { problems.push({ severity: "warning", message: `task "${t.title}": node ${n} is already in an earlier task; removed` }); continue; }
      nodes.push(n);
    }
    nodes.forEach((n) => used.add(n));
    const criteria = t.acceptanceCriteria.filter((c) => {
      if (pool.has(c)) return true;
      problems.push({ severity: "warning", message: `task "${t.title}": criterion ${c} is not one of the draft's criteria; dropped` });
      return false;
    });
    if (!nodes.length) {
      problems.push({ severity: "warning", message: `task "${t.title}" has no nodes left; dropped` });
      pieces.push([]);
      return;
    }
    const byOwner = new Map<string, string[]>();
    for (const n of nodes) {
      const key = `${i.artifactOf[n]}|${nodeThing(m, n) ?? ""}`;
      byOwner.set(key, [...(byOwner.get(key) ?? []), n]);
    }
    if (byOwner.size > 1) {
      problems.push({ severity: "warning", message: `task "${t.title}" spans ${byOwner.size} Things or source bindings; split into one task each` });
    }
    const idx: number[] = [];
    for (const [key, ns] of byOwner) {
      const thing = key.slice(key.indexOf("|") + 1);
      const own = criteria.filter((c) => criteriaFor(m, [c], ns).length || byOwner.size === 1);
      idx.push(drafts.length);
      drafts.push({
        title: byOwner.size > 1 ? `${t.title} (${thing ? nameOf(m, thing) : "System"}, ${i.artifactOf[ns[0]]})` : t.title,
        intent: t.intent,
        artifactId: i.artifactOf[ns[0]],
        nodes: ns,
        dependsOn: [],
        deps: t.dependsOn,
        // The task's own criteria always stand; the reply can only add pool criteria to them.
        checks: uniq([...criteriaFor(m, i.criteria, ns), ...own]),
        origin: "llm",
      });
    }
    pieces.push(idx);
  });

  const uncovered = i.nodes.filter((n) => !used.has(n));
  if (uncovered.length) {
    problems.push({ severity: "missing", message: `no task covered ${uncovered.join(", ")}; planned by the fallback` });
    for (const d of fallbackDrafts(i, uncovered)) drafts.push({ ...d, deps: [] });
  }

  // Titles → draft indexes (every piece of a split task); edges that would close a cycle are dropped.
  const deps: number[][] = drafts.map(() => []);
  const cyclic = new Set<number>();
  drafts.forEach((d, j) => {
    for (const title of d.deps) {
      const k = titleIndex.get(title);
      if (k === undefined) { problems.push({ severity: "warning", message: `task "${d.title}" depends on unknown task "${title}"; dropped` }); continue; }
      if (pieces[k].includes(j)) continue; // a task naming itself (or a split task its own pieces)
      for (const x of pieces[k]) {
        if (deps[j].includes(x)) continue;
        if (reaches(deps, x, j)) { cyclic.add(j).add(x); continue; }
        deps[j].push(x);
      }
    }
  });
  if (cyclic.size) {
    const names = [...cyclic].sort((a, b) => a - b).map((j) => `"${drafts[j].title}"`);
    problems.push({ severity: "warning", message: `the planner's dependencies form a cycle among ${names.join(", ")}; the edges closing it were dropped` });
  }
  return { drafts: drafts.map(({ deps: _d, ...d }, j) => ({ ...d, dependsOn: deps[j] })), problems };
}

/** Whether `from` reaches `to` over index edges. */
function reaches(deps: number[][], from: number, to: number): boolean {
  const seen = new Set<number>();
  const stack = [from];
  while (stack.length) {
    const x = stack.pop()!;
    if (x === to) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    stack.push(...deps[x]);
  }
  return false;
}

// ------------------------------------------------------------------ assembly


/** Strongly connected components of an index graph (Tarjan), each sorted, in discovery order. */
function components(deps: number[][]): number[][] {
  let n = 0;
  const index = deps.map(() => -1), low = deps.map(() => 0), on = deps.map(() => false), stack: number[] = [], out: number[][] = [];
  const visit = (v: number) => {
    index[v] = low[v] = n++;
    stack.push(v); on[v] = true;
    for (const w of deps[v]) {
      if (index[w] < 0) { visit(w); low[v] = Math.min(low[v], low[w]); }
      else if (on[w]) low[v] = Math.min(low[v], index[w]);
    }
    if (low[v] === index[v]) {
      const c: number[] = [];
      let w: number;
      do { w = stack.pop()!; on[w] = false; c.push(w); } while (w !== v);
      out.push(c.sort((a, b) => a - b));
    }
  };
  deps.forEach((_, v) => { if (index[v] < 0) visit(v); });
  return out;
}

/** Create's derived dependencies between drafts, as index edges (task → the tasks whose writes it reads). */
const contractDeps = (m: SystemModel, drafts: TaskDraft[]): number[][] => contractDependencies(m, drafts.map((d) => expandNodes(m, d.nodes)));

/**
 * Drops planner dependencies that close a cycle with create's derived ones, then merges drafts that the derived
 * dependencies alone put on a cycle, when they share a binding (a cycle across bindings stays and is an `error`:
 * create would refuse it). Repeats until no same-binding cycle is left.
 */
function breakContractCycles(i: DraftInput, drafts: TaskDraft[], problems: DraftPlanProblem[]): TaskDraft[] {
  {
    // Planner dependencies that contradict the Genome's contract links (create derives those regardless) are dropped.
    const derived = contractDeps(i.model, drafts);
    const graph = derived.map((x) => [...x]);
    drafts.forEach((d, j) => {
      d.dependsOn = d.dependsOn.filter((x) => {
        if (graph[j].includes(x)) return true;
        if (reaches(graph, x, j)) {
          problems.push({ severity: "warning", message: `"${drafts[j].title}" depending on "${drafts[x].title}" contradicts the Genome's links; dropped` });
          return false;
        }
        graph[j].push(x);
        return true;
      });
    });
  }
  for (;;) {
    const derived = contractDeps(i.model, drafts);
    const all = drafts.map((d, j) => uniq([...d.dependsOn, ...derived[j]]));
    const cycles = components(all).filter((c) => c.length > 1);
    const mergeable = cycles.map((c) => {
      const byArtifact = new Map<string, number[]>();
      for (const j of c) byArtifact.set(drafts[j].artifactId, [...(byArtifact.get(drafts[j].artifactId) ?? []), j]);
      return [...byArtifact.values()].filter((g) => g.length > 1);
    }).flat();
    if (!mergeable.length) {
      for (const c of cycles) {
        problems.push({ severity: "error", message: `tasks ${c.map((j) => `"${drafts[j].title}"`).join(", ")} depend on each other across source bindings through Genome links; create will refuse this cycle until the scope changes` });
      }
      return drafts;
    }
    const into = new Map<number, number>();
    for (const g of mergeable) for (const j of g) into.set(j, g[0]);
    for (const g of mergeable) {
      problems.push({ severity: "warning", message: `tasks ${g.map((j) => `"${drafts[j].title}"`).join(", ")} depend on each other through Genome links; merged into one task` });
    }
    const keep = drafts.map((_, j) => (into.get(j) ?? j) === j);
    const renumber = new Map<number, number>();
    drafts.forEach((_, j) => { if (keep[j]) renumber.set(j, renumber.size); });
    const target = (j: number) => renumber.get(into.get(j) ?? j)!;
    const merged: TaskDraft[] = [];
    drafts.forEach((d, j) => {
      const t = target(j);
      const deps = d.dependsOn.map(target);
      if (!merged[t]) merged[t] = { ...d, nodes: [...d.nodes], checks: [...d.checks], dependsOn: deps };
      else {
        const x = merged[t];
        x.title = `${x.title} + ${d.title}`;
        x.intent = `${x.intent} ${d.intent}`.trim();
        x.nodes = uniq([...x.nodes, ...d.nodes]);
        x.checks = uniq([...x.checks, ...d.checks]);
        x.dependsOn = uniq([...x.dependsOn, ...deps]);
      }
    });
    merged.forEach((d, t) => { d.dependsOn = uniq(d.dependsOn).filter((x) => x !== t); });
    drafts = merged;
  }
}

/** Steps from a task's intent: its sentences, each within create's 200 characters, at most 20. */
export function stepsOf(intent: string, fallback: string): string[] {
  const sentences = intent.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const steps: string[] = [];
  for (const s of sentences) {
    for (let rest = s; rest.length; ) {
      if (rest.length <= MAX_TEXT) { steps.push(rest); break; }
      const cut = rest.lastIndexOf(" ", MAX_TEXT - 1);
      const at = cut > MAX_TEXT / 2 ? cut : MAX_TEXT - 1;
      steps.push(rest.slice(0, at).trimEnd());
      rest = rest.slice(at).trimStart();
    }
  }
  return (steps.length ? steps : [clip(fallback)]).slice(0, MAX_STEPS);
}

/**
 * Read scope: the one-hop link targets of the task's (expanded) write nodes outside its own write scope that either
 * map to source files of its binding or are written by another task. This filters non-contract links only: create
 * re-adds every contract-link target (`CONTRACT_RELS`) unfiltered, so an external reached by `reads` or `uses` still
 * marks the footprint unknown, and `taskDefinitions` does the same for the analysis.
 */
function readNodesOf(i: DraftInput, d: TaskDraft, otherWrites: Set<string>): string[] {
  const m = i.model;
  const writes = new Set(expandNodes(m, d.nodes));
  const tree = i.trees[d.artifactId] ?? [], repo = i.manifest.artifacts[d.artifactId]?.repo ?? "";
  return uniq([...writes].flatMap((n) => (m.index.linksOut[n] ?? []).map((l) => l.to)))
    .filter((id) => m.index.byId[id] && !writes.has(id))
    .filter((id) => otherWrites.has(id) || taskFootprint(m, [id], tree, d.artifactId, repo).writeKnown)
    .sort();
}


/** The plan title: the request's, else the Evolutions' titles, else a count of nodes. */
function planTitle(i: DraftInput): string {
  if (i.title?.trim()) return clip(i.title.trim());
  if (i.evolutions.length) return clip(`Implement ${i.evolutions.map((e) => e.title).join("; ")}`);
  return clip(`Implement ${i.nodes.length} Genome node${i.nodes.length === 1 ? "" : "s"}`);
}

/**
 * The draft from planner output: same-binding contract cycles merged, ids `t1…tn`, steps from intents, read nodes
 * from one-hop links, create's derived dependencies included, analysis over the definitions create would store.
 */
export function assembleDraft(i: DraftInput, input: TaskDraft[], problems: DraftPlanProblem[]): { request: CreateRealizationPlanRequest; analysis: TaskAnalysis; problems: DraftPlanProblem[] } {
  const m = i.model;
  const out = [...problems];
  const drafts = breakContractCycles(i, input.map((d) => ({ ...d, nodes: [...d.nodes], checks: uniq(d.checks), dependsOn: [...d.dependsOn] })), out);
  const ids = drafts.map((_, k) => `t${k + 1}`);
  const derived = contractDeps(m, drafts);
  const writes = drafts.map((d) => expandNodes(m, d.nodes));
  const tasks = drafts.map((d, k) => ({
    id: ids[k],
    title: clip(d.title.trim() || `Task ${k + 1}`),
    artifactId: d.artifactId,
    steps: stepsOf(d.intent, `Implement ${d.nodes.map((n) => nameOf(m, n)).join(", ")}`),
    dependsOn: uniq([...d.dependsOn, ...derived[k]]).filter((x) => x !== k).map((x) => ids[x]),
    readNodes: readNodesOf(i, d, new Set(writes.flatMap((w, j) => (j === k ? [] : w)))),
    writeNodes: d.nodes,
    checks: uniq(d.checks),
  }));
  if (tasks.length > MAX_TASKS) out.push({ severity: "error", message: `${tasks.length} tasks exceed create's limit of ${MAX_TASKS}; narrow the scope` });
  for (const t of tasks) {
    for (const key of ["writeNodes", "readNodes", "checks", "dependsOn"] as const) {
      if (t[key].length > MAX_LIST) out.push({ taskId: t.id, severity: "error", message: `${t[key].length} ${key} exceed create's limit of ${MAX_LIST}; split the task` });
    }
  }
  const request: CreateRealizationPlanRequest = { title: planTitle(i), genomeCommit: i.genomeCommit, tasks };
  let analysis: TaskAnalysis = { conflicts: [], waves: [] };
  if (tasks.length) {
    const defs = taskDefinitions(i.model, i.manifest, i.trees, tasks);
    for (const d of defs) {
      if (!d.footprint.globs.length) out.push({ taskId: d.id, severity: "missing", message: `unscoped: no source files of ${d.artifactId} are bound to ${d.writeNodes.slice(0, 5).join(", ")}${d.writeNodes.length > 5 ? ", …" : ""}` });
      else if (!d.footprint.known) out.push({ taskId: d.id, severity: "warning", message: "part of the scope maps to no source files; the task runs alone until it is mapped" });
    }
    try {
      analysis = analyzeTasks(defs);
    } catch (e) {
      out.push({ severity: "error", message: `the draft cannot be analysed: ${(e as Error).message}` });
    }
  }
  return { request, analysis, problems: out };
}

// ------------------------------------------------------------------ planning

/**
 * Removals join the task that already writes their ancestor (same binding), else one task per ancestor, whose intent
 * names each removed node and its old file globs.
 */
export function applyRemovals(i: DraftInput, drafts: TaskDraft[]): TaskDraft[] {
  const out = drafts.map((d) => ({ ...d }));
  const byAncestor = new Map<string, DraftRemoval[]>();
  for (const r of i.removals ?? []) byAncestor.set(`${r.artifactId}|${r.ancestor}`, [...(byAncestor.get(`${r.artifactId}|${r.ancestor}`) ?? []), r]);
  for (const rs of byAncestor.values()) {
    const { ancestor, artifactId } = rs[0];
    const text = rs.map((r) => `Delete the code for ${r.title} (${r.node})${r.globs.length ? ` under ${r.globs.join(", ")}` : ""}.`).join(" ");
    const home = out.find((d) => d.artifactId === artifactId && d.nodes.includes(ancestor));
    if (home) { home.intent = `${home.intent} ${text}`.trim(); continue; }
    out.push({
      title: `Remove ${rs.map((r) => r.title).join(", ")}`, intent: text, artifactId, nodes: [ancestor], dependsOn: [],
      checks: criteriaFor(i.model, i.criteria, [ancestor]), origin: "fallback",
    });
  }
  return out;
}

/**
 * Drafts with `planner`: a valid reply is validated and assembled; an off planner or a failed reply gives the fallback
 * partition (a failure is a warning). Never throws on planner output.
 */
export async function buildDraft(i: DraftInput, planner: Planner, scopeProblems: DraftPlanProblem[] = []): Promise<DraftRealizationPlanResponse> {
  const provenance = (provider: string, model: string, fallback: boolean) => ({
    planner: { provider, model }, genomeCommit: i.genomeCommit, evolutionIds: i.evolutions.map((e) => e.id), nodes: i.nodes, fake: planner.mode === "fake", fallback,
  });
  const fallback = (extra: DraftPlanProblem[]) => {
    const drafts = applyRemovals(i, fallbackDrafts(i, i.nodes));
    coverCriteria(i.model, i.criteria, drafts);
    return { ...assembleDraft(i, drafts, [...scopeProblems, ...extra]), provenance: provenance("fallback", "fallback", true) };
  };
  if (!i.nodes.length || planner.mode === "off") return fallback([]);
  // Removals never go to the model: their task is fixed by the ancestor that survives.
  const reply = await planner.plan(planContext(i));
  if (!reply.tasks) return fallback([{ severity: "warning", message: `${reply.error ?? `planner ${reply.provider} gave no tasks`}; planned by the fallback` }]);
  const { drafts: planned, problems } = validateReply(i, reply.tasks);
  const drafts = applyRemovals(i, planned);
  coverCriteria(i.model, i.criteria, drafts);
  const usedFallback = drafts.some((d) => d.origin === "fallback");
  return { ...assembleDraft(i, drafts, [...scopeProblems, ...problems]), provenance: provenance(reply.provider, reply.model, usedFallback) };
}

// ------------------------------------------------------------------ env: the route calls this

const DraftBody = z.object({
  title: z.string().trim().max(MAX_TEXT).optional(),
  evolutionIds: z.array(z.string().trim().min(1).max(MAX_TEXT)).max(100).optional(),
  nodes: z.array(z.string().trim().min(1).max(MAX_TEXT)).max(500).optional(),
  hint: z.string().max(2000).optional(),
}).strict();

const trees = new Map<string, string[]>();
const TREES_MAX = 8;

/** A binding's tree paths, memoised per `${repo}@${commit}`. */
async function treeOf(env: Env, b: { repo: string; commit: string }): Promise<string[]> {
  const key = `${b.repo}@${b.commit}`;
  let t = trees.get(key);
  if (!t) {
    t = [...(await withRepo(artifactsFor(env), b.repo, (r) => listTree(r, b.commit))).keys()];
    trees.set(key, t);
    if (trees.size > TREES_MAX) trees.delete(trees.keys().next().value!);
  }
  return t;
}

/** Genomes a seeded Evolution's acceptance is looked up in, oldest first. */
const MAX_SEED_LOOKUPS = 12;

/**
 * The history facts `draftScope` reads. An accepted Evolution with no accepting commit was seeded from Genome YAML: it
 * counts as accepted at the oldest System commit whose Genome carries it. An Evolution that names nodes the current
 * Genome lacks gets the Genome of the commit before its acceptance, to resolve the removals.
 */
async function scopeHistory(
  env: Env, state: { systemId: string; genomeCommit: string; genomeSource: string; genomeRepo: string },
  model: SystemModel, evolutions: Evolution[], history: SystemCommit[], plans: RealizationPlan[],
): Promise<ScopeHistory> {
  const loaded = new Map<string, SystemModel | null>([[state.genomeCommit, model]]);
  const at = async (commit: string) => {
    if (!loaded.has(commit)) {
      let m: SystemModel | null = null;
      for (const repo of uniq([state.genomeSource, state.genomeRepo])) {
        try { m = (await genomeAt(env, state.systemId, commit, repo)).model; break; } catch { /* try the next repo */ }
      }
      loaded.set(commit, m);
    }
    return loaded.get(commit)!;
  };
  const oldestFirst: [string, number][] = [];
  for (let k = history.length - 1; k >= 0; k--) if (!oldestFirst.some(([g]) => g === history[k].genomeCommit)) oldestFirst.push([history[k].genomeCommit, k]);
  const acceptedAt: Record<string, number> = {};
  const previous: Record<string, SystemModel | undefined> = {};
  for (const e of evolutions.filter(isAcceptedGenomeEvolution)) {
    let k = history.findIndex((c) => c.evolutions.includes(e.id));
    if (k < 0) {
      for (const [g, idx] of oldestFirst.slice(0, MAX_SEED_LOOKUPS)) {
        if ((await at(g))?.evolutions.some((x) => x.id === e.id)) { k = idx; break; }
      }
    }
    if (k < 0) continue;
    acceptedAt[e.id] = k;
    const removed = (e.affectedNodes ?? []).some((n) => !model.index.byId[n] && !model.criteria.some((c) => c.id === n));
    if (removed && history[k + 1]) previous[e.id] = (await at(history[k + 1].genomeCommit)) ?? undefined;
  }
  return { history, plans, acceptedAt, previous };
}

/**
 * `POST …/realization-plans/draft {title?, evolutionIds?, nodes?, hint?}` (admin): a draft over the current accepted
 * Genome and manifest. 400 for a malformed body, 404 without an accepted Genome; everything else is a problem.
 */
export async function draftRealizationPlan(env: Env, systemId: string, body: unknown): Promise<DraftRealizationPlanResponse> {
  const parsed = DraftBody.safeParse(body ?? {});
  if (!parsed.success) throw badRequest("invalid draft request", parsed.error.issues);
  const req = parsed.data;
  const stub = systemStub(env, systemId);
  const state = await stub.state();
  if (!state?.manifest) throw notFound(`system ${systemId} has no accepted Genome`);
  const [{ model }, evolutions, history, plans] = await Promise.all([
    genomeAt(env, systemId, state.genomeCommit, state.genomeSource), stub.evolutions(), stub.history(), stub.realizationPlans(),
  ]);
  const h = await scopeHistory(env, state, model, evolutions, history, plans);
  const tree: Record<string, string[]> = {};
  for (const [a, b] of Object.entries(state.manifest.artifacts)) tree[a] = await treeOf(env, b);
  const scope = draftScope(model, state.manifest, h, evolutions, req, tree);
  const hint = req.hint?.trim() || undefined;
  const input: DraftInput = {
    model, manifest: state.manifest, trees: tree, genomeCommit: state.genomeCommit,
    evolutions: scope.evolutions, nodes: scope.nodes, artifactOf: scope.artifactOf, criteria: scope.criteria, removals: scope.removals,
    ...(hint && { hint }), ...(req.title && { title: req.title }),
  };
  return buildDraft(input, isHostedDemo(env) ? demoPlanner() : plannerFromEnv(env), scope.problems);
}
