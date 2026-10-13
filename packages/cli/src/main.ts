import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PlatformClient, rzPath } from "./api.ts";
import { initCommand, platformSyncCommand, type InitIo } from "./init.ts";
import { DEFAULT_URL, resolvePlatform } from "./platform-url.ts";
import { CliError, assertId, assertRemote, assertSecret, assertToken, commitIfDirty, git } from "./git.ts";
import type { ConflictRow, EvaluationRow, PacketPayload, WorkspaceConfig } from "./types.ts";
import { partsCommand } from "./parts.ts";
import { convertGenomeCommand } from "./convert-genome.ts";
import { validateGenomeCommand } from "./validate-genome.ts";
import { skillCommand } from "./skill.ts";
import { tasksCommand, claimCommand } from "./tasks.ts";
import { CONFIG, isLink, materializeWorkspace, readPriorConfig, safeWrite } from "./workspace.ts";

export { safeWrite };

export interface Io extends Pick<InitIo, "cloud" | "fetch" | "root" | "pollMs"> {
  out: (s: string) => void;
  err: (s: string) => void;
  cwd: string;
  env: Record<string, string | undefined>;
}

const USAGE = `artyfact <command>

  init [--dir project] [--genome dir --app dir] [--from-template template.thing.<id>@<v>] [--platform url] [--namespace ns] [--force] [--adopt] [--genome-only] [--no-review]
        push <slug>.genome / <slug>.app and platform, then import the System (needs ARTYFACT_ADMIN_TOKEN, else prints the curl line);
        --genome-only pushes only the Genome and keeps the app repo's head (migrating a deployed System);
        --no-review skips the import review that otherwise gates Evolution work until it is accepted
  platform-sync [--namespace ns]   push packages/templates to the namespace's platform repo (no-op when unchanged)

  start <realizationId> [--dir d] [--platform url] --system sid --evolution eid   (or ARTYFACT_SYSTEM / ARTYFACT_EVOLUTION)
        needs ARTYFACT_TOKEN and ARTYFACT_SECRET from the platform's start-work response
  checkpoint "<message>"
  submit [--preview-url u] [--json]
  build-report --status queued|running|passed|failed|error [--url u] [--commit sha] [--logs-url u] [--error msg] [--json]
        report a preview build of this realization when platform CI did not (defaults: commit = HEAD)
  status [--json]
  tasks --system sid [--evolution eid] [--json] [--platform url]
        list the System's tasks (status, wave, dependencies, footprint), their conflicts and the first claim line (public)
  claim <taskId> --agent <label> [--system sid] [--dir d] [--role r] [--platform url]
        claim a task for a local agent and open its workspace (needs ARTYFACT_ADMIN_TOKEN); the same label re-claiming reuses the directory
  compose <rid> <rid> ...
  parts create|extract|validate|publish|compose|upgrade ...
  convert-genome <src> <dst> [--templates dir] [--source-map file]
        write the node-tree (v2) form of the v1 Genome in <src> into a new directory <dst>
        (templates default to the checkout's packages/templates)

  validate-genome <genomeDir> [--app dir] [--json] [--strict]
        load a Genome tree as the platform would, run readiness rules, and report app files no node maps
  skill [--dir project] [--write] [--agent claude|generic]
        print the artyfact-genome skill, or install it into a project for a local coding agent

  --platform defaults to ARTYFACT_PLATFORM, else ARTYFACT_URL, else the first of ${DEFAULT_URL} and the next nine
  ports whose /api/health identifies as artyfact; with none, the command stops (credentials never go elsewhere).
`;

