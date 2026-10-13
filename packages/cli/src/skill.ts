import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { mergeAgentsBlock } from "./agents-md.ts";
import { CliError } from "./git.ts";
import { safeWrite, type Io } from "./main.ts";

const USAGE = "usage: artyfact skill [--dir project] [--write] [--agent claude|generic]";
const MARKER = "artyfact-genome";
const SKILL_DIR = ".claude/skills/artyfact-genome";

const shipped = (rel: string) => readFileSync(fileURLToPath(new URL(`../skills/artyfact-genome/${rel}`, import.meta.url)), "utf8");

const isLink = (path: string): boolean => {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
};

/** `mkdir -p` for a directory under `project`, refusing any symlinked component. */
function ensureDir(project: string, rel: string): void {
  let at = project;
  for (const part of rel.split("/")) {
    at = join(at, part);
    if (isLink(at)) throw new CliError(`refusing to write through symlink: ${at}`);
    if (!existsSync(at)) mkdirSync(at);
  }
}

/** The skill without its frontmatter, for inlining into AGENTS.md. */
const body = (skill: string) => skill.replace(/^---\n[\s\S]*?\n---\n+/, "");

/**
 * `artyfact skill [--dir project] [--write] [--agent claude|generic]`: prints the shipped `artyfact-genome` skill, or installs it.
 * `claude` writes `.claude/skills/artyfact-genome/` and a pointer block in AGENTS.md; `generic` writes the whole skill into AGENTS.md.
 */
export function skillCommand(argv: string[], io: Pick<Io, "cwd" | "out">): number {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { dir: { type: "string" }, write: { type: "boolean" }, agent: { type: "string" } }, allowPositionals: true });
  } catch (e) {
    throw new CliError((e as Error).message);
  }
  if (parsed.positionals.length) throw new CliError(USAGE);
  const agentArg = parsed.values.agent;
  if (agentArg !== undefined && agentArg !== "claude" && agentArg !== "generic") throw new CliError(`unknown agent '${agentArg}'; use claude or generic`);
  const skill = shipped("SKILL.md");
  if (!parsed.values.write) {
    io.out(skill.replace(/\n$/, ""));
    return 0;
  }
  const project = resolve(io.cwd, parsed.values.dir ?? ".");
  if (!existsSync(project) || !lstatSync(project).isDirectory()) throw new CliError(`${parsed.values.dir ?? "."} is not a directory`);
  const agent = agentArg ?? (existsSync(join(project, ".claude")) ? "claude" : "generic");

  const written: string[] = [];
  let block: string;
  if (agent === "claude") {
    ensureDir(project, `${SKILL_DIR}/reference`);
    safeWrite(join(project, SKILL_DIR, "SKILL.md"), skill);
    safeWrite(join(project, SKILL_DIR, "reference/templates.md"), shipped("reference/templates.md"));
    written.push(`${SKILL_DIR}/SKILL.md`, `${SKILL_DIR}/reference/templates.md`);
    block = `To write or update this repository's Genome, follow \`${SKILL_DIR}/SKILL.md\` (the artyfact-genome skill).
Validate with \`npx artyfact validate-genome ./genome --app .\` before \`npx artyfact init --genome ./genome --app .\`.`;
  } else {
    block = `${body(skill).trim()}

The per-template digest this skill refers to is installed by \`npx artyfact skill --write --agent claude\`.`;
  }
  const agentsPath = join(project, "AGENTS.md");
  if (isLink(agentsPath)) throw new CliError(`refusing to write through symlink: ${agentsPath}`);
  safeWrite(agentsPath, mergeAgentsBlock(existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "", block, MARKER));
  written.push("AGENTS.md");
  for (const w of written) io.out(`wrote ${w}`);
  return 0;
}
