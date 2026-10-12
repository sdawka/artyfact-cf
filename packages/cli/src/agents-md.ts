import type { Packet } from "./types.ts";

/** Harness-agnostic AGENTS.md block (backend.md B.6). */
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
- Your logs are advisory; the platform verifies.
`;
}
