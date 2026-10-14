/**
 * The Task Packet for one lifecycle Task Attempt (docs/design/lifecycle.md): what to build, what to leave alone, who
 * else is working, and what this task builds on, read from the plan's `analysis` and its tasks. Never carries the
 * write token or the attempt secret; the start response hands those over separately.
 */
import { layerOf, type CriterionLayer, type SystemModel } from "@artyfact/model";
import type { LifecycleTaskPacket, PacketTaskRef, RealizationPlan, Task, TaskAttempt, TaskConflict } from "../../shared/lifecycle";
import { globMatch } from "../artifacts/source-map";
import { MODEL_PREFIX, nodeFilesFor, TASK_PROTECTED } from "../lifecycle-model";
import { hooksOf } from "../promotion";

/** The 1-based wave holding `taskId` (`analysis.waves[i]` is wave i + 1), or null when no wave places it. */
export function waveOf(plan: Pick<RealizationPlan, "analysis">, taskId: string): number | null {
  const i = plan.analysis.waves.findIndex((w) => w.includes(taskId));
  return i < 0 ? null : i + 1;
}

/** Whether a task's latest attempt still holds the writer lease (the claim rule of lifecycle-store.ts). */
export function hasLiveAttempt(t: Pick<Task, "attempts">, now: number = Date.now()): boolean {
  const last = t.attempts.at(-1);
  return !!last && last.status !== "ended" && Date.parse(last.leaseExpiresAt) > now;
}

const NEEDS = 'If you need a file another task owns, run `artyfact task checkpoint "needs:<path>"` and stop.';
const short = (sha: string) => sha.slice(0, 12);

/** Why two tasks may not run at once, in a sentence, by conflict kind. */
function conflictSentence(c: TaskConflict, other: string, wave: number | null): string {
  const w = wave === null ? "" : ` (wave ${wave})`;
  const subjects = c.subjects.join(", ");
  if (c.kind === "dependency") return `Ordered with ${other}${w} by a declared or ontology dependency.`;
  if (c.kind === "source") return `Shares source files ${subjects ? `${subjects} ` : ""}with ${other}${w}; never both at once.`;
  if (c.kind === "ontology") return `Shares ontology nodes ${subjects} with ${other}${w}; never both at once.`;
  return `Scope unknown for ${other} or this task${w}; never both at once.`;
}

/** Every task reachable from `id` through `dependsOn`, in either direction (its ancestors and its dependents). */
function related(plan: Pick<RealizationPlan, "tasks">, id: string): Set<string> {
  const walk = (start: string, next: (t: string) => string[]) => {
    const seen = new Set<string>(), todo = [...next(start)];
    while (todo.length) { const t = todo.pop()!; if (!seen.has(t)) { seen.add(t); todo.push(...next(t)); } }
    return seen;
  };
  const deps = (t: string) => plan.tasks.find((x) => x.id === t)?.dependsOn ?? [];
  const dependents = (t: string) => plan.tasks.filter((x) => x.dependsOn.includes(t)).map((x) => x.id);
  return new Set([...walk(id, deps), ...walk(id, dependents)]);
}

/**
 * The packet's plain-language independence statement for `task`, from `plan.analysis.conflicts`: which open tasks share
 * no scope (at the task's base commit), which conflict and why, and what to do on needing another task's file.
 * Completed tasks are left out.
 */
export function independenceStatement(plan: Pick<RealizationPlan, "tasks" | "analysis">, task: Pick<Task, "id" | "base">): string {
  const open = new Set(plan.tasks.filter((t) => t.id !== task.id && t.status !== "completed").map((t) => t.id));
  const other = (c: TaskConflict) => (c.tasks[0] === task.id ? c.tasks[1] : c.tasks[0]);
  const mine = plan.analysis.conflicts.filter((c) => c.tasks.includes(task.id) && open.has(other(c)));
  const conflicting = new Set(mine.map(other));
  const ordered = related(plan, task.id);
  const free = [...open].filter((id) => !conflicting.has(id) && !ordered.has(id));
  const parts: string[] = [];
  if (free.length) parts.push(`Independent of ${free.join(", ")}: no shared source or ontology scope at ${short(task.base.commit)}.`);
  for (const c of mine) parts.push(conflictSentence(c, other(c), waveOf(plan, other(c))));
  for (const id of [...open].filter((id) => ordered.has(id) && !conflicting.has(id))) {
    const w = waveOf(plan, id);
    parts.push(`Ordered with ${id}${w === null ? "" : ` (wave ${w})`} through other tasks' dependencies.`);
  }
  if (!open.size) parts.push("No other open task in this plan.");
  parts.push(NEEDS);
  return parts.join(" ");
}

