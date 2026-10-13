/**
 * Task independence: pairwise conflicts and parallel waves for a task plan. Pure and deterministic (tasks are sorted by
 * id before every pass); only `annotateInterference` calls System One, and only on soft-semantic pairs, as advice.
 *
 * Per pair, most severe wins (mirrors hooks/overlap.ts for candidates):
 * - `declared`: one task depends on the other.
 * - `file`: footprint paths intersect (platform-written paths excluded), or an unmatched glob "may create" files in
 *   the other's directory (literal prefixes nested).
 * - `soft-semantic`: shared nodes or criteria by `overlap()`; sharing only journeys is not a conflict.
 */
import { overlap, type SemanticDelta, type SystemModel } from "@artyfact/model";
import { interference, type SystemOne } from "@artyfact/semantic";
import picomatch from "picomatch";
import type { Task, TaskConflict } from "../../shared/api";
import { PLATFORM_WRITTEN } from "../hooks/diff-scope";

export class PlanError extends Error {
  constructor(public code: "plan-cycle", public ids: string[]) {
    super(`${code}: ${ids.join(", ")}`);
    this.name = "PlanError";
  }
}

const isPlatformWritten = picomatch(PLATFORM_WRITTEN, { dot: true });
const uniq = (xs: Iterable<string>) => [...new Set(xs)].sort();
const byId = (tasks: Task[]) => [...tasks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** A task's model footprint as a delta: every node changed, no field detail (as hooks/overlap.ts for app candidates). */
export function syntheticDelta(nodes: string[]): SemanticDelta {
  return { added: [], removed: [], changed: uniq(nodes).map((id) => ({ id, fields: [] })), affectedCriteria: [], affectedJourneys: [] };
}

const WILDCARD = /[*?[\]{}()!+@]/;
/** Literal part of a glob as a directory (`src/ui/people/**` → `src/ui/people/`); a glob without wildcards is itself. */
export function literalPrefix(glob: string): string {
  const i = glob.search(WILDCARD);
  if (i < 0) return glob;
  const head = glob.slice(0, i);
  return head.slice(0, head.lastIndexOf("/") + 1);
}

function mayCreate(a: Task, b: Task): string[] {
  const unA = new Set(a.footprint.unmatched), unB = new Set(b.footprint.unmatched);
  const out: string[] = [];
  for (const ga of a.footprint.globs) {
    for (const gb of b.footprint.globs) {
      if (!unA.has(ga) && !unB.has(gb)) continue;
      const pa = literalPrefix(ga), pb = literalPrefix(gb);
      if ([ga, gb, pa, pb].some((x) => x && isPlatformWritten(x.replace(/\/$/, "")))) continue;
      if (pa.startsWith(pb) || pb.startsWith(pa)) out.push(ga, gb);
    }
  }
  return uniq(out);
}

function pair(a: Task, b: Task, m: SystemModel): TaskConflict | null {
  const tasks: [string, string] = [a.id, b.id];
  const aOnB = a.dependsOn.includes(b.id), bOnA = b.dependsOn.includes(a.id);
  if (aOnB || bOnA) {
    const msg = [aOnB && `${a.id} depends on ${b.id}`, bOnA && `${b.id} depends on ${a.id}`].filter(Boolean).join("; ");
    return { kind: "declared", tasks, subjects: [], message: `${msg}.` };
  }
  const inB = new Set(b.footprint.paths);
  const paths = uniq(a.footprint.paths.filter((p) => inB.has(p) && !isPlatformWritten(p)));
  if (paths.length) return { kind: "file", tasks, subjects: paths, message: `Both tasks change ${paths.join(", ")}.` };
  const globs = mayCreate(a, b);
  if (globs.length) return { kind: "file", tasks, subjects: globs, message: `Both tasks may create files under ${globs.join(", ")}.` };
  const o = overlap(syntheticDelta(a.nodes), syntheticDelta(b.nodes), m);
  if (o.shared.length || o.viaCriteria.length) {
    const what = [o.shared.length && `nodes ${o.shared.join(", ")}`, o.viaCriteria.length && `criteria ${o.viaCriteria.join(", ")}`].filter(Boolean).join(" and ");
    return { kind: "soft-semantic", tasks, subjects: uniq([...o.shared, ...o.viaCriteria]), message: `Different files, but both touch ${what}.` };
  }
  return null;
}

/** One report per conflicting pair, `tasks` in id order; pairs are listed in id order too. */
export function taskConflicts(tasks: Task[], m: SystemModel): TaskConflict[] {
  const ts = byId(tasks);
  const out: TaskConflict[] = [];
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
    const c = pair(ts[i], ts[j], m);
    if (c) out.push(c);
  }
  return out;
}

