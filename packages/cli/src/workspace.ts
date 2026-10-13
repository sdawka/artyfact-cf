import { closeSync, constants, existsSync, fchmodSync, lstatSync, openSync, readFileSync, readdirSync, writeSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mergeAgentsBlock, renderAgentsMd } from "./agents-md.ts";
import { CliError, assertId, assertRemote, assertToken, git, isTracked } from "./git.ts";
import { WORKSPACE_IGNORES } from "./ignore.ts";
import type { Packet, WorkspaceConfig } from "./types.ts";

export const CONFIG = ".artyfact.json";

/** Write a file without ever following a symlink at the target (O_NOFOLLOW) and refuse symlinked paths. */
export function safeWrite(path: string, data: string, mode = 0o644, append = false): void {
  if (existsSync(path) || isLink(path)) {
    if (lstatSync(path).isSymbolicLink()) throw new CliError(`refusing to write through symlink: ${path}`);
  }
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (append ? constants.O_APPEND : constants.O_TRUNC);
  let fd: number;
  try {
    fd = openSync(path, flags, mode);
  } catch (e) {
    throw new CliError(`cannot write ${path}: ${(e as Error).message}`);
  }
  try {
    writeSync(fd, data);
    if (!append) fchmodSync(fd, mode);
  } finally {
    closeSync(fd);
  }
}

export function lstatOrNull(path: string) {
  try { return lstatSync(path); } catch { return null; }
}

export function isLink(path: string): boolean {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

/** The workspace config saved by an earlier `start` or `claim` in `dir`, if there is a readable one. */
export function readPriorConfig(dir: string): Partial<WorkspaceConfig> | undefined {
  const f = join(dir, CONFIG);
  try { return isLink(f) ? undefined : (JSON.parse(readFileSync(f, "utf8")) as WorkspaceConfig); } catch { return undefined; }
}

/** Whether `dir` already holds the clone made for this realization (throws when it holds anything else). */
export function isOurClone(dir: string, realizationId: string, remote: string): boolean {
  if (!(existsSync(dir) && readdirSync(dir).length > 0)) return false;
  const foreign = () => new CliError(`${dir} exists and is not empty; choose another --dir`);
  if (readPriorConfig(dir)?.realizationId !== realizationId) throw foreign();
  // .git and .git/info must be real directories and origin must be the validated remote.
  for (const sub of [".git", join(".git", "info")]) {
    const st = lstatOrNull(join(dir, sub));
    if (sub === ".git" ? !st?.isDirectory() : st && !st.isDirectory()) throw foreign();
  }
  if (git(dir, ["config", "--get", "remote.origin.url"]) !== remote) throw foreign();
  return true;
}

export interface MaterializeInput {
  dir: string;
  platform: string;
  systemId: string;
  evolutionId: string;
  realizationId: string;
  forkRepo: string;
  remote: string;
  packet: Packet;
  /** Fork write token; only needed when the directory is cloned. */
  token?: string;
  secret: string;
  /** Every credential to blank out of the files written. */
  secrets: string[];
  tokenExpires?: string;
  taskId?: string;
  /** Save `token` in `.artyfact.json` (`claim` does; `start` does not). */
  storeToken?: string;
}

/**
 * Clone the realization's fork into `dir` (or reuse our earlier clone), write TASK_PACKET.md, AGENTS.md and
 * `.artyfact.json`, and keep those per-realization files out of the fork. Shared by `start` and `claim`.
 */
export function materializeWorkspace(io: { cwd: string; env: Record<string, string | undefined> }, input: MaterializeInput): { reused: boolean } {
  const { dir, packet, systemId, secrets } = input;
  const remote = assertRemote("workspace.remote", input.remote, io.env);
  const scrub = (text: string) => secrets.reduce((t, k) => t.replaceAll(k, "***"), text);
  // A non-empty target is only acceptable if it is the clone we made for this realization.
  const reused = isOurClone(dir, input.realizationId, remote);
  if (!reused) {
    if (!input.token) throw new CliError("no write token; set ARTYFACT_TOKEN for this command (shown once when work is started)");
    mkdirSync(dir, { recursive: true });
    git(io.cwd, ["clone", "--", remote, dir], assertToken(input.token));
  }

  const cfg: WorkspaceConfig = {
    platform: input.platform, systemId, evolutionId: input.evolutionId, realizationId: input.realizationId,
    forkRepo: assertId("fork repo", input.forkRepo), remote,
    tokenExpires: input.tokenExpires, packetHash: packet.hash, secret: input.secret,
    ...(input.taskId && { taskId: input.taskId }),
    ...(input.storeToken && { token: input.storeToken }),
  };
  // Per-realization files stay out of the fork: exclude them unless the repo already tracks them.
  if (isTracked(dir, "TASK_PACKET.md")) throw new CliError("TASK_PACKET.md is tracked in this repo; refusing to overwrite it");
  const agentsTracked = isTracked(dir, "AGENTS.md");
  const exclude = join(dir, ".git", "info", "exclude");
  mkdirSync(join(dir, ".git", "info"), { recursive: true });
  const existing = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  const have = new Set(existing.split("\n"));
  // Dependencies, Wrangler state, build output and local secrets stay out of the fork too (the scaffold's .gitignore says the same).
  const want = [CONFIG, "TASK_PACKET.md", ...(agentsTracked ? [] : ["AGENTS.md"]), ...WORKSPACE_IGNORES].filter((l) => !have.has(l));
  if (want.length) safeWrite(exclude, `${existing && !existing.endsWith("\n") ? "\n" : ""}${want.join("\n")}\n`, 0o644, true);
  safeWrite(join(dir, "TASK_PACKET.md"), scrub(packet.markdown ?? JSON.stringify(packet, null, 2)));
  const block = scrub(renderAgentsMd(packet, systemId));
  const agentsPath = join(dir, "AGENTS.md");
  safeWrite(agentsPath, agentsTracked ? mergeAgentsBlock(readFileSync(agentsPath, "utf8"), block) : block);
  safeWrite(join(dir, CONFIG), `${JSON.stringify(cfg, null, 2)}\n`, 0o600);
  return { reused };
}
