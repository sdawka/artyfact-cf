import { closeSync, constants, existsSync, fchmodSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";
import { integrityStatus, type IntegrityStatus } from "@artyfact/model";
import type {
  IntegrityAgreementRequest, IntegrityProviderChoice, IntegrityRun, IntegrityRunResponse,
  IntegritySnapshotResponse, StoredIntegritySnapshot,
} from "../../../apps/platform/shared/integrity.ts";
import { PlatformClient } from "./api.ts";
import { CliError, assertId, assertToken } from "./git.ts";
import { initCommand } from "./init.ts";
import type { Io } from "./main.ts";
import { resolvePlatform } from "./platform-url.ts";
import { realDir } from "./safety.ts";

const PROVIDERS = new Set<IntegrityProviderChoice>(["auto", "clef", "jev", "openrouter", "off"]);
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const MAX_FILES = 1000, MAX_FILE_BYTES = 1 << 20, MAX_REQUEST_BYTES = 1 << 20;
type Envelope = { snapshot: StoredIntegritySnapshot; run: IntegrityRun };

function parse(argv: string[]) {
  try {
    return parseArgs({ args: argv, allowPositionals: true, options: {
      system: { type: "string" }, genome: { type: "string" }, platform: { type: "string" }, provider: { type: "string" },
      model: { type: "string" }, "max-calls": { type: "string" }, run: { type: "string" }, json: { type: "boolean" },
      "no-wait": { type: "boolean" }, file: { type: "string" }, snapshot: { type: "string" }, dir: { type: "string" },
      "prepare-only": { type: "boolean" }, namespace: { type: "string" }, force: { type: "boolean" }, adopt: { type: "boolean" },
    } });
  } catch (error) { throw new CliError((error as Error).message); }
}

function jsonFile(path: string, io: Io): unknown {
  const absolute = resolve(io.cwd, path);
  if (!existsSync(absolute) || !lstatSync(absolute).isFile() || lstatSync(absolute).isSymbolicLink()) throw new CliError(`${path} is not a regular file`);
  try { return JSON.parse(readFileSync(absolute, "utf8")); }
  catch (error) { throw new CliError(`invalid JSON in ${path}: ${(error as Error).message}`); }
}

function writeFileNoFollow(path: string, data: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new CliError(`refusing to write through symlink: ${path}`);
  let fd: number;
  try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644); }
  catch (error) { throw new CliError(`cannot write ${path}: ${(error as Error).message}`); }
  try { writeSync(fd, data); fchmodSync(fd, 0o644); } finally { closeSync(fd); }
}

function envelopeFile(path: string, io: Io): Envelope {
  const value = jsonFile(path, io) as Partial<Envelope>;
  if (!value || typeof value !== "object" || !value.snapshot || !value.run) throw new CliError(`${path} is not an integrity snapshot envelope`);
  if (value.snapshot.hash !== value.run.snapshotHash || value.snapshot.id !== value.run.snapshotId) throw new CliError("snapshot envelope identity does not match its integrity run");
  return value as Envelope;
}

const safePath = (path: string) => !!path && !path.startsWith("/") && !path.includes("\\")
  && !path.split("/").some(segment => !segment || segment === "." || segment === ".." || segment === ".git" || segment.startsWith("."));

function validateFiles(files: unknown): [string, string][] {
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new CliError("integrity snapshot files must be a path-to-text object");
  const entries = Object.entries(files).sort(([left], [right]) => left.localeCompare(right));
  let total = 0;
  if (!entries.length || entries.length > MAX_FILES) throw new CliError("integrity snapshot has an unsafe file count");
  for (const [path, content] of entries) {
    if (typeof content !== "string") throw new CliError(`integrity snapshot file is not text: ${path}`);
    const bytes = Buffer.byteLength(content);
    total += bytes;
    if (!safePath(path) || bytes > MAX_FILE_BYTES) throw new CliError(`unsafe or oversized integrity snapshot path: ${path}`);
  }
  if (total > MAX_REQUEST_BYTES) throw new CliError("integrity snapshot exceeds the CLI request limit");
  const paths = new Set(entries.map(([path]) => path));
  if (entries.some(([path]) => path.split("/").slice(0, -1).some((_, i) => paths.has(path.split("/").slice(0, i + 1).join("/"))))) throw new CliError("integrity snapshot paths collide");
  return entries as [string, string][];
}

