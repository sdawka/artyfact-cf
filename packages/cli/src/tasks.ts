/** `artyfact tasks` and `artyfact claim`: the local-agent task loop (backend.md B.9). */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { PlatformClient, PlatformError } from "./api.ts";
import { CliError, assertId, assertSecret } from "./git.ts";
import { assertBearerTransport, resolvePlatform } from "./platform-url.ts";
import type { Io } from "./main.ts";
import type { ClaimPayload, TaskRow, TasksPayload, WorkspaceConfig } from "./types.ts";
import { isLink, materializeWorkspace, readPriorConfig } from "./workspace.ts";

// TODO(contract): mirrors routes.tasks / routes.claimTask in apps/platform/shared/api.ts (not importable from this package).
const tasksRoute = (sid: string, q: { status?: string; evolution?: string } = {}) => {
  const qs = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1])).toString();
  return `/api/systems/${encodeURIComponent(sid)}/tasks${qs ? `?${qs}` : ""}`;
};
const claimRoute = (sid: string, tid: string) => `/api/systems/${encodeURIComponent(sid)}/tasks/${encodeURIComponent(tid)}/claim`;

function parse(args: string[], options: Record<string, { type: "string" | "boolean" }>) {
  try {
    const r = parseArgs({ args, options, allowPositionals: true });
    return { values: r.values as Record<string, string | undefined> & { json?: boolean }, positionals: r.positionals };
  } catch (e) {
    throw new CliError((e as Error).message);
  }
}

function systemOf(values: Record<string, string | undefined>, io: Io): string {
  const sid = values.system ?? io.env.ARTYFACT_SYSTEM ?? (readPriorConfig(resolve(io.cwd)) as WorkspaceConfig | undefined)?.systemId;
  if (!sid) throw new CliError("--system (or ARTYFACT_SYSTEM) is required");
  return assertId("system id", sid);
}

function renderTable(head: string[], body: string[][]): string[] {
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
  const line = (c: string[]) => c.map((x, i) => x.padEnd(w[i]!)).join("  ").trimEnd();
  return [line(head), ...body.map(line)];
}

const list = (xs: string[] | undefined) => (xs?.length ? xs.join(",") : "-");

const footprintOf = (t: TaskRow) => list(t.footprint?.globs);

/** The first planned task nothing blocks: waves run in order, so the lowest wave wins. */
function firstClaimable(tasks: TaskRow[]): TaskRow | undefined {
  return tasks
    .filter((t) => t.status === "planned" && !t.blockedOn.length)
    .sort((a, b) => (a.wave ?? Infinity) - (b.wave ?? Infinity))[0];
}

export async function tasksCommand(args: string[], io: Io): Promise<number> {
  const { values } = parse(args, { system: { type: "string" }, evolution: { type: "string" }, status: { type: "string" }, platform: { type: "string" }, json: { type: "boolean" } });
  const sid = systemOf(values, io);
  const evolution = values.evolution && assertId("evolution id", values.evolution);
  const platform = await resolvePlatform(values.platform, io.env, io.fetch ?? fetch, io.err);
  const res = await new PlatformClient(platform).request<TasksPayload>("GET", tasksRoute(sid, { evolution: evolution || undefined, status: values.status }));
  if (values.json) { io.out(JSON.stringify(res, null, 2)); return 0; }
  if (!res.tasks.length) { io.out("No tasks. Plan an Evolution first (Work view, or POST .../evolutions/:eid/plan)."); return 0; }
  io.out(renderTable(
    ["task", "evolution", "status", "wave", "depends-on", "nodes", "footprint"],
    res.tasks.map((t) => [t.id, t.evolutionId, t.status, t.wave == null ? "-" : String(t.wave), list(t.dependsOn), list(t.nodes), footprintOf(t)]),
  ).join("\n"));
  for (const c of res.conflicts) io.out(`conflicts: ${c.tasks.join(" <-> ")} [${c.kind}] ${c.subjects.join(", ")}: ${c.message}`);
  const next = firstClaimable(res.tasks);
  if (next) io.out(`claim: npx artyfact claim ${next.id} --system ${sid} --agent "claude:${next.id}" --dir ./work/${next.id}`);
  return 0;
}