type Fields = Required<Pick<LifecycleTaskPacket, "wave" | "independence" | "doNotTouch" | "concurrent" | "buildsOn">>;

/** The plan-derived packet fields for `task`, as the plan stands now (after this attempt's claim). */
export function packetFields(plan: RealizationPlan, task: Task, now: number = Date.now()): Fields {
  // Never tell the task not to touch what it may edit: drop another task's glob that overlaps one of its own globs or paths.
  const own = [...task.footprint.globs, ...task.footprint.paths];
  const permitted = (g: string) => own.some((o) => o === g || globMatch(g, o) || globMatch(o, g));
  const others = plan.tasks.filter((t) => t.id !== task.id);
  const ref = (t: Task): PacketTaskRef => ({ taskId: t.id, title: t.title, status: t.status, wave: waveOf(plan, t.id) });
  return {
    wave: waveOf(plan, task.id),
    independence: independenceStatement(plan, task),
    doNotTouch: others
      .filter((t) => t.status !== "completed")
      .map((t) => ({ taskId: t.id, globs: t.footprint.globs.filter((g) => !permitted(g)) }))
      .filter((d) => d.globs.length),
    concurrent: others.filter((t) => hasLiveAttempt(t, now)).map(ref),
    buildsOn: task.dependsOn
      .map((id) => plan.tasks.find((t) => t.id === id))
      .filter((t): t is Task => !!t && (t.status === "selected" || t.status === "completed"))
      .map((t) => ({ taskId: t.id, title: t.title, candidateId: t.selectedCandidate })),
  };
}

export interface PacketInput {
  plan: RealizationPlan;
  task: Task;
  attempt: Pick<TaskAttempt, "id" | "generation">;
  remote: string;
  reviewUrl: string;
  now?: number;
  /** The pinned Genome's model: names each node's file under `system/` and each check's layer. */
  model?: SystemModel;
}

/** Layer of each of the task's checks (docs/design/task-fork-model.md §3); an id the Genome lacks is `realization`. */
export function checkLayersOf(m: SystemModel, checks: string[]): Record<string, CriterionLayer> {
  return Object.fromEntries(checks.map((id) => { const c = m.criteria.find((c) => c.id === id); return [id, c ? layerOf(c, hooksOf(m, c)) : "realization"]; }));
}

const MODEL_RULE = `Only change ${MODEL_PREFIX}/ if the model cannot be realized as written; say why in the checkpoint. A changed ${MODEL_PREFIX}/ is judged against the whole ontology and reviewed as a model change.`;
type ModelFields = Pick<LifecycleTaskPacket, "checkLayers" | "model">;
function modelFields(plan: RealizationPlan, task: Task, m?: SystemModel): ModelFields {
  if (!m) return {};
  return { checkLayers: checkLayersOf(m, task.checks), model: { prefix: MODEL_PREFIX, genomeCommit: plan.genome.commit, nodeFiles: nodeFilesFor(m, [...new Set([...task.writeNodes, ...task.readNodes])]) } };
}

/** The task's AGENTS.md lines (no block markers; the CLI merges them into its own block). */
export function renderLifecycleAgentsMd(plan: RealizationPlan, task: Task, f: Fields, reviewUrl: string, model?: ModelFields["model"]): string {
  const dependents = plan.tasks.filter((t) => t.dependsOn.includes(task.id)).map((t) => t.id);
  const dnt = [...f.doNotTouch.map((d) => `${d.globs.join(", ")} (${d.taskId})`), TASK_PROTECTED.join(", ")];
  const builds = f.buildsOn.map((b) => {
    const dep = plan.tasks.find((t) => t.id === b.taskId)!;
    return dep.artifactId === task.artifactId
      ? `${b.taskId} (selected; its changes are in your base)`
      : `${b.taskId} (selected on ${dep.artifactId}; not in this fork)`;
  });
  return [
    `You are implementing task ${task.id} (${task.title}) of plan ${plan.id} for ${plan.systemId}${f.wave === null ? "" : `, wave ${f.wave}`}. Read TASK_PACKET.md fully.`,
    `Permitted edits: ${task.footprint.globs.join(", ") || "(none; scope unknown, do not write until mapped)"}.`,
    `Do not touch: ${dnt.join("; ")}.`,
    `Concurrent tasks: ${f.concurrent.length ? f.concurrent.map((c) => `${c.taskId} (${c.status}${c.wave === null ? "" : `, wave ${c.wave}`})`).join("; ") : "none"}.`,
    ...(builds.length ? [`Builds on: ${builds.join("; ")}.`] : []),
    `After you: ${dependents.length ? `${dependents.join(", ")} ${dependents.length === 1 ? "starts" : "start"} once this task is selected` : "no task waits on this one"}.`,
    ...(model ? [`The pinned Genome ${model.genomeCommit.slice(0, 12)} is in ${MODEL_PREFIX}/ (read it whole; your nodes: ${Object.entries(model.nodeFiles).map(([id, file]) => `${id} in ${file}`).join(", ") || "see TASK_PACKET.md"}). ${MODEL_RULE}`] : []),
    "Implement only the pinned Genome, permitted paths, and Task scope. Run its checks.",
    "Check the attempt with `artyfact task status`.",
    'Checkpoint with `artyfact task checkpoint "What changed and what remains"`.',
    "Submit with `artyfact task submit`. The CLI reads the stored task token from .git/artyfact-task.json; never print, paste or copy it out.",
    "When the task changes how a page looks, attach screenshots: `artyfact task submit --screenshot page.png` (up to 4; PNG, JPEG or WebP, 4 MiB each). Visual checks judge them beside the platform's own captures.",
    "Never approve an Evolution, integrate, or promote without review.",
    `Return the durable review link: ${reviewUrl}`,
    "",
  ].join("\n");
}