function readSnapshotFiles(directory: string): Record<string, string> {
  const root = realDir("--genome", directory);
  const files: Record<string, string> = {};
  const walk = (relative = "") => {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const rel = relative ? `${relative}/${name}` : name;
      const path = join(root, rel), stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new CliError(`refusing symlink in integrity snapshot: ${rel}`);
      if (stat.isDirectory()) { if (!name.startsWith(".")) walk(rel); continue; }
      const allowed = /\.ya?ml$/.test(rel) || rel === "intent/brief.md" || rel === "intent/manifest.json";
      if (!allowed) continue;
      files[rel] = readFileSync(path, "utf8");
    }
  };
  walk(); validateFiles(files); return files;
}

function statusOf(run: IntegrityRun): { status: IntegrityStatus; exitCode: 0 | 1 | 2 } {
  if (run.state === "failed") throw new CliError(`integrity run ${run.id} failed${run.error ? ` (${run.error.code}): ${run.error.message}` : ""}`);
  if (!run.report || run.state !== "completed") return { status: "needs-review", exitCode: 2 };
  const status = integrityStatus(run.report);
  return { status, exitCode: status === "passed" ? 0 : status === "blocked" ? 1 : 2 };
}

function printResult(io: Io, run: IntegrityRun, snapshot?: StoredIntegritySnapshot, json = false): number {
  const result = statusOf(run);
  if (json) io.out(JSON.stringify({ ...result, ...(snapshot && { snapshot }), run }, null, 2));
  else {
    io.out(`integrity: ${result.status} (${run.state}; automated result)`);
    if (run.report) io.out(`structural ${run.report.structural.status}; semantic ${run.report.semantic.status}; agreement ${run.agreement?.status ?? "pending"}`);
    else io.out("semantic integrity is incomplete; no passed result is available");
    io.out(`Review: ${run.reviewUrl}`);
  }
  return result.exitCode;
}

async function platform(io: Io, value?: string) {
  const token = io.env.ARTYFACT_ADMIN_TOKEN;
  if (!token) throw new CliError("ARTYFACT_ADMIN_TOKEN is required for this scoped administrative command");
  assertToken(token);
  const base = await resolvePlatform(value, io.env, io.fetch ?? fetch, io.err);
  return { base, client: new PlatformClient(base, token) };
}

