import { NODE_FILE } from "@artyfact/ontology/genome";
import type { schema, SystemModel } from "@artyfact/model";
import { stringify as toYaml } from "yaml";
import type { Certainty, Task, TaskConflict, TaskPacket, TaskPacketTask, TaskPlan } from "../../shared/api";
import { globMatch, permittedGlobs, sourceMapFor, type SourceMapEntry } from "../artifacts/source-map";
import { isBlocking } from "../promotion";
import { canonicalJson, sha256Hex } from "../util";

export interface PacketInput {
  systemId: string;
  realizationId: string;
  target: "app" | "genome";
  model: SystemModel;
  evolution: schema.Evolution;
  workspace: TaskPacket["workspace"];
  /** Blob paths in the fork's base tree (for entry files). */
  baseTreePaths: string[];
  commands: string[];
  concurrentWork: TaskPacket["concurrentWork"];
  /** Platform base URL, used in submit instructions. */
  platformUrl: string;
  /** Genome realizations: Genome root inside the repo ("" or "system"). */
  genomePrefix?: string;
  /** Extra permitted globs (repo paths), e.g. the directories of nodes an accepted intent adds. */
  permittedExtra?: string[];
  /**
   * The Task this realization works on: its nodes and criteria replace the Evolution's in the packet (scope, criteria,
   * excerpts, journeys), and the packet gains a `## Task` section.
   */
  task?: PacketTask;
}

/** A Task as the packet needs it: the wire `TaskPacketTask`, its criteria and what the AGENTS.md block names. */
export interface PacketTask extends TaskPacketTask {
  acceptanceCriteria: string[];
  /** Other tasks' globs the agent must leave alone (its own permitted globs removed). */
  doNotTouch: { task: string; globs: string[] }[];
  /** Tasks running beside this one, as `t2 (src/x/**)` lines. */
  concurrent: string[];
  /** Tasks that depend on this one. */
  after: string[];
}

/** Blocking criteria among the Evolution's acceptance criteria (hard with a bound hook, regardless of gates; see ../promotion.ts). */
export function requiredCriteria(m: SystemModel, evolution: schema.Evolution): string[] {
  const byId = new Map(m.criteria.map((c) => [c.id, c] as const));
  return evolution.acceptanceCriteria.filter((id) => {
    const c = byId.get(id);
    return c ? isBlocking(m, c) : false;
  });
}

export function protectedPathsFor(target: "app" | "genome"): string[] {
  return target === "app" ? ["system/**", "assays/**"] : ["assays/**"];
}

const kindOf = (m: SystemModel) => (id: string) => m.index.byId[id]?.type === "node" ? m.index.byId[id].kind : m.index.byId[id]?.type;

export function entryFiles(sm: SourceMapEntry[], affected: string[], tree: string[]): TaskPacket["entryFiles"] {
  const out = new Map<string, Certainty>();
  for (const e of sm.filter((x) => x.nodes.some((n) => affected.includes(n)))) {
    const certainty: Certainty = e.origin === "node" ? "declared" : "assumed";
    const hits = tree.filter((p) => globMatch(e.glob, p));
    if (!hits.length && !out.has(e.glob)) out.set(e.glob, "proposed");
    for (const p of hits) if (out.get(p) !== "declared") out.set(p, certainty);
  }
  return [...out].map(([path, certainty]) => ({ path, certainty })).sort((a, b) => a.path.localeCompare(b.path));
}

function genomePermitted(m: SystemModel, affected: string[], prefix: string): string[] {
  const pre = prefix ? `${prefix.replace(/\/+$/, "")}/` : "";
  const files = new Set<string>();
  // Every object is declared in a node directory's `node.yaml` (or a change record). An affected node's directory is
  // permitted whole: its file and any node added under it.
  for (const id of affected) {
    const origin = m.origin[id];
    if (!origin) continue;
    if (origin === NODE_FILE) files.add(`${pre}${NODE_FILE}`);
    else files.add(pre + (origin.endsWith(`/${NODE_FILE}`) ? `${origin.slice(0, -NODE_FILE.length)}**` : origin));
  }
  return [...files, `${pre}evolutions/**`];
}

function stepText(s: schema.Journey["steps"][number]): string {
  const refs = [s.screen, s.operation, s.external].filter(Boolean).join(", ");
  return `${s.actor}: ${s.action}${refs ? ` (${refs})` : ""}`;
}

