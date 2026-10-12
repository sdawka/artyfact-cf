import type { schema, SystemModel } from "@artyfact/model";
import { stringify as toYaml } from "yaml";
import type { Certainty, TaskPacket } from "../../shared/api";
import { globMatch, permittedGlobs, type SourceMapEntry } from "../artifacts/source-map";
import { isBlocking } from "../promotion";
import { canonicalJson, sha256Hex } from "../util";

export interface PacketInput {
  systemId: string;
  realizationId: string;
  target: "app" | "genome";
  model: SystemModel;
  evolution: schema.Evolution;
  workspace: TaskPacket["workspace"];
  sourceMap: SourceMapEntry[];
  /** Blob paths in the fork's base tree (for entry files). */
  baseTreePaths: string[];
  commands: string[];
  concurrentWork: TaskPacket["concurrentWork"];
  /** Platform base URL, used in submit instructions. */
  platformUrl: string;
  /** Genome realizations: Genome root inside the repo ("" or "system"). */
  genomePrefix?: string;
}

/** Blocking criteria among the Evolution's acceptance criteria (hard with a bound hook; see ../promotion.ts). */
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

function entryFiles(sm: SourceMapEntry[], affected: string[], tree: string[]): TaskPacket["entryFiles"] {
  const out = new Map<string, Certainty>();
  for (const e of sm.filter((x) => x.nodes.some((n) => affected.includes(n)))) {
    const certainty: Certainty = e.origin === "repo" ? "declared" : "assumed";
    const hits = tree.filter((p) => globMatch(e.glob, p));
    if (!hits.length && !out.has(e.glob)) out.set(e.glob, "proposed");
    for (const p of hits) if (out.get(p) !== "declared") out.set(p, certainty);
  }
  return [...out].map(([path, certainty]) => ({ path, certainty })).sort((a, b) => a.path.localeCompare(b.path));
}

function genomePermitted(m: SystemModel, affected: string[], prefix: string): string[] {
  const pre = prefix ? `${prefix.replace(/\/+$/, "")}/` : "";
  const files = new Set<string>();
  for (const id of affected) {
    const origin = m.origin[id];
    // Template-provided objects have a template ref as origin: overriding means editing the owning Thing's ontology.
    if (origin && !origin.startsWith("template.")) files.add(pre + origin);
    else {
      const thing = m.index.path(id).find((p) => m.index.byId[p]?.type === "thing");
      const dir = thing && Object.entries(m.origin).find(([k]) => k === thing)?.[1]?.replace(/thing\.yaml$/, "");
      if (dir) files.add(`${pre}${dir}ontology.yaml`);
    }
  }
  return [...files, `${pre}evolutions/**`];
}

function stepText(s: schema.Journey["steps"][number]): string {
  const refs = [s.screen, s.operation, s.external].filter(Boolean).join(", ");
  return `${s.actor}: ${s.action}${refs ? ` (${refs})` : ""}`;
}

export async function buildTaskPacket(i: PacketInput): Promise<TaskPacket> {
  const m = i.model;
  const affected = i.evolution.affectedNodes;
  const critById = new Map(m.criteria.map((c) => [c.id, c] as const));
  const acceptanceCriteria = i.evolution.acceptanceCriteria.map((id) => {
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

  const permittedPaths = i.target === "app"
    ? permittedGlobs(i.sourceMap, affected, (id) => m.index.path(id), kindOf(m))
    : genomePermitted(m, affected, i.genomePrefix ?? "");
  const protectedPaths = protectedPathsFor(i.target);
  const required = acceptanceCriteria.filter((c) => c.gate).map((c) => c.id);
  const submitInstructions = [
    `Commit your work and run \`npx artyfact submit\` from the workspace (pushes HEAD to ${i.workspace.fork} main and posts the commit).`,
    `Equivalent API call: POST ${i.platformUrl}/api/systems/${i.systemId}/evolutions/${i.evolution.id}/realizations/${i.realizationId}/submit {"commit": "<sha>", "previewUrl": "<optional>"}.`,
    required.length ? `Submit when ${required.join(", ")} are met and tests pass.` : "Submit when the intent is met and tests pass.",
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
    entryFiles: i.target === "app" ? entryFiles(i.sourceMap, affected, i.baseTreePaths) : [],
    commands: i.commands,
    concurrentWork: i.concurrentWork,
    startCommand: startCommand(i.systemId, i.evolution.id, i.realizationId),
    submitInstructions,
  };
  const hash = await sha256Hex(canonicalJson(body));
  const packet: TaskPacket = { ...body, hash, markdown: "", agentsMd: "" };
  packet.markdown = renderMarkdown(packet);
  packet.agentsMd = renderAgentsMd(packet);
  return packet;
}

/** CLI start line. The packet carries the `<token>` placeholder; only the StartWork response fills it in. */
export function startCommand(systemId: string, evolutionId: string, realizationId: string): string {
  return `ARTYFACT_TOKEN=<token> npx artyfact start ${realizationId} --system ${systemId} --evolution ${evolutionId} --dir ./${realizationId}`;
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
    "Set up the workspace with the token from the StartWork response:",
    "```sh",
    p.startCommand,
    "```",
    "",
    "## Intent",
    p.intent,
    "",
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
    bullets(p.concurrentWork.map((w) => `\`${w.realization}\`${w.agentLabel ? ` (${w.agentLabel})` : ""}: ${w.status}${w.changedSubjects.length ? `, touching ${w.changedSubjects.join(", ")}` : ""}`)),
    "",
    "## Submit",
    p.submitInstructions,
    "",
  ].join("\n");
}

export function renderAgentsMd(p: TaskPacket): string {
  const ids = p.acceptanceCriteria.filter((c) => c.gate).map((c) => c.id);
  const cmds = p.commands.length ? p.commands.join("; ") : "npm install; npm run dev; npm test";
  return [
    "<!-- artyfact:start -->",
    `You are realizing ${p.evolutionId} for ${p.systemId}. Read TASK_PACKET.md fully.`,
    `Permitted edits: ${p.permittedPaths.join(", ") || "(none)"}.`,
    p.target === "app" ? "Never edit system/** or assays/** in an app realization." : `Never edit ${p.protectedPaths.join(", ")}.`,
    `Commands: ${cmds}.`,
    'Checkpoint often: `npx artyfact checkpoint "<what/why/left>"`.',
    `When acceptance criteria ${ids.join(", ") || "(see TASK_PACKET.md)"} are met and tests pass: \`npx artyfact submit\`.`,
    "Your logs are advisory; the platform verifies.",
    "<!-- artyfact:end -->",
    "",
  ].join("\n");
}