export async function integrityCommand(argv: string[], io: Io): Promise<number> {
  const { positionals, values } = parse(argv), action = positionals[0];
  if (action === "materialize") {
    if (!values.file || !values.dir) throw new CliError("usage: artyfact ontology materialize --file agreed-snapshot.json --dir new-project [--prepare-only]");
    const source = envelopeFile(values.file, io), agreement = source.run.agreement;
    if (!agreement?.eligibility.eligible || !["accepted", "accepted-with-dispositions"].includes(agreement.status)) throw new CliError("snapshot materialization requires an eligible human agreement");
    if (source.run.state !== "completed" || !source.run.report || source.run.report.id !== agreement.reportId
      || source.run.report.snapshotHash !== source.snapshot.hash || agreement.eligibility.status !== agreement.status) throw new CliError("agreement envelope is incomplete or internally inconsistent");
    if (agreement.snapshotHash !== source.snapshot.hash) throw new CliError("agreement does not cover this exact snapshot");
    const entries = validateFiles(source.snapshot.files), dir = resolve(io.cwd, values.dir);
    if (existsSync(dir)) throw new CliError("materialize destination already exists; choose a new directory");
    const root = parseYaml(source.snapshot.files["node.yaml"] ?? "") as { id?: unknown } | null;
    if (root?.id !== source.snapshot.systemId) throw new CliError("snapshot Genome root does not match its System");
    mkdirSync(join(dir, "genome"), { recursive: true });
    for (const [path, content] of entries) { const target = join(dir, "genome", path); mkdirSync(dirname(target), { recursive: true }); writeFileNoFollow(target, content); }
    io.out(`Agreed snapshot ${source.snapshot.id} materialized exactly in ${dir}/genome`);
    if (values["prepare-only"]) { io.out("No repositories were provisioned and no source repository was invented."); return 0; }
    const initArgs = ["--dir", dir, "--integrity-run", source.run.id, ...(values.platform ? ["--platform", values.platform] : []), ...(values.namespace ? ["--namespace", values.namespace] : []), ...(values.force ? ["--force"] : []), ...(values.adopt ? ["--adopt"] : [])];
    return initCommand(initArgs, io);
  }

  const system = values.system;
  if (!system) throw new CliError("--system is required");
  assertId("system", system);
  const { client } = await platform(io, values.platform);
  const root = `/api/systems/${encodeURIComponent(system)}/integrity`;
  if (action === "check") {
    if (values.run) {
      const { run } = await client.request<IntegrityRunResponse>("GET", `${root}/runs/${encodeURIComponent(assertId("run", values.run))}`);
      return printResult(io, run, undefined, values.json);
    }
    if (!values.genome) throw new CliError("--genome is required when starting an integrity check");
    const provider = (values.provider ?? "auto") as IntegrityProviderChoice;
    if (!PROVIDERS.has(provider)) throw new CliError("--provider must be auto, clef, jev, openrouter or off");
    const maxCalls = values["max-calls"] === undefined ? undefined : Number(values["max-calls"]);
    if (maxCalls !== undefined && (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 500)) throw new CliError("--max-calls must be an integer from 1 to 500");
    const files = readSnapshotFiles(resolve(io.cwd, values.genome));
    const { snapshot } = await client.request<IntegritySnapshotResponse>("POST", `${root}/preview`, { files });
    const request = { snapshotId: snapshot.id, provider, ...(values.model && { model: values.model }), ...(maxCalls !== undefined && { budget: { maxCalls } }) };
    let { run } = await client.request<IntegrityRunResponse>("POST", `${root}/runs`, request);
    if (!values["no-wait"]) {
      const deadline = Date.now() + 10 * 60_000;
      while (!TERMINAL.has(run.state) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, io.pollMs ?? 1000));
        ({ run } = await client.request<IntegrityRunResponse>("GET", `${root}/runs/${encodeURIComponent(run.id)}`));
      }
    }
    return printResult(io, run, snapshot, values.json);
  }
  if (action === "agreement") {
    const runId = assertId("run", positionals[1]);
    if (!values.file || !values.snapshot) throw new CliError("--file dispositions.json and --snapshot snapshot.json are required");
    const raw = jsonFile(values.file, io) as IntegrityAgreementRequest | IntegrityAgreementRequest["dispositions"];
    const dispositions = Array.isArray(raw) ? raw : raw?.dispositions;
    if (!Array.isArray(dispositions)) throw new CliError("agreement file must be a dispositions array or {dispositions:[...]}");
    const envelope = envelopeFile(values.snapshot, io);
    if (envelope.run.id !== runId || envelope.snapshot.systemId !== system) throw new CliError("snapshot envelope does not match the requested System and run");
    const { run } = await client.request<IntegrityRunResponse>("POST", `${root}/runs/${encodeURIComponent(runId)}/agreement`, { dispositions });
    if (run.snapshotHash !== envelope.snapshot.hash) throw new CliError("agreement response does not cover the local exact snapshot");
    writeFileNoFollow(resolve(io.cwd, values.snapshot), `${JSON.stringify({ snapshot: envelope.snapshot, run }, null, 2)}\n`);
    if (values.json) io.out(JSON.stringify({ snapshot: envelope.snapshot, run }, null, 2));
    else { io.out(`agreement: ${run.agreement?.status ?? "pending"}`); io.out(`Review: ${run.reviewUrl}`); }
    return run.agreement?.eligibility.eligible ? 0 : 2;
  }
  throw new CliError("usage: artyfact ontology check|agreement|materialize");
}