export async function buildTaskPacket(i: PacketInput): Promise<TaskPacket> {
  const m = i.model;
  const affected = i.task ? i.task.nodes : i.evolution.affectedNodes;
  const critById = new Map(m.criteria.map((c) => [c.id, c] as const));
  const acceptanceCriteria = (i.task ? i.task.acceptanceCriteria : i.evolution.acceptanceCriteria).map((id) => {
    const c = critById.get(id);
    return c
      ? { id, title: c.title, text: c.claim, gate: isBlocking(m, c), severity: c.severity, subject: c.subjectId, hooks: m.index.hooksByCriterion[id] ?? c.hooks }
      : { id, title: id, text: "(criterion not found in the Genome)", gate: true, severity: "hard", subject: "", hooks: [] };
  });
  const genomeExcerpts = affected
    .filter((id) => m.index.byId[id])
    .map((id) => {
      const e = m.index.byId[id];
      return { id, kind: e.kind, path: m.index.path(id), body: toYaml(e.item).trimEnd() };
    });
  const journeyIds = [...new Set(affected.flatMap((id) => m.index.journeysByNode[id] ?? []))].sort();
  const journeys = journeyIds.map((id) => {
    const j = m.journeys.find((x) => x.id === id)!;
    return { id, title: j.name, steps: j.steps.map(stepText) };
  });
  const features = new Set(journeys.flatMap((j) => m.journeys.find((x) => x.id === j.id)!.features));
  const allCommitments = m.description?.commitments ?? [];
  const related = allCommitments.filter((c) => c.features.some((f) => features.has(f)));
  const commitments = (related.length ? related : allCommitments).map((c) => c.statement);

  // App scope comes from the affected nodes' `files` (and their ancestors' below the Thing).
  const sourceMap = i.target === "app" ? sourceMapFor(m) : [];
  // An empty scope is unconstrained: everything is permitted, and the protected paths are still refused first.
  const permittedPaths = !affected.length
    ? [i.target === "genome" && i.genomePrefix ? `${i.genomePrefix.replace(/\/+$/, "")}/**` : "**"]
    : i.target === "app"
      ? permittedGlobs(sourceMap, affected, (id) => m.index.path(id), kindOf(m))
      : [...new Set([...genomePermitted(m, affected, i.genomePrefix ?? ""), ...(i.permittedExtra ?? [])])];
  const protectedPaths = protectedPathsFor(i.target);
  const required = acceptanceCriteria.filter((c) => c.gate).map((c) => c.id);
  const submitInstructions = [
    `Commit your work and run \`npx artyfact submit\` from the workspace (pushes HEAD to ${i.workspace.fork} main and posts the commit).`,
    `Equivalent API call: POST ${i.platformUrl}/api/systems/${i.systemId}/evolutions/${i.evolution.id}/realizations/${i.realizationId}/submit {"commit": "<sha>", "previewUrl": "<optional>"}.`,
    required.length ? `Submit when ${required.join(", ")} are met and tests pass.` : "Submit when the intent is met and tests pass.",
    ...(i.target === "app" ? [reportPreview(i.platformUrl, i.systemId, i.realizationId)] : []),
  ].join(" ");

  const body = {
    systemId: i.systemId,
    realizationId: i.realizationId,
    evolutionId: i.evolution.id,
    title: i.evolution.title,
    target: i.target,
    intent: i.evolution.intent,
    workspace: i.workspace,
    acceptanceCriteria,
    genomeExcerpts,
    journeys,
    commitments,
    permittedPaths,
    protectedPaths,
    entryFiles: i.target === "app" ? entryFiles(sourceMap, affected, i.baseTreePaths) : [],
    commands: i.commands,
    concurrentWork: i.concurrentWork,
    ...(i.task && { task: wireTask(i.task) }),
    startCommand: startCommand(i.systemId, i.evolution.id, i.realizationId),
    submitInstructions,
  };
  const hash = await sha256Hex(canonicalJson(body));
  const packet: TaskPacket = { ...body, hash, markdown: "", agentsMd: "" };
  packet.markdown = renderMarkdown(packet);
  packet.agentsMd = renderAgentsMd(packet, i.task);
  return packet;
}

function wireTask(t: PacketTask): TaskPacketTask {
  return { id: t.id, title: t.title, intent: t.intent, nodes: t.nodes, dependsOn: t.dependsOn, independence: t.independence, wave: t.wave };
}

