import type { RealizationPlan, Task, TaskConflict } from "../../../../shared/lifecycle";

/** What a task card shows: the backend status, or `blocked` for a pending task whose dependencies are not selected yet. */
export type TaskDisplayStatus = Task["status"] | "blocked";

/** Glyph per shown status: a filling circle from pending to completed; blocked is a stop sign. */
export const TASK_GLYPH: Record<TaskDisplayStatus, string> = {
  pending: "○", claimed: "◔", working: "◑", submitted: "◕", selected: "◉", completed: "●", blocked: "⊘",
};

export const FIXTURE_REASON = "Realization plans need the platform API. The UI is showing fixture data.";
export const TOKEN_REASON = "Set the admin token in the header to change plans.";

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const quote = (s: string) => `“${s}”`;

type Plan = Pick<RealizationPlan, "tasks" | "analysis">;

/** "3 tasks · 2 waves". */
export const planCountsLine = (plan: Plan) => `${plural(plan.tasks.length, "task")} · ${plural(plan.analysis.waves.length, "wave")}`;

export const taskById = (plan: Pick<RealizationPlan, "tasks">) => new Map(plan.tasks.map((t) => [t.id, t]));
export const titleOf = (plan: Pick<RealizationPlan, "tasks">, id: string) => plan.tasks.find((t) => t.id === id)?.title ?? id;

/** 1-based wave of a task in `analysis.waves`, or null when it is in none. */
export function waveOf(plan: Pick<RealizationPlan, "analysis">, taskId: string): number | null {
  const i = plan.analysis.waves.findIndex((w) => w.includes(taskId));
  return i < 0 ? null : i + 1;
}

/** Dependencies of `task` with no selected candidate yet: claim refuses the task until each is selected. */
export function blockedOn(task: Task, plan: Pick<RealizationPlan, "tasks">): string[] {
  const by = taskById(plan);
  return task.dependsOn.filter((d) => !by.get(d)?.selectedCandidate);
}

export function displayStatus(task: Task, plan: Pick<RealizationPlan, "tasks">): TaskDisplayStatus {
  return task.status === "pending" && blockedOn(task, plan).length ? "blocked" : task.status;
}

/** The task's latest attempt when it has not ended and its lease has not lapsed. */
export function liveAttempt(t: Task | undefined, now: number) {
  const last = t?.attempts.at(-1);
  return last && last.status !== "ended" && Date.parse(last.leaseExpiresAt) > now ? last : undefined;
}

/** Tasks that conflict with `taskId` and hold a live attempt: claim refuses `taskId` while any does. */
export function liveConflicts(plan: Plan, taskId: string, now: number): Task[] {
  const by = taskById(plan);
  return plan.analysis.conflicts
    .filter((c) => c.tasks.includes(taskId))
    .map((c) => by.get(c.tasks[0] === taskId ? c.tasks[1] : c.tasks[0]))
    .filter((t): t is Task => !!t && !!liveAttempt(t, now));
}

/**
 * One shell word for a server-supplied value in a copied command: unchanged when it is plainly safe, otherwise POSIX
 * single-quoted (`'` becomes `'\''`), so ids with `;`, `$(…)`, backticks, quotes or newlines cannot run anything.
 */
