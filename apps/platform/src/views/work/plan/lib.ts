import type { Evolution, PlanUpdateRequest, Task, TaskConflict, TaskPlan, TaskStatus } from "../../../../shared/api";
import type { ChipConflict } from "../ConflictChips";

/** What a task card shows: the backend status, or `blocked` for a planned task whose dependencies are not promoted. */
export type TaskDisplayStatus = TaskStatus | "blocked";

/** Glyph per shown status: a filling circle from planned to promoted; blocked is a stop sign. */
export const TASK_GLYPH: Record<TaskDisplayStatus, string> = {
  planned: "○", claimed: "◔", realizing: "◑", evaluated: "◕", promoted: "●", blocked: "⊘", rejected: "×", abandoned: "–",
};

/** States in which an Evolution can be planned into Tasks. */
const PLANNABLE = new Set<Evolution["state"]>(["genome-approved", "actionable", "realizing"]);
/** States in which a wave can start (as Start work: the Evolution must be actionable). */
const STARTABLE = new Set<Evolution["state"]>(["actionable", "realizing"]);
/** Done or out of the way: an earlier wave counts as finished when each of its tasks is one of these. */
const SETTLED = new Set<TaskStatus>(["promoted", "rejected", "abandoned"]);

export const FIXTURE_REASON = "Planning needs the platform API. The UI is showing fixture data.";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const quote = (s: string) => `“${s}”`;

/** "4 tasks · 2 waves". */
export const planCounts = (plan: Pick<TaskPlan, "tasks" | "waves">) => `${plural(plan.tasks.length, "task")} · ${plural(plan.waves.length, "wave")}`;

export const taskById = (plan: Pick<TaskPlan, "tasks">) => new Map(plan.tasks.map((t) => [t.id, t]));

export const titleOf = (plan: Pick<TaskPlan, "tasks">, id: string) => plan.tasks.find((t) => t.id === id)?.title ?? id;

/** 1-based wave of a task, or null when it is in none. */
export function waveOf(plan: Pick<TaskPlan, "waves">, taskId: string): number | null {
  const i = plan.waves.findIndex((w) => w.includes(taskId));
  return i < 0 ? null : i + 1;
}

/** Dependencies of `task` that are not promoted yet. */
export function blockedOn(task: Task, plan: Pick<TaskPlan, "tasks">): string[] {
  const by = taskById(plan);
  return task.dependsOn.filter((d) => by.get(d)?.status !== "promoted");
}

/** `blocked` only for a planned task still waiting on a dependency; otherwise the backend status. */
export function displayStatus(task: Task, plan: Pick<TaskPlan, "tasks">): TaskDisplayStatus {
  return task.status === "planned" && blockedOn(task, plan).length ? "blocked" : task.status;
}

/**
 * Why a task sits in its wave, in plain words. Wave 1: nothing it waits on. Later waves: the dependencies and the file or
 * semantic overlaps with tasks of earlier waves that push it back.
 */
export function whyWave(plan: Pick<TaskPlan, "tasks" | "waves" | "conflicts">, taskId: string): string {
  const n = waveOf(plan, taskId);
  if (n === null) return "This task is in no wave yet.";
  const task = plan.tasks.find((t) => t.id === taskId);
  if (n === 1) {
    const peers = (plan.waves[0] ?? []).filter((id) => id !== taskId).map((id) => quote(titleOf(plan, id)));
    return `Wave 1: it depends on no other task${peers.length ? ` and shares no files with ${peers.join(", ")}` : ""}.`;
  }
  const earlier = (id: string) => {
    const w = waveOf(plan, id);
    return w !== null && w < n;
  };
  const reasons: string[] = [];
  for (const d of task?.dependsOn ?? []) if (earlier(d)) reasons.push(`it depends on ${quote(titleOf(plan, d))} (wave ${waveOf(plan, d)})`);
  for (const c of plan.conflicts) {
    if (c.kind === "declared" || !c.tasks.includes(taskId)) continue;
    const other = c.tasks[0] === taskId ? c.tasks[1] : c.tasks[0];
    if (!earlier(other)) continue;
    const on = c.subjects.length ? ` ${c.subjects.slice(0, 3).join(", ")}${c.subjects.length > 3 ? ` and ${c.subjects.length - 3} more` : ""}` : "";
    reasons.push(c.kind === "file" ? `it edits${on || " files"} also in ${quote(titleOf(plan, other))} (wave ${waveOf(plan, other)})` : `it overlaps ${quote(titleOf(plan, other))} (wave ${waveOf(plan, other)}, ${c.kind})${on ? ` on${on}` : ""}`);
  }
  return reasons.length ? `Wave ${n} because ${reasons.join("; ")}.` : `Wave ${n}: placed after wave ${n - 1} by the planner.`;
}