/** The 1-based wave holding `taskId` (`plan.waves[i]` is wave i + 1), or null when the plan does not place it. */
export function waveOf(plan: Pick<TaskPlan, "waves">, taskId: string): number | null {
  const i = plan.waves.findIndex((w) => w.includes(taskId));
  return i < 0 ? null : i + 1;
}

const NEEDS = "If you need a file another task owns, checkpoint `needs:<path>` and stop.";

/**
 * The packet's plain-language independence statement for `task`, from the plan's conflicts: which tasks share no
 * files (at the plan's app commit), which overlap softly (and whose files to avoid), which conflict on files or by
 * declaration. `ownGlobs` are the task's permitted globs (left out of the files it is told to avoid).
 */
export function independenceStatement(task: Pick<Task, "id">, plan: Pick<TaskPlan, "tasks" | "conflicts" | "appCommit" | "waves">, ownGlobs: string[] = []): string {
  const ended = new Set(plan.tasks.filter((t) => t.status === "rejected" || t.status === "abandoned").map((t) => t.id));
  const others = plan.tasks.filter((t) => t.id !== task.id && !ended.has(t.id));
  const other = (c: TaskConflict) => (c.tasks[0] === task.id ? c.tasks[1] : c.tasks[0]);
  const mine = plan.conflicts.filter((c) => c.tasks.includes(task.id) && !ended.has(other(c)));
  const withConflict = new Set(mine.map(other));
  const free = others.filter((t) => !withConflict.has(t.id)).map((t) => t.id);
  const at = plan.appCommit ? ` at ${plan.appCommit.slice(0, 12)}` : "";
  const globsOf = (id: string) => (plan.tasks.find((t) => t.id === id)?.footprint.globs ?? []).filter((g) => !ownGlobs.includes(g));
  const parts: string[] = [];
  if (free.length) parts.push(`Independent of ${free.join(", ")}: no shared files${at}.`);
  for (const c of mine) {
    const o = other(c);
    if (c.kind === "soft-semantic") {
      const globs = globsOf(o);
      parts.push(`Shares ${c.subjects.join(", ")} with ${o} (soft overlap${globs.length ? `, do not edit its files ${globs.join(", ")}` : ""}).`);
    } else if (c.kind === "file") {
      const w = waveOf(plan, o);
      parts.push(`Shares files ${c.subjects.join(", ")} with ${o}${w === null ? "" : ` (wave ${w})`}; never both at once.`);
    } else {
      parts.push(`${c.message.replace(/\.$/, "")} (declared).`);
    }
  }
  if (!others.length) parts.push("The only task of its plan.");
  parts.push(NEEDS);
  return parts.join(" ");
}

/** CLI start line. The packet carries `<token>` and `<secret>` placeholders; only the StartWork response fills them in. */
export function startCommand(systemId: string, evolutionId: string, realizationId: string): string {
  return `ARTYFACT_TOKEN=<token> ARTYFACT_SECRET=<secret> npx artyfact start ${realizationId} --system ${systemId} --evolution ${evolutionId} --dir ./${realizationId}`;
}

const bullets = (xs: string[], empty = "_none_") => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : empty);

export function renderMarkdown(p: TaskPacket): string {
  return [
    `# Task Packet: ${p.title}`,
    "",
    `System \`${p.systemId}\` · Evolution \`${p.evolutionId}\` · Realization \`${p.realizationId}\` (${p.target})`,
    `Fork \`${p.workspace.fork}\` from \`${p.workspace.repo}\` at \`${p.workspace.baseCommit}\``,
    `Packet hash \`${p.hash}\``,
    "",
    "## Start",
    "Set up the workspace with the token and secret from the StartWork response:",
    "```sh",
    p.startCommand,
    "```",
    "",
    "## Intent",
    p.intent,
    "",
    ...(p.task ? taskSection(p.task) : []),
    "## Acceptance criteria",
    bullets(p.acceptanceCriteria.map((c) => `\`${c.id}\`${c.gate ? " (required)" : ""}: ${c.title}. ${c.text}`)),
    "",
    "## Genome excerpts",
    ...(p.genomeExcerpts.length
      ? p.genomeExcerpts.flatMap((e) => [`### ${e.id} (${e.kind})`, `Path: ${e.path.join(" > ")}`, "```yaml", e.body, "```", ""])
      : ["_none_", ""]),
    "## Journeys",
    ...(p.journeys.length ? p.journeys.flatMap((j) => [`### ${j.title} (\`${j.id}\`)`, ...j.steps.map((s, n) => `${n + 1}. ${s}`), ""]) : ["_none_", ""]),
    "## Commitments",
    bullets(p.commitments),
    "",
    "## Paths",
    "Permitted:",
    bullets(p.permittedPaths.map((g) => `\`${g}\``)),
    "",
    "Protected (never edit):",
    bullets(p.protectedPaths.map((g) => `\`${g}\``)),
    "",
    "## Entry files",
    bullets(p.entryFiles.map((f) => `\`${f.path}\` (${f.certainty})`)),
    "",
    "## Commands",
    bullets(p.commands.map((c) => `\`${c}\``)),
    "",
    "## Concurrent work",
    bullets(p.concurrentWork.map((w) => `\`${w.realization}\`${w.agentLabel ? ` (${w.agentLabel})` : ""}: ${w.status} on ${w.evolution}${w.task ? ` task ${w.task}` : ""}${w.changedSubjects.length ? `, touching ${w.changedSubjects.join(", ")}` : ""}${w.permittedPaths.length ? `; may edit ${w.permittedPaths.map((g) => `\`${g}\``).join(", ")}` : ""}`)),
    "",
    "## Submit",
    p.submitInstructions,
    "",
  ].join("\n");
}