export function shellArg(s: string): string {
  return /^[A-Za-z0-9._:@\/-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}

/** The agent prompt line from the CLI README; the admin token never reaches the agent. */
export const AGENT_PROMPT = "Follow AGENTS.md and TASK_PACKET.md, then run npx artyfact task submit";

/** The CLI's id rule (`assertId` in packages/cli/src/git.ts): anything else is refused or read as an option. */
export const cliId = (s: string) => /^[A-Za-z0-9._-]+$/.test(s) && !s.startsWith("-") && s !== "." && s !== "..";
export const CLI_ID_REASON = "This id cannot be used on the command line; rename the task or plan.";
/** Two task ids that differ only in case share one `./work/<task>` directory on a case-insensitive file system (macOS). */
export const caseTwinReason = (other: string) => `Task ${other} differs from this id only in case, so both would claim into one ./work directory on macOS; rename one.`;

/** One task's commands: `claim` runs in the person's shell; `agent` is a subshell, so it never moves the shell's directory. */
export interface TaskLines { claim: string; agent: string }

/**
 * The CLI README pair for `task`: claim (or resume) into `./work/<task>`, which stores the fork token in the workspace,
 * then the agent inside it in a subshell. No credential and no `--json` handoff; every value is quoted.
 */
export function taskLines(verb: "claim" | "resume", plan: Pick<RealizationPlan, "id" | "systemId">, taskId: string): TaskLines {
  const dir = shellArg(`./work/${taskId}`);
  return {
    claim: `npx artyfact task ${verb} ${shellArg(plan.id)} ${shellArg(taskId)} --system ${shellArg(plan.systemId)} --dir ${dir}`,
    agent: `( cd ${dir} && env -u ARTYFACT_ADMIN_TOKEN claude -p ${shellArg(AGENT_PROMPT)} )`,
  };
}

/** The two lines shown and copied for one task. */
export const commandLines = (verb: "claim" | "resume", plan: Pick<RealizationPlan, "id" | "systemId">, taskId: string) => {
  const l = taskLines(verb, plan, taskId);
  return `${l.claim}\n${l.agent}`;
};

/**
 * "Copy all" for a wave: each claim runs in turn from the shell's own directory and, only when it succeeds, starts its
 * agent subshell in the background (`claim && { agent & }`); one `wait` ends it. The wave's agents run side by side, a
 * failed claim never starts its agent, and the shell never changes directory.
 */
export const waveScript = (tasks: readonly TaskLines[]) =>
  [...tasks.map((t) => `${t.claim} && { ${t.agent} & }`), "wait"].join("\n");

/**
 * What an agent runs for `task`, by the claim rules of the lifecycle store (the same rules as `planCounts.awaitingAgent`):
 * `claim` for a pending task whose dependencies are selected, `resume` for a claimed or working task whose lease lapsed,
 * and no command while a conflicting task holds a live attempt or an id fails the CLI's id rule. No line carries a credential.
 */
export type TaskCommand = { verb: "claim" | "resume"; line: string; lines: TaskLines } | { verb: null; reason: string };

export function taskCommand(plan: Plan & Pick<RealizationPlan, "id" | "systemId">, task: Task, now: number): TaskCommand {
  const waits = blockedOn(task, plan);
  const live = liveAttempt(task, now);
  let verb: "claim" | "resume" | null = null;
  let reason = "";
  if (task.status === "pending") {
    if (waits.length) reason = `Waits until ${waits.map((d) => quote(titleOf(plan, d))).join(", ")} ${waits.length === 1 ? "is" : "are"} selected.`;
    else verb = "claim";
  } else if (task.status === "claimed" || task.status === "working") {
    if (live) reason = `${live.agentLabel} holds it until ${live.leaseExpiresAt}.`;
    else verb = "resume";
  } else if (task.status === "submitted") reason = "Submitted; select a candidate.";
  else reason = task.status === "selected" ? "Selected; ready to integrate." : "Completed.";
  if (verb) {
    const busy = liveConflicts(plan, task.id, now);
    if (busy.length) return { verb: null, reason: `Waits while ${busy.map((t) => quote(t.title)).join(", ")} ${busy.length === 1 ? "is" : "are"} being worked; they conflict.` };
    if (![plan.id, plan.systemId, task.id].every(cliId)) return { verb: null, reason: CLI_ID_REASON };
    const twin = plan.tasks.find((t) => t.id !== task.id && t.id.toLowerCase() === task.id.toLowerCase());
    if (twin) return { verb: null, reason: caseTwinReason(twin.id) };
    const lines = taskLines(verb, plan, task.id);
    return { verb, line: `${lines.claim}\n${lines.agent}`, lines };
  }
  return { verb: null, reason };
}

/** Task conflicts of `taskId`, naming the other task. */
export interface TaskConflictRow { kind: TaskConflict["kind"]; with: string; subjects: string[]; message: string }
export function conflictsOf(plan: Plan, taskId: string): TaskConflictRow[] {
  return plan.analysis.conflicts
    .filter((c) => c.tasks.includes(taskId))
    .map((c) => ({ kind: c.kind, with: titleOf(plan, c.tasks[0] === taskId ? c.tasks[1] : c.tasks[0]), subjects: c.subjects, message: c.message }));
}

const KIND_WORDS: Record<TaskConflict["kind"], string> = {
  dependency: "it depends on",
  source: "it edits files also in",
  ontology: "it shares Genome nodes with",
  unknown: "its scope is unknown, so it waits for",
};

/** Why a task sits in its wave, in plain words: its dependencies and conflicts with tasks of earlier waves. */
export function whyWave(plan: Plan, taskId: string): string {
  const n = waveOf(plan, taskId);
  if (n === null) return "This task is in no wave.";
  if (n === 1) {
    const peers = (plan.analysis.waves[0] ?? []).filter((id) => id !== taskId).map((id) => quote(titleOf(plan, id)));
    return `Wave 1: it waits on no other task${peers.length ? ` and does not conflict with ${peers.join(", ")}` : ""}.`;
  }
  const reasons: string[] = [];
  for (const c of plan.analysis.conflicts) {
    if (!c.tasks.includes(taskId)) continue;
    const other = c.tasks[0] === taskId ? c.tasks[1] : c.tasks[0];
    const w = waveOf(plan, other);
    if (w === null || w >= n) continue;
    const on = c.subjects.length ? ` (on ${c.subjects.slice(0, 3).join(", ")}${c.subjects.length > 3 ? ` and ${c.subjects.length - 3} more` : ""})` : "";
    reasons.push(`${KIND_WORDS[c.kind]} ${quote(titleOf(plan, other))} in wave ${w}${on}`);
  }
  return reasons.length ? `Wave ${n} because ${reasons.join("; ")}.` : `Wave ${n}: placed after wave ${n - 1}.`;
}

/** "2 globs · 5 files", plus "scope unknown" when the footprint could not be resolved (it then runs alone). */
export function footprintLine(t: Pick<Task, "footprint">): string {
  const f = t.footprint;
  return `${plural(f.globs.length, "glob")} · ${plural(f.paths.length, "file")}${f.known ? "" : " · scope unknown"}`;
}

/** Why the plan cannot be integrated now, or null. */
export function integrateReason(plan: Pick<RealizationPlan, "status" | "tasks">): string | null {
  if (plan.status === "integrated" || plan.status === "promoted") return `The plan is ${plan.status}.`;
  const open = plan.tasks.filter((t) => !t.selectedCandidate);
  if (open.length) return `Select a candidate for ${open.map((t) => quote(t.title)).join(", ")} first.`;
  return null;
}

/** Plain wording for auth refusals and the lifecycle error codes; anything else keeps the server's message. */
export function planError(action: string, err: unknown): string {
  const e = err as { status?: number; code?: string; message?: string };
  if (e.status === 401) return `${action} needs the admin token (401). Set it in the header and try again.`;
  if (e.status === 403) return `The admin token was refused (403). Check it in the header and try again.`;
  if (e.code === "import-unreviewed") return `${e.message ?? ""} Accept the import review first.`.trim();
  if (e.code === "replan-required") return `${e.message ?? ""} The Genome moved under this plan; draft a new plan.`.trim();
  return e.message ?? String(err);
}