const DEPENDENCY_RELS = new Set(["invokes", "calls", "reads", "uses", "stepOperation"]);

/** A depends on B when a node of A links (`invokes|calls|reads|uses|stepOperation`) to a node of B. Every task has an entry. */
export function derivedDependencies(tasks: Task[], m: SystemModel): Record<string, string[]> {
  const ts = byId(tasks);
  const owners = new Map<string, string[]>();
  for (const t of ts) for (const n of t.nodes) owners.set(n, [...(owners.get(n) ?? []), t.id]);
  const out: Record<string, string[]> = {};
  for (const t of ts) {
    const deps = t.nodes.flatMap((n) => (m.index.linksOut[n] ?? []).filter((l) => DEPENDENCY_RELS.has(l.rel)).flatMap((l) => owners.get(l.to) ?? []));
    out[t.id] = uniq(deps.filter((d) => d !== t.id));
  }
  return out;
}

/**
 * Waves of tasks that may run in parallel. Kahn over `dependsOn` gives each task its floor (one past its latest
 * dependency); greedily, a task joins the lowest wave ≥ its floor holding no task it has a `file` conflict with.
 * Soft-semantic conflicts never split. Dependencies on tasks outside `tasks` are ignored. A cycle throws `plan-cycle`.
 */
export function waves(tasks: Task[], conflicts: TaskConflict[]): string[][] {
  const ts = byId(tasks);
  const ids = new Set(ts.map((t) => t.id));
  const deps = new Map(ts.map((t) => [t.id, uniq(t.dependsOn.filter((d) => ids.has(d) && d !== t.id))]));
  const dependents = new Map<string, string[]>(ts.map((t) => [t.id, []]));
  for (const [id, ds] of deps) for (const d of ds) dependents.get(d)!.push(id);
  const indegree = new Map(ts.map((t) => [t.id, deps.get(t.id)!.length]));

  // Level-by-level Kahn, ids sorted within a level: a deterministic topological order.
  const order: string[] = [];
  let ready = ts.filter((t) => indegree.get(t.id) === 0).map((t) => t.id);
  while (ready.length) {
    order.push(...ready);
    const next: string[] = [];
    for (const id of ready) for (const d of dependents.get(id)!) {
      indegree.set(d, indegree.get(d)! - 1);
      if (indegree.get(d) === 0) next.push(d);
    }
    ready = uniq(next);
  }
  if (order.length < ts.length) throw new PlanError("plan-cycle", ts.map((t) => t.id).filter((id) => indegree.get(id)! > 0));

  const fileConflicts = new Map<string, Set<string>>(ts.map((t) => [t.id, new Set()]));
  for (const c of conflicts) {
    if (c.kind !== "file") continue;
    const [a, b] = c.tasks;
    fileConflicts.get(a)?.add(b);
    fileConflicts.get(b)?.add(a);
  }
  const waveOf = new Map<string, number>();
  const out: string[][] = [];
  for (const id of order) {
    let w = Math.max(0, ...deps.get(id)!.map((d) => waveOf.get(d)! + 1));
    while (out[w]?.some((o) => fileConflicts.get(id)!.has(o))) w++;
    (out[w] ??= []).push(id);
    waveOf.set(id, w);
  }
  return out.filter(Boolean).map((w) => uniq(w));
}

/** Advisory System One `interference` on soft-semantic pairs only; other kinds are returned unchanged. */
export async function annotateInterference(conflicts: TaskConflict[], tasks: Task[], m: SystemModel, s1: SystemOne): Promise<TaskConflict[]> {
  const byTask = new Map(tasks.map((t) => [t.id, t]));
  return Promise.all(conflicts.map(async (c) => {
    const a = byTask.get(c.tasks[0]), b = byTask.get(c.tasks[1]);
    if (c.kind !== "soft-semantic" || !a || !b) return c;
    const o = overlap(syntheticDelta(a.nodes), syntheticDelta(b.nodes), m);
    const semantic = await interference(
      s1,
      { evolution: a.evolutionId, changedSubjects: uniq(a.nodes), summary: `task ${a.id}: ${a.title}` },
      { evolution: b.evolutionId, changedSubjects: uniq(b.nodes), summary: `task ${b.id}: ${b.title}` },
      o,
      { journeys: o.viaJourneys, criteria: o.viaCriteria },
    );
    return { ...c, semantic };
  }));
}