export async function main(argv: string[], io?: Partial<Io>): Promise<number> {
  const full: Io = {
    out: io?.out ?? ((s) => process.stdout.write(`${s}\n`)),
    err: io?.err ?? ((s) => process.stderr.write(`${s}\n`)),
    cwd: io?.cwd ?? process.cwd(),
    env: io?.env ?? process.env,
    cloud: io?.cloud, fetch: io?.fetch, root: io?.root, pollMs: io?.pollMs,
  };
  try {
    const [cmd, ...rest] = argv;
    switch (cmd) {
      case "init": return await initCommand(rest, full);
      case "platform-sync": return await platformSyncCommand(rest, full);
      case "start": return await start(rest, full);
      case "checkpoint": return await checkpoint(rest, full);
      case "submit": return await submit(rest, full);
      case "build-report": return await buildReport(rest, full);
      case "status": return await status(rest, full);
      case "compose": return compose(rest, full);
      case "parts": return await partsCommand(rest, full);
      case "convert-genome": return convertGenomeCommand(rest, full);
      case "validate-genome": return validateGenomeCommand(rest, full);
      case "skill": return skillCommand(rest, full);
      case "tasks": return await tasksCommand(rest, full);
      case "claim": return await claimCommand(rest, full);
      case undefined: case "help": case "--help": full.out(USAGE); return cmd ? 0 : 1;
      default: throw new CliError(`unknown command '${cmd}'\n${USAGE}`);
    }
  } catch (e) {
    full.err(`artyfact: ${(e as Error).message}`);
    return 1;
  }
}

function parse(args: string[], options: Record<string, { type: "string" | "boolean" }>) {
  try {
    const r = parseArgs({ args, options, allowPositionals: true });
    return { values: r.values as Record<string, string | undefined> & { json?: boolean }, positionals: r.positionals };
  } catch (e) {
    throw new CliError((e as Error).message);
  }
}

function readConfig(io: Io): { cfg: WorkspaceConfig; dir: string } {
  const dir = resolve(io.cwd);
  const file = join(dir, CONFIG);
  if (isLink(file)) throw new CliError(`refusing to read symlinked ${CONFIG}`);
  if (!existsSync(file)) throw new CliError(`${CONFIG} not found in ${dir}; run 'artyfact start <realizationId>' first`);
  let cfg: WorkspaceConfig;
  try {
    cfg = JSON.parse(readFileSync(file, "utf8")) as WorkspaceConfig;
  } catch (e) {
    throw new CliError(`invalid ${CONFIG}: ${(e as Error).message}`);
  }
  assertId("systemId in config", cfg.systemId);
  assertId("realizationId in config", cfg.realizationId);
  assertId("evolutionId in config", cfg.evolutionId);
  assertRemote("remote in config", cfg.remote, io.env);
  return { cfg, dir };
}

/** `ARTYFACT_SECRET` overrides the secret saved in `.artyfact.json`. */
function secretFor(io: Io, cfg?: WorkspaceConfig): string {
  const s = io.env.ARTYFACT_SECRET || cfg?.secret;
  if (!s) throw new CliError("no realization secret; set ARTYFACT_SECRET (shown once when work is started)");
  return assertSecret(s);
}

/** A client that authenticates as this realization. */
const clientFor = (io: Io, cfg: WorkspaceConfig) => new PlatformClient(cfg.platform, secretFor(io, cfg));

function tokenFor(io: Io, cfg?: WorkspaceConfig): string {
  const t = io.env.ARTYFACT_TOKEN || cfg?.token;
  if (!t) throw new CliError("no write token; set ARTYFACT_TOKEN for this command (only `claim` stores one on disk)");
  return assertToken(t);
}