/** Why wave `n` (1-based) cannot start, or null when it can. */
export function canStartWave(plan: Pick<TaskPlan, "tasks" | "waves">, n: number, ctx: { fixture: boolean; evolution: Pick<Evolution, "id" | "state"> }): string | null {
  if (ctx.fixture) return FIXTURE_REASON;
  if (!STARTABLE.has(ctx.evolution.state)) return `${ctx.evolution.id} is ${ctx.evolution.state}; it must be actionable before a wave starts.`;
  const by = taskById(plan);
  const wave = (plan.waves[n - 1] ?? []).map((id) => by.get(id)).filter((t): t is Task => !!t);
  if (!wave.some((t) => t.status === "planned")) return `Every task in wave ${n} has started; none is planned.`;
  for (let i = 0; i < n - 1; i++) {
    const open = (plan.waves[i] ?? []).map((id) => by.get(id)).filter((t): t is Task => !!t && !SETTLED.has(t.status));
    if (open.length) return `Wave ${i + 1} is not promoted yet: ${open.map((t) => `${quote(t.title)} is ${t.status}`).join(", ")}.`;
  }
  return null;
}

/** Why the Evolution cannot be planned now, or null. */
export function canPlan(ctx: { fixture: boolean; evolution: Pick<Evolution, "id" | "state"> }): string | null {
  if (ctx.fixture) return FIXTURE_REASON;
  if (!PLANNABLE.has(ctx.evolution.state)) return `${ctx.evolution.id} is ${ctx.evolution.state}; it must be approved before it is planned.`;
  return null;
}

/** Why the plan cannot be edited (rename, merge, split), or null. */
export const canEdit = (ctx: { fixture: boolean }) => (ctx.fixture ? FIXTURE_REASON : null);

const uniq = <T,>(xs: Iterable<T>) => [...new Set(xs)];

/** Why `ids` cannot be merged, or null. */
export function canMerge(tasks: readonly Task[], ids: readonly string[]): string | null {
  if (ids.length < 2) return "Select two or more tasks to merge.";
  const picked = tasks.filter((t) => ids.includes(t.id));
  const started = picked.filter((t) => t.status !== "planned");
  if (started.length) return `Only planned tasks merge: ${started.map((t) => `${quote(t.title)} is ${t.status}`).join(", ")}.`;
  return null;
}

/**
 * Merges `ids` into the first of them (in plan order): titles joined, nodes, criteria and dependencies united, edges to any
 * merged task pointed at the survivor. The footprint is left for the server to recompute. Returns the whole new list.
 */
export function mergeTasks(tasks: readonly Task[], ids: readonly string[]): Task[] {
  const picked = tasks.filter((t) => ids.includes(t.id));
  if (picked.length < 2) return [...tasks];
  const [keep] = picked as [Task, ...Task[]];
  const gone = new Set(picked.map((t) => t.id));
  const things = uniq(picked.map((t) => t.thing));
  const merged: Task = {
    ...keep,
    title: picked.map((t) => t.title).join(" + "),
    intent: picked.map((t) => t.intent).join("\n\n"),
    thing: things.length === 1 ? things[0]! : null,
    nodes: uniq(picked.flatMap((t) => t.nodes)),
    acceptanceCriteria: uniq(picked.flatMap((t) => t.acceptanceCriteria)),
    dependsOn: uniq(picked.flatMap((t) => t.dependsOn)).filter((d) => !gone.has(d)),
    status: "planned",
    origin: "user",
  };
  const repoint = (deps: readonly string[]) => uniq(deps.map((d) => (gone.has(d) ? keep.id : d)));
  return tasks.flatMap((t) => (t.id === keep.id ? [merged] : gone.has(t.id) ? [] : [{ ...t, dependsOn: repoint(t.dependsOn) }]));
}