export async function claimCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(args, {
    agent: { type: "string" }, system: { type: "string" }, dir: { type: "string" }, role: { type: "string" }, platform: { type: "string" },
  });
  const tid = positionals[0] && assertId("task id", positionals[0]);
  if (!tid) throw new CliError('usage: artyfact claim <taskId> --agent <label> [--system sid] [--dir d] [--role r]');
  const agentLabel = values.agent?.trim();
  if (!agentLabel) throw new CliError("--agent <label> is required (for example --agent \"claude:t1\")");
  const sid = systemOf(values, io);
  const admin = io.env.ARTYFACT_ADMIN_TOKEN;
  if (!admin) throw new CliError("claiming a task needs ARTYFACT_ADMIN_TOKEN (the platform admin token); set it for this command");
  const dir = resolve(io.cwd, values.dir ?? tid);
  if (isLink(dir)) throw new CliError(`refusing symlinked directory: ${dir}`);
  const platform = await resolvePlatform(values.platform, io.env, io.fetch ?? fetch, io.err);
  assertBearerTransport(platform, "ARTYFACT_ADMIN_TOKEN");

  let res: ClaimPayload;
  try {
    res = await new PlatformClient(platform, admin).request<ClaimPayload>("POST", claimRoute(sid, tid), {
      agentLabel, ...(values.role && { role: values.role }),
    });
  } catch (e) {
    throw claimError(e, tid);
  }

  const { packet, realization } = res;
  const rid = assertId("realization id", realization.id);
  const prior = readPriorConfig(dir);
  // Credentials are issued once; a repeat claim by the same label has none and relies on the clone we already made.
  const secret = res.secret ?? (prior?.realizationId === rid ? prior.secret : undefined) ?? io.env.ARTYFACT_SECRET;
  if (!secret) throw new CliError(`task ${tid} is already claimed by ${agentLabel}, but ${dir} holds no workspace for it (credentials are issued once); release the task and claim again`);
  assertSecret(secret);
  const leaked = [(packet.workspace as { token?: string } | undefined)?.token, res.token?.value].filter((x): x is string => !!x);
  if (packet.workspace) {
    delete (packet.workspace as { token?: string }).token;
    delete packet.workspace.secret;
  }
  const { reused } = materializeWorkspace(io, {
    dir, platform, systemId: sid,
    evolutionId: assertId("evolution id", packet.evolutionId ?? realization.evolutionId),
    realizationId: rid,
    forkRepo: (packet.workspace?.fork ?? realization.workspace?.fork) as string,
    remote: (packet.workspace?.remote ?? res.remote ?? res.token?.remote) as string,
    packet, token: res.token?.value ?? io.env.ARTYFACT_TOKEN, secret,
    secrets: [...leaked, io.env.ARTYFACT_TOKEN, io.env.ARTYFACT_ADMIN_TOKEN, secret].filter((x): x is string => !!x),
    tokenExpires: res.token?.expiresAt ?? realization.workspace?.tokenExpiresAt ?? prior?.tokenExpires,
    taskId: tid,
    storeToken: res.token?.value ?? (prior?.realizationId === rid ? prior.token : undefined),
  });

  io.out(`${res.fresh ? "Claimed" : "Already claimed"} ${tid} as ${agentLabel}`);
  io.out(`Workspace ${reused ? "reused" : "ready"} in ${dir}`);
  io.out(`Next: cd ${dir} && read AGENTS.md and TASK_PACKET.md, then npm install; finish with 'npx artyfact submit'.`);
  return 0;
}

/** Turn the claim route's 409s into the one-line messages the loop prints. */
function claimError(e: unknown, tid: string): unknown {
  if (!(e instanceof PlatformError) || e.status !== 409) return e;
  const d = (e.details ?? {}) as { blockedOn?: unknown; by?: unknown };
  if (e.code === "task-blocked") {
    const on = Array.isArray(d.blockedOn) ? d.blockedOn.filter((x): x is string => typeof x === "string") : [];
    return new CliError(on.length ? `blocked by ${on.join(", ")} (not yet promoted)` : `blocked: ${e.detail ?? "a dependency is not yet promoted"}`);
  }
  if (e.code === "task-taken") {
    const who = typeof d.by === "string" ? d.by : undefined;
    return new CliError(who ? `task ${tid} is claimed by ${who}` : `task ${tid} is claimed${e.detail ? `: ${e.detail}` : ""}`);
  }
  return e;
}