function taskSection(t: TaskPacketTask): string[] {
  return [
    "## Task",
    `\`${t.id}\`: ${t.title}${t.wave === null ? "" : ` (wave ${t.wave})`}`,
    "",
    t.intent,
    "",
    `Nodes: ${t.nodes.map((n) => `\`${n}\``).join(", ") || "_none_"}`,
    `Depends on: ${t.dependsOn.map((d) => `\`${d}\``).join(", ") || "_none_"}`,
    "",
    "### Independence",
    t.independence,
    "",
  ];
}

/** "Report a preview": CI builds each submit; the agent reports one only when CI did not. */
function reportPreview(platformUrl: string, systemId: string, rid: string): string {
  return `Report a preview: platform CI builds and deploys each submitted commit and reports the preview itself. If no build appears for your submit, deploy one and run \`npx artyfact build-report --status passed --url <preview-url>\` (POST ${platformUrl}/api/systems/${systemId}/realizations/${rid}/builds {"status": "passed", "commit": "<sha>", "url": "<preview-url>"}).`;
}

/** `task`: the packet's Task with what its first lines name (other tasks' globs, concurrent tasks, dependents). */
export function renderAgentsMd(p: TaskPacket, task?: Pick<PacketTask, "doNotTouch" | "concurrent" | "after">): string {
  const ids = p.acceptanceCriteria.filter((c) => c.gate).map((c) => c.id);
  const cmds = p.commands.length ? p.commands.join("; ") : "npm install; npm run dev; npm test";
  const t = p.task;
  const head = t
    ? [
      `You are realizing task ${t.id} (${t.title}) of ${p.evolutionId} for ${p.systemId}. Read TASK_PACKET.md fully.`,
      `Permitted edits: ${p.permittedPaths.join(", ") || "(none)"}.`,
      `Do not touch: ${[...(task?.doNotTouch ?? []).filter((d) => d.globs.length).map((d) => `${d.globs.join(", ")} (${d.task})`), p.protectedPaths.join(", ")].join("; ")}.`,
      `Concurrent tasks: ${task?.concurrent.length ? task.concurrent.join("; ") : "none"}.`,
      `After you: ${task?.after.length ? `${task.after.join(", ")} start when this task is promoted` : "no task waits on this one"}.`,
    ]
    : [
      `You are realizing ${p.evolutionId} for ${p.systemId}. Read TASK_PACKET.md fully.`,
      `Permitted edits: ${p.permittedPaths.join(", ") || "(none)"}.`,
      p.target === "app" ? "Never edit system/** or assays/** in an app realization." : `Never edit ${p.protectedPaths.join(", ")}.`,
    ];
  return [
    "<!-- artyfact:start -->",
    ...head,
    `Commands: ${cmds}.`,
    'Checkpoint often: `npx artyfact checkpoint "<what/why/left>"`.',
    `When acceptance criteria ${ids.join(", ") || "(see TASK_PACKET.md)"} are met and tests pass: \`npx artyfact submit\`.`,
    ...(p.target === "app" ? ["Report a preview: CI builds each submit. If it reports no build, deploy one and run `npx artyfact build-report --status passed --url <preview-url>`."] : []),
    "Your logs are advisory; the platform verifies.",
    "<!-- artyfact:end -->",
    "",
  ].join("\n");
}