/** A task id not in `tasks`: `<id>-2`, `<id>-3`, … */
export function freshTaskId(tasks: readonly Task[], base: string): string {
  const ids = new Set(tasks.map((t) => t.id));
  for (let i = 2; ; i++) if (!ids.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Why `task` cannot be split by moving `nodes` out, or null. */
export function canSplit(task: Task, nodes: readonly string[]): string | null {
  if (task.status !== "planned") return `Only planned tasks split; ${quote(task.title)} is ${task.status}.`;
  if (task.nodes.length < 2) return "A task with one node cannot be split.";
  if (!nodes.length) return "Pick the nodes that move to the new task.";
  if (nodes.length >= task.nodes.length) return "Leave at least one node in this task.";
  return null;
}

/**
 * Moves `nodes` of `taskId` into a new task right after it, with the same criteria and dependencies. Tasks that depended
 * on the original depend on both halves. Footprints are left for the server. Returns the whole new list.
 */
export function splitTask(tasks: readonly Task[], taskId: string, nodes: readonly string[], title?: string): Task[] {
  const t = tasks.find((x) => x.id === taskId);
  if (!t || canSplit(t, nodes)) return [...tasks];
  const moving = new Set(nodes);
  const id = freshTaskId(tasks, taskId);
  const rest: Task = { ...t, nodes: t.nodes.filter((n) => !moving.has(n)), origin: "user" };
  const part: Task = { ...t, id, title: title?.trim() || `${t.title} (split)`, nodes: t.nodes.filter((n) => moving.has(n)), origin: "user", status: "planned" };
  delete part.realizationId;
  delete part.claim;
  return tasks.flatMap((x) => {
    if (x.id === taskId) return [rest, part];
    return [x.dependsOn.includes(taskId) ? { ...x, dependsOn: uniq([...x.dependsOn, id]) } : x];
  });
}

/** The list sent to `PUT …/plan`: footprints dropped so the server recomputes them for every task. */
export const planUpdate = (tasks: readonly Task[]): PlanUpdateRequest => ({
  tasks: tasks.map(({ footprint: _f, ...rest }) => rest),
});

/** Task conflicts of `taskId` as ConflictChips rows, naming the other task. */
export function conflictReports(conflicts: readonly TaskConflict[], taskId: string, title: (id: string) => string): ChipConflict[] {
  return conflicts
    .filter((c) => c.tasks.includes(taskId))
    .map((c) => {
      const other = c.tasks[0] === taskId ? c.tasks[1] : c.tasks[0];
      const paths = c.kind === "file" ? c.subjects : [];
      return { kind: c.kind, candidates: [title(other)], subjects: c.kind === "file" ? [] : c.subjects, paths, message: c.message, with: title(other) };
    });
}

/** "6 files · 2 entry". */
export const footprintLine = (t: Task) => `${plural(t.footprint.paths.length, "file")} · ${t.footprint.entryFiles.length} entry`;

/** Plain wording for the auth refusals and the plan's own error codes; anything else keeps the server's message. */
export function planError(action: string, err: Error): string {
  const status = (err as { status?: number }).status;
  const code = (err as { code?: string }).code;
  if (status === 401) return `${action} needs the admin token (401). Set the admin token in the header and try again.`;
  if (status === 403) return `The admin token was refused (403). Check it in the header and try again.`;
  if (code === "wave-blocked") return `${err.message} An earlier wave must be promoted first.`;
  if (code === "plan-in-progress") return `${err.message} Tasks have started, so the plan cannot be replaced.`;
  return err.message;
}