async function start(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(args, {
    dir: { type: "string" }, platform: { type: "string" }, system: { type: "string" }, evolution: { type: "string" },
  });
  const rid = positionals[0] && assertId("realization id", positionals[0]);
  if (!rid) throw new CliError("usage: artyfact start <realizationId> [--dir <d>]")  ;
  const sysArg = values.system ?? io.env.ARTYFACT_SYSTEM;
  const evoArg = values.evolution ?? io.env.ARTYFACT_EVOLUTION;
  if (!sysArg || !evoArg)
    throw new CliError("--system and --evolution (or ARTYFACT_SYSTEM / ARTYFACT_EVOLUTION) are required; the platform's printed CLI line includes them");
  const sysId = assertId("system id", sysArg);
  const evoId = assertId("evolution id", evoArg);
  const dir = resolve(io.cwd, values.dir ?? rid);
  if (isLink(dir)) throw new CliError(`refusing symlinked directory: ${dir}`);
  const priorCfg = readPriorConfig(dir) as WorkspaceConfig | undefined;
  const secret = secretFor(io, priorCfg?.realizationId === rid ? priorCfg : undefined);
  const platform = await resolvePlatform(values.platform, io.env, io.fetch ?? fetch, io.err);
  const client = new PlatformClient(platform, secret);

  const payload = await client.request<PacketPayload>("GET", rzPath(sysId, evoId, rid, "/packet"));
  const packet = payload.packet;
  const systemId = sysId;
  const remote = assertRemote("workspace.remote", packet.workspace?.remote ?? payload.remote ?? payload.token?.remote, io.env);
  const forkRepo = assertId("fork repo", packet.workspace?.fork ?? payload.realization?.workspace?.fork);
  const realizationId = assertId("realization id", packet.realizationId ?? payload.realization?.id ?? rid);
  // The platform must not ship credentials in the packet; drop any that slip through before writing to disk.
  const leaked = [(packet.workspace as { token?: string } | undefined)?.token, payload.token?.value].filter((x): x is string => !!x);
  if (packet.workspace) {
    delete (packet.workspace as { token?: string }).token;
    delete packet.workspace.secret;
  }
  const token = io.env.ARTYFACT_TOKEN || leaked[0];
  if (!token) throw new CliError("no write token; set ARTYFACT_TOKEN for this command (shown once when work is started)");
  assertToken(token);
  const secrets = [...leaked, io.env.ARTYFACT_TOKEN, secret].filter((x): x is string => !!x);

  materializeWorkspace(io, {
    dir, platform, systemId, evolutionId: evoId, realizationId, forkRepo, remote, packet, token, secret, secrets,
    tokenExpires: payload.realization?.workspace?.tokenExpiresAt ?? payload.token?.expiresAt,
  });

  io.out(`Workspace ready in ${dir}`);
  io.out(`Next: cd ${dir} && read TASK_PACKET.md, then npm install && npm run dev`);
  io.out(`Checkpoint with 'npx artyfact checkpoint "<msg>"'; finish with 'npx artyfact submit'.`);
  return 0;
}

async function checkpoint(args: string[], io: Io): Promise<number> {
  const { positionals } = parse(args, {});
  const message = positionals[0];
  if (!message) throw new CliError('usage: artyfact checkpoint "<message>"');
  const { cfg, dir } = readConfig(io);
  const client = clientFor(io, cfg);
  const commit = commitIfDirty(dir, message, io.err);
  await client.request("POST", rzPath(cfg.systemId, cfg.evolutionId, cfg.realizationId, "/checkpoints"), { message, summary: message, commit });
  io.out(`Checkpoint recorded at ${commit.slice(0, 12)}`);
  return 0;
}

interface SubmitPayload { evaluations?: EvaluationRow[]; conflicts?: ConflictRow[]; candidate?: unknown }