function renderMarkdown(plan: RealizationPlan, task: Task, attempt: PacketInput["attempt"], f: Fields, reviewUrl: string, mf: ModelFields = {}): string {
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "_none_");
  const layered = (layer: CriterionLayer) => task.checks.filter((id) => mf.checkLayers?.[id] === layer);
  const checks = mf.checkLayers
    ? (["genome", "realization", "phenome"] as const).filter((l) => layered(l).length).map((l) => `${l}: ${layered(l).join(", ")}`).join("; ") || "_none_"
    : task.checks.join(", ");
  const nodeLine = (id: string) => `\`${id}\`${mf.model?.nodeFiles[id] ? ` in \`${mf.model.nodeFiles[id]}\`` : ""}`;
  return [
    `# ${task.title}`,
    "",
    `Implement accepted Genome ${plan.genome.commit}.`,
    `Artifact: ${task.artifactId}`,
    `Write only: ${task.footprint.globs.join(", ") || "unknown scope; do not write until mapped"}`,
    "",
    task.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    "",
    `Checks: ${checks}`,
    `Review: ${reviewUrl}`,
    `Checkpoint and submit using attempt ${attempt.id} generation ${attempt.generation}.`,
    "",
    "## Task",
    `\`${task.id}\`${f.wave === null ? "" : ` (wave ${f.wave})`}`,
    `Depends on: ${task.dependsOn.map((d) => `\`${d}\``).join(", ") || "_none_"}`,
    "",
    "### Independence",
    f.independence,
    "",
    "### Do not touch",
    list(f.doNotTouch.map((d) => `${d.globs.map((g) => `\`${g}\``).join(", ")} (${d.taskId})`)),
    "",
    "### Concurrent tasks",
    list(f.concurrent.map((c) => `\`${c.taskId}\` ${c.title}: ${c.status}${c.wave === null ? "" : `, wave ${c.wave}`}`)),
    "",
    "### Builds on",
    list(f.buildsOn.map((b) => `\`${b.taskId}\` ${b.title}${b.candidateId ? `, candidate \`${b.candidateId}\`` : ""}`)),
    "",
    ...(mf.model ? [
      "## Model",
      `The whole pinned Genome (${mf.model.genomeCommit}) is in \`${mf.model.prefix}/\` of this fork. Read it before you change code; it is the reference, not a suggestion.`,
      `Write nodes (what this task realizes): ${task.writeNodes.map(nodeLine).join(", ") || "_none_"}`,
      `Read nodes: ${task.readNodes.map(nodeLine).join(", ") || "_none_"}`,
      MODEL_RULE,
      "",
    ] : []),
  ].join("\n");
}

/** The full packet for a started attempt. */
export function lifecyclePacket(i: PacketInput): LifecycleTaskPacket {
  const { plan, task, attempt, reviewUrl } = i;
  const f = packetFields(plan, task, i.now), mf = modelFields(plan, task, i.model);
  return {
    systemId: plan.systemId,
    planId: plan.id,
    taskId: task.id,
    attemptId: attempt.id,
    generation: attempt.generation,
    genome: plan.genome,
    artifactId: task.artifactId,
    workspace: { repo: task.base.repo, fork: task.forkRepo, baseCommit: task.base.commit, remote: i.remote },
    steps: task.steps,
    dependsOn: task.dependsOn,
    readNodes: task.readNodes,
    writeNodes: task.writeNodes,
    permittedGlobs: task.footprint.globs,
    checks: task.checks,
    reviewUrl,
    markdown: renderMarkdown(plan, task, attempt, f, reviewUrl, mf),
    ...f,
    ...mf,
    agentsMd: renderLifecycleAgentsMd(plan, task, f, reviewUrl, mf.model),
  };
}
