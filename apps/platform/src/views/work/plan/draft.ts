import type { CreateRealizationPlanRequest } from "../../../../shared/lifecycle";
import { quote } from "./lib";

/**
 * Draft edits: main has no plan PUT, so rename, merge, split and remove change the draft's task list before it is posted
 * to create. Each returns a new list; the server recomputes footprints, derived dependencies and waves on create.
 */
export type DraftTask = CreateRealizationPlanRequest["tasks"][number];

const uniq = <T,>(xs: Iterable<T>) => [...new Set(xs)];

export function renameTask(tasks: readonly DraftTask[], id: string, title: string): DraftTask[] {
  return tasks.map((t) => (t.id === id ? { ...t, title } : t));
}

/** Why `ids` cannot merge, or null. A task binds one artifact, so only tasks on the same binding merge. */
export function canMerge(tasks: readonly DraftTask[], ids: readonly string[]): string | null {
  const picked = tasks.filter((t) => ids.includes(t.id));
  if (picked.length < 2) return "Select two or more tasks to merge.";
  const bindings = uniq(picked.map((t) => t.artifactId));
  if (bindings.length > 1) return `Only tasks on one binding merge; these are on ${bindings.join(", ")}.`;
  return null;
}

/**
 * Merges `ids` into the first of them in list order: titles joined, steps in order, nodes, checks and dependencies
 * united, a node both read and written stays written, and edges to a merged task point at the survivor.
 */
export function mergeTasks(tasks: readonly DraftTask[], ids: readonly string[]): DraftTask[] {
  if (canMerge(tasks, ids)) return [...tasks];
  const picked = tasks.filter((t) => ids.includes(t.id));
  const [keep] = picked as [DraftTask, ...DraftTask[]];
  const gone = new Set(picked.map((t) => t.id));
  const writeNodes = uniq(picked.flatMap((t) => t.writeNodes));
  const merged: DraftTask = {
    ...keep,
    title: picked.map((t) => t.title).join(" + "),
    steps: picked.flatMap((t) => t.steps),
    writeNodes,
    readNodes: uniq(picked.flatMap((t) => t.readNodes)).filter((n) => !writeNodes.includes(n)),
    checks: uniq(picked.flatMap((t) => t.checks)),
    dependsOn: uniq(picked.flatMap((t) => t.dependsOn)).filter((d) => !gone.has(d)),
  };
  const repoint = (deps: readonly string[]) => uniq(deps.map((d) => (gone.has(d) ? keep.id : d)));
  return tasks.flatMap((t) => (t.id === keep.id ? [merged] : gone.has(t.id) ? [] : [{ ...t, dependsOn: repoint(t.dependsOn) }]));
}

/** A task id not in `tasks`: `<id>-2`, `<id>-3`, … */
export function freshTaskId(tasks: readonly DraftTask[], base: string): string {
  const ids = new Set(tasks.map((t) => t.id));
  for (let i = 2; ; i++) if (!ids.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Why `task` cannot be split by moving `nodes` (write nodes) out, or null. */
export function canSplit(task: DraftTask, nodes: readonly string[]): string | null {
  if (task.writeNodes.length < 2) return "A task that writes one node cannot be split.";
  if (!nodes.length) return "Pick the write nodes that move to the new task.";
  if (nodes.length >= task.writeNodes.length) return "Leave at least one write node in this task.";
  return null;
}

/**
 * Moves write `nodes` of `taskId` into a new task right after it, with the same binding, steps, reads, checks and
 * dependencies. Tasks that depended on the original depend on both halves.
 */
export function splitTask(tasks: readonly DraftTask[], taskId: string, nodes: readonly string[], title?: string): DraftTask[] {
  const t = tasks.find((x) => x.id === taskId);
  if (!t || canSplit(t, nodes)) return [...tasks];
  const moving = new Set(nodes);
  const id = freshTaskId(tasks, taskId);
  const rest: DraftTask = { ...t, writeNodes: t.writeNodes.filter((n) => !moving.has(n)) };
  const part: DraftTask = { ...t, id, title: title?.trim() || `${t.title} (split)`, writeNodes: t.writeNodes.filter((n) => moving.has(n)) };
  return tasks.flatMap((x) => (x.id === taskId ? [rest, part] : [x.dependsOn.includes(taskId) ? { ...x, dependsOn: uniq([...x.dependsOn, id]) } : x]));
}

/** Why `id` cannot be removed, or null: a plan keeps at least one task. */
export const canRemove = (tasks: readonly DraftTask[]) => (tasks.length < 2 ? "A plan keeps at least one task." : null);

/** Drops the task; tasks that depended on it lose that dependency. */
export function removeTask(tasks: readonly DraftTask[], id: string): DraftTask[] {
  if (canRemove(tasks)) return [...tasks];
  return tasks.filter((t) => t.id !== id).map((t) => (t.dependsOn.includes(id) ? { ...t, dependsOn: t.dependsOn.filter((d) => d !== id) } : t));
}

/**
 * What create would refuse (400) in the edited list, found before posting: duplicate ids, unknown dependencies, cycles,
 * a task with no write node or no title. Empty when the list is fine.
 */
export function draftErrors(tasks: readonly DraftTask[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const t of tasks) {
    if (ids.has(t.id)) errors.push(`Two tasks have the id ${t.id}.`);
    ids.add(t.id);
    if (!t.title.trim()) errors.push(`Task ${t.id} needs a title.`);
    if (!t.writeNodes.length) errors.push(`${quote(t.title || t.id)} writes no node.`);
  }
  for (const t of tasks) for (const d of t.dependsOn) if (!ids.has(d)) errors.push(`${quote(t.title)} depends on an unknown task ${d}.`);
  const by = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) return true;
    state.set(id, 1);
    const cyc = (by.get(id)?.dependsOn ?? []).some((d) => by.has(d) && visit(d));
    state.set(id, 2);
    return cyc;
  };
  if (tasks.some((t) => visit(t.id))) errors.push("The dependencies form a cycle.");
  return errors;
}