function table(rows: EvaluationRow[]): string {
  const head = ["criterion", "verdict", "execution"];
  const body = rows.map((r) => [r.criterion, r.verdict, r.execution]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
  const line = (c: string[]) => c.map((x, i) => x.padEnd(w[i]!)).join("  ").trimEnd();
  return [line(head), ...body.map(line)].join("\n");
}

function printEvals(io: Io, evaluations: EvaluationRow[], conflicts: ConflictRow[]) {
  io.out(evaluations.length ? table(evaluations) : "No evaluations yet.");
  for (const c of conflicts) io.out(`conflict [${c.kind}] ${c.subjects.join(", ")}: ${c.message}`);
}

async function submit(args: string[], io: Io): Promise<number> {
  const { values } = parse(args, { "preview-url": { type: "string" }, json: { type: "boolean" } });
  const { cfg, dir } = readConfig(io);
  const token = tokenFor(io, cfg);
  if (!io.env.ARTYFACT_TOKEN && cfg.tokenExpires && Date.parse(cfg.tokenExpires) < Date.now())
    io.err(`note: the stored write token expired at ${cfg.tokenExpires}; set ARTYFACT_TOKEN if the push is refused`);
  const client = clientFor(io, cfg);
  const commit = commitIfDirty(dir, "artyfact submit", io.err);
  git(dir, ["push", "--", cfg.remote, "HEAD:main"], token);
  const body: { commit: string; previewUrl?: string } = { commit };
  if (values["preview-url"]) body.previewUrl = values["preview-url"];
  const res = await client.request<SubmitPayload>(
    "POST", rzPath(cfg.systemId, cfg.evolutionId, cfg.realizationId, "/submit"), body);
  if (values.json) { io.out(JSON.stringify(res, null, 2)); return 0; }
  io.out(`Submitted ${commit.slice(0, 12)}`);
  printEvals(io, res.evaluations ?? [], res.conflicts ?? []);
  return 0;
}

const BUILD_STATUSES = ["queued", "running", "passed", "failed", "error"];
const HTTP_URL = /^https?:\/\/[^\s]+$/;

/** The agent's fallback for platform CI: report this realization's preview build (a `passed` URL re-runs the hooks). */
async function buildReport(args: string[], io: Io): Promise<number> {
  const { values } = parse(args, {
    status: { type: "string" }, url: { type: "string" }, commit: { type: "string" }, "logs-url": { type: "string" }, error: { type: "string" }, json: { type: "boolean" },
  });
  const status = values.status;
  if (!status || !BUILD_STATUSES.includes(status)) throw new CliError(`--status must be one of ${BUILD_STATUSES.join(", ")}`);
  for (const k of ["url", "logs-url"] as const) {
    if (values[k] !== undefined && !HTTP_URL.test(values[k]!)) throw new CliError(`--${k} must be an http(s) URL`);
  }
  if (status === "passed" && !values.url) io.err("note: a passed report without --url records the build but cannot run the preview health check");
  const { cfg, dir } = readConfig(io);
  const commit = values.commit ?? git(dir, ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new CliError("--commit must be a 40-character hex sha");
  const body: Record<string, string> = { status, commit, kind: "preview" };
  if (values.url) body.url = values.url;
  if (values["logs-url"]) body.logsUrl = values["logs-url"];
  if (values.error) body.error = values.error.slice(0, 4000);
  const res = await clientFor(io, cfg).request<{ build?: { id?: string; status?: string }; evaluations?: EvaluationRow[] }>(
    "POST", `/api/systems/${encodeURIComponent(cfg.systemId)}/realizations/${encodeURIComponent(cfg.realizationId)}/builds`, body);
  if (values.json) { io.out(JSON.stringify(res, null, 2)); return 0; }
  io.out(`Build ${res.build?.id ?? "?"} for ${commit.slice(0, 12)}: ${res.build?.status ?? status}`);
  if (res.evaluations) printEvals(io, res.evaluations, []);
  return 0;
}

async function status(args: string[], io: Io): Promise<number> {
  const { values } = parse(args, { json: { type: "boolean" } });
  const { cfg } = readConfig(io);
  const res = await clientFor(io, cfg).request<{
    realization?: { status?: string; workspace?: { tokenExpiresAt?: string } };
    status?: string; evaluations?: EvaluationRow[]; conflicts?: ConflictRow[];
  }>("GET", rzPath(cfg.systemId, cfg.evolutionId, cfg.realizationId));
  const out = {
    realizationId: cfg.realizationId,
    status: res.realization?.status ?? res.status ?? "unknown",
    evaluations: res.evaluations ?? [],
    conflicts: res.conflicts ?? [],
    tokenExpires: res.realization?.workspace?.tokenExpiresAt ?? cfg.tokenExpires ?? null,
  };
  if (values.json) { io.out(JSON.stringify(out, null, 2)); return 0; }
  io.out(`${out.realizationId}: ${out.status}`);
  if (cfg.taskId) io.out(`task: ${cfg.taskId}`);
  if (out.tokenExpires) io.out(`token expires: ${out.tokenExpires}`);
  printEvals(io, out.evaluations, out.conflicts);
  return 0;
}

function compose(args: string[], io: Io): number {
  if (args.length < 2) throw new CliError("usage: artyfact compose <rid> <rid> ...");
  io.out(`'compose' is not implemented yet. Manual merge steps for ${args.join(", ")}:
  1. artyfact start ${args[0]} --dir ./compose   (base workspace)
  2. In ./compose: git remote add other <fork-remote-of-second-realization>; git fetch other
  3. git merge other/main   (resolve conflicts, keeping acceptance criteria satisfied)
  4. npm test, then 'npx artyfact submit' to submit the composed result.`);
  return 0;
}
