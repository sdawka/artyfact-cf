import type { Packet } from "./types.ts";

/** Harness-agnostic AGENTS.md block (backend.md B.6). */
export const AGENTS_START = "<!-- artyfact:start -->";
export const AGENTS_END = "<!-- artyfact:end -->";

/** Insert or replace the artyfact block in an existing (tracked) AGENTS.md; idempotent. */
export function mergeAgentsBlock(existing: string, block: string, name = "artyfact"): string {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const wrapped = `${start}\n${block.trim()}\n${end}\n`;
  const a = existing.indexOf(start);
  const b = existing.indexOf(end);
  if (a !== -1 && b > a) return existing.slice(0, a) + wrapped + existing.slice(b + end.length).replace(/^\n/, "");
  return `${existing}${existing === "" || existing.endsWith("\n") ? "" : "\n"}${existing ? "\n" : ""}${wrapped}`;
}

export function renderAgentsMd(packet: Packet, system: string): string {
  const ids = packet.acceptanceCriteria.map((c) => c.id).join(", ") || "(none)";
  const globs = packet.permittedPaths.join(", ") || "(none)";
  const cmds = packet.commands.length ? packet.commands.join("; ") : "npm install; npm run dev; npm test";
  return `# Agent instructions

You are realizing ${packet.evolutionId ?? "this evolution"} for ${system}. Read TASK_PACKET.md fully.

- Permitted edits: ${globs}
- Never edit system/** or assays/** in an app realization.${packet.protectedPaths.length ? ` Protected: ${packet.protectedPaths.join(", ")}` : ""}
- Commands: ${cmds}
- Checkpoint often: \`npx artyfact checkpoint "<what/why/left>"\`
- When acceptance criteria ${ids} are met and tests pass: \`npx artyfact submit\`
- Report a preview: platform CI builds and deploys each submit. If it reports no build, deploy one yourself and run \`npx artyfact build-report --status passed --url <preview-url>\`
- Your logs are advisory; the platform verifies.
`;
}
