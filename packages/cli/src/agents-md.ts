import type { Packet } from "./types.ts";

/** Harness-agnostic AGENTS.md block (backend.md B.6). */
export const AGENTS_START = "<!-- artyfact:start -->";
export const AGENTS_END = "<!-- artyfact:end -->";

/** Insert or replace a marked block (`<!-- <name>:start -->` ... `<!-- <name>:end -->`) in an existing AGENTS.md; idempotent. */
export function mergeAgentsBlock(existing: string, block: string, name = "artyfact"): string {
  const start = name === "artyfact" ? AGENTS_START : `<!-- ${name}:start -->`;
  const end = name === "artyfact" ? AGENTS_END : `<!-- ${name}:end -->`;
  const wrapped = `${start}\n${block.trim()}\n${end}\n`;
  const a = existing.indexOf(start);
  const b = existing.indexOf(end);
  if (a !== -1 && b > a) return existing.slice(0, a) + wrapped + existing.slice(b + end.length).replace(/^\n/, "");
  return `${existing}${existing === "" || existing.endsWith("\n") ? "" : "\n"}${existing ? "\n" : ""}${wrapped}`;
}

/** The platform's own block when the packet carries one; otherwise the local fallback below. */
export function renderAgentsMd(packet: Packet, system: string): string {
  return packet.agentsMd?.trim() ? packet.agentsMd : fallbackAgentsMd(packet, system);
}

function taskLines(packet: Packet): string {
  const t = packet.task;
  if (!t) return "";
  const lines = [`- Task: ${t.id}${t.title ? ` (${t.title})` : ""}${t.wave != null ? `, wave ${t.wave}` : ""}`];
  if (t.dependsOn?.length) lines.push(`- Depends on: ${t.dependsOn.join(", ")}`);
  if (t.nodes?.length) lines.push(`- Task nodes: ${t.nodes.join(", ")}`);
  if (t.independence) lines.push(`- Independence: ${t.independence}`);
  return `${lines.join("\n")}\n`;
}

function fallbackAgentsMd(packet: Packet, system: string): string {
  const ids = packet.acceptanceCriteria.map((c) => c.id).join(", ") || "(none)";
  const globs = packet.permittedPaths.join(", ") || "(none)";
  const cmds = packet.commands.length ? packet.commands.join("; ") : "npm install; npm run dev; npm test";
  return `# Agent instructions

You are realizing ${packet.evolutionId ?? "this evolution"} for ${system}. Read TASK_PACKET.md fully.

${taskLines(packet)}- Permitted edits: ${globs}
- Never edit system/** or assays/** in an app realization.${packet.protectedPaths.length ? ` Protected: ${packet.protectedPaths.join(", ")}` : ""}
- Commands: ${cmds}
- Checkpoint often: \`npx artyfact checkpoint "<what/why/left>"\`
- When acceptance criteria ${ids} are met and tests pass: \`npx artyfact submit\`
- Report a preview: platform CI builds and deploys each submit. If it reports no build, deploy one yourself and run \`npx artyfact build-report --status passed --url <preview-url>\`
- Your logs are advisory; the platform verifies.
`;
}
