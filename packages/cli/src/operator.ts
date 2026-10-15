import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { cloudCli, spawnExec, wranglerCommand, type Cloud } from "./cloud.ts";
import { canonicalJson, normalizeVerificationRequest, type VerificationOutput, type VerificationRequest, type VerificationResult } from "@artyfact/model";
import { CliError, git, isPristine } from "./git.ts";
import { assertName } from "./safety.ts";
import { assertBearerTransport, resolvePlatform } from "./platform-url.ts";
import { BUILDS_REPO, WORKERS, modelDigestAt } from "./release.ts";

const DEFAULT_NS = "artyfact";
const DEFAULT_ARTIFACT = "artifact.platform";
const MAX_ARCHIVE = 64 * 1024 * 1024;
const MAX_EXTRACTED = 256 * 1024 * 1024;
const IDENTITY = ["-c", "user.name=artyfact", "-c", "user.email=artyfact@localhost"];
const HEX64 = /^[0-9a-f]{64}$/;
const SYSTEM_COMMIT = /^sc-[1-9][0-9]*-[0-9a-f]{8}$/;
const WORKER_ENV = [
  "ADMIN_TOKEN", "VERIFICATION_URL", "VERIFICATION_TOKEN", "S1_PROVIDER", "TYPESAFE_API_KEY", "JEV_MODEL", "CLEF_MODEL",
  "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "TRANSLATE", "OPENROUTER_TRANSLATE_MODEL", "OPENROUTER_PLAN_MODEL", "ALLOW_LOCAL_PREVIEW",
  "CI_REPORT_TOKEN", "CF_API_TOKEN", "OPERATIONS_BINDINGS", "OPERATIONS_API_TOKEN", "EVENTS_QUEUE_ID",
] as const;
const OPERATOR_ENV = new Set<string>(["ARTYFACT_ADMIN_TOKEN", ...WORKER_ENV, "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);
const CHILD_ENV = new Set(["PATH", "HOME", "USER", "SHELL", "TMPDIR", "LANG", "TERM"]);
const MAX_VARS_FILE = 64 * 1024;
/** Longer than artyfact-ci's own no-progress bound, after which it reports a stuck run as `error`. */
const VERIFY_TIMEOUT_MS = 3 * 60 * 60 * 1000;

/** The ambient environment pnpm in the approved checkout gets: an allowlist, never an operator credential. */
export function childEnv(base: NodeJS.ProcessEnv, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base))
    if (value !== undefined && !OPERATOR_ENV.has(key) && (CHILD_ENV.has(key) || key.startsWith("NODE_") || key.startsWith("npm_config_"))) out[key] = value;
  return { ...out, ...extra };
}

export interface Activation {
  systemId: string; planId: string; systemCommit: string;
  source: VerificationRequest["source"];
  genome: VerificationRequest["genome"];
  verification: VerificationResult;
}

export interface OperatorIo {
  out: (s: string) => void;
  err: (s: string) => void;
  cwd: string;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  cloud?: Cloud;
  pollMs?: number;
  verifyTimeoutMs?: number;
  install?: (checkout: string) => void;
  run?: (checkout: string, args: string[], env: NodeJS.ProcessEnv) => number;
}

const string = (v: unknown, what: string): string => {
  if (typeof v !== "string" || !v) throw new CliError(`invalid ${what} in platform response`);
  return v;
};
const object = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new CliError(`invalid ${what} in platform response`);
  return v as Record<string, unknown>;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function validateActivation(raw: unknown, expected: { systemId: string; planId: string; artifactId: string }): Activation {
  const a = object(raw, "activation");
  if (string(a.systemId, "activation systemId") !== expected.systemId || string(a.planId, "activation planId") !== expected.planId)
    throw new CliError("activation identity does not match the requested System and plan");
  const systemCommit = string(a.systemCommit, "activation systemCommit");
  if (!SYSTEM_COMMIT.test(systemCommit)) throw new CliError("activation systemCommit must be a canonical sc-<sequence>-<hash> id");
  const verification = validatePassedVerification(object(a.verification, "activation verification"), expected);
  if (!same(verification.request.source, a.source) || !same(verification.request.genome, a.genome))
    throw new CliError("activation provenance does not match its verification request");
  return { systemId: expected.systemId, planId: expected.planId, systemCommit, source: verification.request.source, genome: verification.request.genome, verification };
}

export function verifiedReleaseIdentity(a: Activation): string {
  return createHash("sha256").update(canonicalJson({ systemId: a.systemId, planId: a.planId, systemCommit: a.systemCommit,
    source: a.source, genome: a.genome, verification: a.verification })).digest("hex");
}

function octal(buf: Buffer, start: number, length: number, what: string): number {
  const raw = buf.subarray(start, start + length).toString("ascii").replace(/\0.*$/, "").trim();
  if (!/^[0-7]*$/.test(raw)) throw new CliError(`invalid tar ${what}`);
  const n = raw ? Number.parseInt(raw, 8) : 0;
  if (!Number.isSafeInteger(n) || n < 0) throw new CliError(`invalid tar ${what}`);
  return n;
}

function tarName(header: Buffer): string {
  const field = (s: number, n: number) => header.subarray(s, s + n).toString("utf8").replace(/\0.*$/, "");
  const name = field(0, 100), prefix = field(345, 155);
  return prefix ? `${prefix}/${name}` : name;
}

function safeArchivePath(name: string): string {
  if (!name || name.includes("\\") || name.startsWith("/") || name.includes("\0")) throw new CliError(`unsafe archive path: ${JSON.stringify(name)}`);
  const parts = name.replace(/\/$/, "").split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || p.startsWith("."))) throw new CliError(`unsafe archive path: ${name}`);
  const clean = parts.join("/");
  if (!(clean === "platform" || clean === "site" || clean === "site/dist" || clean === "site/wrangler.jsonc" || clean.startsWith("platform/") || clean.startsWith("site/dist/")))
    throw new CliError(`unexpected verification output path: ${clean}`);
  return clean;
}

/** Verify compressed digest and every tar header/path/type before writing into a fresh destination. */
export function importVerificationArchive(bytes: Buffer, expected: VerificationOutput, dest: string): void {
  if (bytes.length !== expected.size || bytes.length > MAX_ARCHIVE) throw new CliError("verification output size does not match trusted evidence");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expected.digest) throw new CliError("verification output digest does not match trusted evidence");
  let tar: Buffer;
  try { tar = gunzipSync(bytes, { maxOutputLength: MAX_EXTRACTED }); }
  catch (e) { throw new CliError(`verification output is not a bounded gzip archive: ${(e as Error).message}`); }
  const entries: { path: string; directory: boolean; bytes: Buffer }[] = [];
  const seen = new Set<string>();
  let offset = 0, total = 0, zeroBlocks = 0;
  while (offset + 512 <= tar.length) {
    const h = tar.subarray(offset, offset + 512); offset += 512;
    if (h.every((b) => b === 0)) { zeroBlocks++; if (zeroBlocks === 2) break; continue; }
    zeroBlocks = 0;
    const stored = octal(h, 148, 8, "checksum");
    const copy = Buffer.from(h); copy.fill(0x20, 148, 156);
    if ([...copy].reduce((n, b) => n + b, 0) !== stored) throw new CliError("verification output has an invalid tar checksum");
    const path = safeArchivePath(tarName(h));
    if (seen.has(path)) throw new CliError(`duplicate verification output path: ${path}`);
    seen.add(path);
    const size = octal(h, 124, 12, "entry size");
    const type = h[156] === 0 ? "0" : String.fromCharCode(h[156]!);
    if (type !== "0" && type !== "5") throw new CliError(`verification output contains unsupported entry type ${JSON.stringify(type)} at ${path}`);
    if (["platform", "site", "site/dist"].includes(path) && type !== "5") throw new CliError(`verification output root must be a directory: ${path}`);
    if (type === "5" && size !== 0) throw new CliError(`verification output directory has data: ${path}`);
    if (offset + size > tar.length) throw new CliError(`verification output is truncated at ${path}`);
    total += size;
    if (total > MAX_EXTRACTED) throw new CliError("verification output expands beyond the safe size limit");
    entries.push({ path, directory: type === "5", bytes: Buffer.from(tar.subarray(offset, offset + size)) });
    offset += Math.ceil(size / 512) * 512;
  }
  if (zeroBlocks < 2) throw new CliError("verification output tar is not terminated");
  for (const required of WORKERS.flatMap((w) => w.expect.map((p) => w.to === "site/dist" ? `site/dist/${p}` : `platform/${p}`)).concat("site/wrangler.jsonc"))
    if (!seen.has(required)) throw new CliError(`verification output is incomplete: missing ${required}`);
  if (existsSync(dest) && readdirSync(dest).length) throw new CliError(`verification import destination is not empty: ${dest}`);
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  for (const e of entries) {
    const target = join(dest, ...e.path.split("/"));
    if (e.directory) mkdirSync(target, { recursive: true, mode: 0o755 });
    else { mkdirSync(dirname(target), { recursive: true, mode: 0o755 }); writeFileSync(target, e.bytes, { mode: 0o644, flag: "wx" }); }
  }
}

async function request(fetcher: typeof fetch, base: string, token: string, method: string, path: string, body?: unknown): Promise<Response> {
  let response: Response;
  try { response = await fetcher(`${base.replace(/\/$/, "")}${path}`, { method, redirect: "error", signal: AbortSignal.timeout(120_000), headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (e) { throw new CliError(`cannot reach platform at ${base}: ${(e as Error).message}`); }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new CliError(`${method} ${path} -> ${response.status}${detail ? ` ${detail}` : ""}`);
  }
  return response;
}

async function jsonRequest(fetcher: typeof fetch, base: string, token: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await request(fetcher, base, token, method, path, body);
  try { return await response.json(); } catch { throw new CliError(`${method} ${path} returned invalid JSON`); }
}

const paths = (systemId: string, planId: string, artifactId: string) => {
  const base = `/api/systems/${encodeURIComponent(systemId)}/realization-plans/${encodeURIComponent(planId)}`;
  const query = `?artifactId=${encodeURIComponent(artifactId)}`;
  return { start: `${base}/verification/start`, poll: `${base}/verification/poll`, activation: `${base}/activation${query}`, output: `${base}/verification/output${query}` };
};

function verificationOf(raw: unknown): VerificationResult {
  const r = object(raw, "verification result");
  return (r.verification && typeof r.verification === "object" ? r.verification : r) as unknown as VerificationResult;
}

function validatePassedVerification(raw: unknown, expected: { systemId: string; planId: string; artifactId: string }): VerificationResult {
  const verification = object(raw, "verification result") as unknown as VerificationResult;
  if (verification.version !== 1 || verification.status !== "passed") throw new CliError("verification is not a passed version 1 result");
  let request: VerificationRequest;
  try { request = normalizeVerificationRequest(verification.request); }
  catch (e) { throw new CliError(`invalid verification request: ${(e as Error).message}`); }
  if (request.systemId !== expected.systemId || request.planId !== expected.planId || request.artifactId !== expected.artifactId)
    throw new CliError("verification identity does not match the requested System, plan, and artifact");
  assertName("source repo", request.source.repo);
  assertName("Genome repo", request.genome.repo);
  if (!Array.isArray(verification.steps) || !verification.steps.length || verification.steps.some((step) => object(step, "verification step").status !== "passed"))
    throw new CliError("verification does not carry successful step evidence");
  string(verification.finishedAt, "verification finishedAt");
  const output = object(verification.output, "verification output") as unknown as VerificationOutput;
  if (!HEX64.test(string(output.digest, "output digest")) || !Number.isSafeInteger(output.size) || output.size < 1 || output.size > MAX_ARCHIVE)
    throw new CliError("verification output is invalid or too large");
  string(output.key, "output key");
  return verification;
}

interface VerifiedManifest {
  version: string; identity: string; systemId: string; planId: string; systemCommit: string;
  source: Activation["source"]; genome: Activation["genome"]; verification: VerificationResult;
  workers: Record<string, { config: string }>;
}

export function publishVerifiedRelease(stage: string, activation: Activation, io: OperatorIo, ns = DEFAULT_NS): { version: string; buildsCommit: string; action: "created" | "reused" } {
  const cloud = io.cloud ?? cloudCli(spawnExec(io.cwd), io.env, wranglerCommand(io.cwd));
  cloud.account();
  const namespace = assertName("namespace", ns);
  const identity = verifiedReleaseIdentity(activation);
  const version = `verified-${identity.slice(0, 24)}`;
  const exists = cloud.repoExists(namespace, BUILDS_REPO);
  if (!exists) cloud.createRepo(namespace, BUILDS_REPO);
  const token = cloud.token(namespace, BUILDS_REPO, "write");
  const remote = cloud.remote(namespace, BUILDS_REPO);
  const parent = mkdtempSync(join(tmpdir(), "artyfact-verified-release-"));
  const checkout = join(parent, "repo");
  try {
    git(parent, ["clone", "-q", "--depth=1", "--", remote, checkout], token);
    const tagged = git(checkout, ["ls-remote", "--tags", "--", remote, `refs/tags/${version}`], token);
    if (tagged) {
      git(checkout, ["fetch", "-q", "--depth=1", "--", remote, `refs/tags/${version}:refs/tags/${version}`], token);
      git(checkout, ["checkout", "-q", "--detach", `refs/tags/${version}`]);
      const manifest = JSON.parse(readFileSync(join(checkout, "release.json"), "utf8")) as VerifiedManifest;
      if (manifest.identity !== identity) throw new CliError(`existing ${version} has mismatched immutable provenance`);
      if (stagedTree(checkout, stage, join(parent, "verify.index")) !== git(checkout, ["rev-parse", "HEAD^{tree}"]))
        throw new CliError(`existing ${version} does not hold the verified output; refusing to reuse it`);
      return { version, buildsCommit: git(checkout, ["rev-parse", "HEAD"]), action: "reused" };
    }
    for (const e of readdirSync(checkout)) if (e !== ".git") rmSync(join(checkout, e), { recursive: true, force: true });
    for (const e of readdirSync(stage)) writeFileOrTree(join(stage, e), join(checkout, e));
    const manifest: VerifiedManifest = { version, identity, systemId: activation.systemId, planId: activation.planId,
      systemCommit: activation.systemCommit, source: activation.source, genome: activation.genome, verification: activation.verification,
      workers: Object.fromEntries(WORKERS.map((w) => [w.name, { config: w.config }])) };
    writeFileSync(join(checkout, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    git(checkout, ["add", "-A", "--", "."]);
    git(checkout, [...IDENTITY, "commit", "-q", "-m", `release ${version}`, "--"]);
    git(checkout, [...IDENTITY, "tag", "-a", version, "-m", `release ${version}`]);
    const buildsCommit = git(checkout, ["rev-parse", "HEAD"]);
    git(checkout, ["push", "-q", "--", remote, "HEAD:refs/heads/main", `refs/tags/${version}`], token);
    return { version, buildsCommit, action: "created" };
  } finally { rmSync(parent, { recursive: true, force: true }); }
}

/** The tree `stage` plus the tag's own release.json would commit as, built in a scratch index the same way the release was. */
function stagedTree(checkout: string, stage: string, index: string): string {
  const run = (args: string[]) => {
    const r = spawnSync("git", ["--git-dir", join(checkout, ".git"), "--work-tree", stage, ...args], { cwd: stage, encoding: "utf8", env: { ...process.env, GIT_INDEX_FILE: index } });
    if (r.status !== 0) throw new CliError(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim()}`);
    return r.stdout.trim();
  };
  run(["add", "-A", "--", "."]);
  run(["update-index", "--add", "--cacheinfo", `100644,${git(checkout, ["rev-parse", "HEAD:release.json"])},release.json`]);
  return run(["write-tree"]);
}

function writeFileOrTree(from: string, to: string): void {
  const s = statSync(from);
  if (s.isDirectory()) { mkdirSync(to, { recursive: true }); for (const e of readdirSync(from)) writeFileOrTree(join(from, e), join(to, e)); }
  else if (s.isFile()) writeFileSync(to, readFileSync(from), { mode: 0o644 });
  else throw new CliError(`refusing non-file verification output at ${from}`);
}

function writePrivate(path: string, data: string): void {
  canonicalDirectory(dirname(path), `private file parent for ${path}`);
  let fd: number;
  try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600); }
  catch { throw new CliError(`refusing unsafe private file destination: ${path}`); }
  try { writeSync(fd, data); fchmodSync(fd, 0o600); } finally { closeSync(fd); }
}

function lstat(path: string) {
  try { return lstatSync(path); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}

/** Resolve a prospective directory without following any existing symlink component. */
function canonicalDirectory(path: string, label: string, mustExist = true): string {
  const absolute = resolve(path), root = parse(absolute).root;
  let cursor = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    const s = lstat(cursor);
    if (!s) {
      if (mustExist) throw new CliError(`${label} does not exist: ${cursor}`);
      return absolute;
    }
    if (s.isSymbolicLink()) throw new CliError(`${label} contains a symlink: ${cursor}`);
    if (!s.isDirectory()) throw new CliError(`${label} contains a non-directory path: ${cursor}`);
  }
  const real = realpathSync(absolute);
  if (real !== absolute) throw new CliError(`${label} is not canonical: ${absolute}`);
  return real;
}

function canonicalOptionPath(cwd: string, value: string, label: string): string {
  const lexicalBase = resolve(cwd), canonicalBase = realpathSync(lexicalBase);
  const lexical = resolve(lexicalBase, value), fromBase = relative(lexicalBase, lexical);
  const normalized = fromBase !== ".." && !fromBase.startsWith(`..${sep}`) ? resolve(canonicalBase, fromBase) : lexical;
  return canonicalDirectory(normalized, label, false);
}

function assertSeparation(checkout: string, stateDir: string): void {
  const rel = relative(checkout, stateDir);
  if (!rel || (!rel.startsWith(`..${sep}`) && rel !== "..")) throw new CliError("--state-dir must resolve outside the canonical source checkout");
}

/** Open without following a final symlink (or blocking on a FIFO), then require a regular 0600 file owned by this user. */
function readOwned(path: string, label: string, max = MAX_ARCHIVE): string {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new CliError(`${label} does not exist: ${path}`);
    throw new CliError(`${label} is missing or unsafe (symlinks are refused): ${path}`);
  }
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || (s.mode & 0o077) !== 0 || (process.getuid && s.uid !== process.getuid()) || s.size > max)
      throw new CliError(`${label} must be a regular 0600 file owned by the current user, at most ${max / 1024} KiB: ${path}`);
    return readFileSync(fd, "utf8");
  } finally { closeSync(fd); }
}

function readPrivate(path: string): string {
  canonicalDirectory(dirname(path), `private receipt parent for ${path}`);
  return readOwned(path, "private receipt");
}

/** Read dotenv-shaped credentials as data. Fake-mode flags are deliberately never carried into a real activation. */
export function operatorVars(path: string | undefined, base: Record<string, string | undefined>): Record<string, string | undefined> {
  const out = { ...base };
  if (!path) return out;
  if (!isAbsolute(path)) throw new CliError("--vars-file must be an absolute path outside the source checkout");
  for (const [index, raw] of readOwned(path, "--vars-file", MAX_VARS_FILE).split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new CliError(`invalid --vars-file line ${index + 1}`);
    const key = match[1]!, rawValue = match[2]!;
    if (!OPERATOR_ENV.has(key)) continue;
    let value = rawValue;
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value) as string; } catch { throw new CliError(`invalid quoted value on --vars-file line ${index + 1}`); }
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    if (/\0|\r|\n/.test(value)) throw new CliError(`invalid value on --vars-file line ${index + 1}`);
    out[key] = value;
  }
  return out;
}

function dotenvValue(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes("`")) return `\`${value}\``;
  if (!value.includes('"') && !/[\\\n\r]/.test(value)) return `"${value}"`;
  throw new CliError("an operator secret cannot be represented safely in .dev.vars");
}

/** Materialize only Worker-visible secrets outside source, then link them where Wrangler loads secret_text bindings. */
function linkWorkerSecrets(checkout: string, stateDir: string, env: Record<string, string | undefined>): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  assertSeparation(canonicalDirectory(checkout, "activation checkout"), canonicalDirectory(stateDir, "activation state directory"));
  const values: Record<string, string | undefined> = { ...env, ADMIN_TOKEN: env.ADMIN_TOKEN ?? env.ARTYFACT_ADMIN_TOKEN };
  const body = WORKER_ENV.flatMap((key) => values[key] === undefined ? [] : [`${key}=${dotenvValue(values[key]!)}`]).join("\n");
  if (!body.includes("ADMIN_TOKEN=")) throw new CliError("local activation requires ADMIN_TOKEN or ARTYFACT_ADMIN_TOKEN");
  const external = join(stateDir, "operator.dev.vars");
  writePrivate(external, `${body}\n`);
  const local = join(checkout, "apps", "platform", ".dev.vars");
  mkdirSync(dirname(local), { recursive: true });
  if (lstat(local)) unlinkSync(local);
  symlinkSync(external, local);
  const exclude = join(checkout, ".git", "info", "exclude");
  const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  if (!current.split(/\r?\n/).includes("/apps/platform/.dev.vars")) writeFileSync(exclude, `${current}${current.endsWith("\n") || !current ? "" : "\n"}/apps/platform/.dev.vars\n`);
}

function defaultInstall(checkout: string): void {
  // Lifecycle scripts stay on: esbuild and workerd install their native binaries from them.
  const r = spawnSync("pnpm", ["install", "--frozen-lockfile"], { cwd: checkout, stdio: "inherit", env: childEnv(process.env) });
  if (r.status !== 0) throw new CliError("pnpm install failed in the approved source checkout");
}

function defaultRun(checkout: string, args: string[], env: NodeJS.ProcessEnv): number {
  const r = spawnSync("pnpm", args, { cwd: checkout, stdio: "inherit", env });
  if (r.error) throw new CliError(`could not start the local platform: ${r.error.message}`);
  return r.status ?? 1;
}

export function prepareActivation(activation: Activation, opts: { dir: string; stateDir: string; namespace?: string }, io: OperatorIo): { checkout: string; stateDir: string } {
  const checkout = canonicalOptionPath(io.cwd, opts.dir, "activation checkout"), stateDir = canonicalOptionPath(io.cwd, opts.stateDir, "activation state directory");
  assertSeparation(checkout, stateDir);
  const receiptPath = join(checkout, ".git", "artyfact-activation.json");
  if (lstat(receiptPath)) {
    const prior = JSON.parse(readPrivate(receiptPath)) as { releaseIdentity?: string; stateDir?: string };
    if (prior.releaseIdentity !== verifiedReleaseIdentity(activation) || prior.stateDir !== stateDir ||
        git(checkout, ["rev-parse", "HEAD"]) !== activation.source.commit || !isPristine(checkout))
      throw new CliError(`existing activation checkout does not match the current approval: ${checkout}`);
    linkWorkerSecrets(checkout, stateDir, io.env);
    return { checkout, stateDir };
  }
  if (existsSync(checkout) && readdirSync(checkout).length) throw new CliError(`activation directory is not empty: ${checkout}`);
  mkdirSync(checkout, { recursive: true, mode: 0o700 });
  canonicalDirectory(checkout, "activation checkout");
  let prepared = false;
  try {
    git(checkout, ["init", "-q"]);
    const cloud = io.cloud ?? cloudCli(spawnExec(io.cwd), io.env, wranglerCommand(io.cwd));
    cloud.account();
    const ns = assertName("namespace", opts.namespace ?? io.env.ARTYFACT_NAMESPACE ?? DEFAULT_NS);
    const token = cloud.token(ns, activation.source.repo, "read");
    const remote = cloud.remote(ns, activation.source.repo);
    git(checkout, ["remote", "add", "origin", remote]);
    git(checkout, ["fetch", "-q", "--depth=1", "origin", activation.source.commit], token);
    git(checkout, ["checkout", "-q", "--detach", "FETCH_HEAD"]);
    if (git(checkout, ["rev-parse", "HEAD"]) !== activation.source.commit || !isPristine(checkout))
      throw new CliError("prepared source is not the exact clean approved commit");
    if (git(checkout, ["ls-files", "--", ".dev.vars", "**/.dev.vars"])) throw new CliError("approved source contains a tracked .dev.vars secret file");
    const containedGenome = activation.genome.repo === activation.source.repo && activation.genome.commit === activation.source.commit;
    // A separately governed accepted Genome is seeded into system/ in the exact source snapshot.
    // A changed in-fork model retains its declared prefix and source commit provenance.
    const modelPrefix = containedGenome ? activation.genome.prefix : "system";
    const actualDigest = modelDigestAt(checkout, activation.source.commit, modelPrefix);
    if (actualDigest !== activation.genome.digest) throw new CliError("approved source does not contain the accepted Genome digest");
    (io.install ?? defaultInstall)(checkout);
    if (!isPristine(checkout)) throw new CliError("dependency installation changed the approved source snapshot");
    linkWorkerSecrets(checkout, stateDir, io.env);
    const receipt = { version: 1, preparedAt: new Date().toISOString(), stateDir, ...activation, releaseIdentity: verifiedReleaseIdentity(activation) };
    writePrivate(join(checkout, ".git", "artyfact-activation.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    writePrivate(join(stateDir, "activation.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    prepared = true;
    return { checkout, stateDir };
  } finally {
    if (!prepared) rmSync(checkout, { recursive: true, force: true });
  }
}

type Values = Record<string, string | boolean | undefined>;

/** Operator preamble: the requested identity, credentials, an authenticated platform transport, and the activation gate. */
async function connect(values: Values, io: OperatorIo) {
  const systemId = string(values.system ?? io.env.ARTYFACT_SYSTEM, "--system");
  const planId = string(values.plan, "--plan");
  const artifactId = string(values.artifact ?? DEFAULT_ARTIFACT, "--artifact");
  const runtimeEnv = operatorVars(typeof values["vars-file"] === "string" ? values["vars-file"] : undefined, io.env);
  const token = string(runtimeEnv.ARTYFACT_ADMIN_TOKEN ?? runtimeEnv.ADMIN_TOKEN, "ARTYFACT_ADMIN_TOKEN or ADMIN_TOKEN");
  const fetcher = io.fetch ?? fetch;
  const base = await resolvePlatform(typeof values.platform === "string" ? values.platform : undefined, io.env, fetcher, io.err);
  assertBearerTransport(base, "the operator admin token");
  const expected = { systemId, planId, artifactId }, p = paths(systemId, planId, artifactId);
  const send = (method: string, path: string, body?: unknown) => request(fetcher, base, token, method, path, body);
  const json = (method: string, path: string, body?: unknown) => jsonRequest(fetcher, base, token, method, path, body);
  const fetchActivation = async () => validateActivation(await json("GET", p.activation), expected);
  return { expected, runtimeEnv, p, send, json, fetchActivation };
}

async function verifyCommand(values: Values, io: OperatorIo): Promise<number> {
  const { expected, p, json } = await connect(values, io);
  let verification = verificationOf(await json("POST", p.start, { artifactId: expected.artifactId, ...(values.retry && { retry: true }) }));
  const timeout = io.verifyTimeoutMs ?? VERIFY_TIMEOUT_MS, deadline = Date.now() + timeout;
  while (["queued", "running"].includes(verification.status)) {
    if (Date.now() >= deadline)
      throw new CliError(`verification still ${verification.status} after ${Math.round(timeout / 60_000)} minutes; inspect the artyfact-ci run, then rerun with --retry once it reports failed or error`);
    await new Promise((done) => setTimeout(done, io.pollMs ?? 1000));
    verification = verificationOf(await json("POST", p.poll, { artifactId: expected.artifactId }));
  }
  if (verification.status !== "passed") throw new CliError(`verification ${verification.status}; refusing to accept result`);
  verification = validatePassedVerification(verification, expected);
  io.out(JSON.stringify({ verification }));
  return 0;
}

async function publishCommand(values: Values, io: OperatorIo): Promise<number> {
  const { p, send, fetchActivation } = await connect(values, io);
  const activation = await fetchActivation();
  const output = activation.verification.output!;
  const response = await send("GET", p.output);
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) !== output.size) throw new CliError("verification output Content-Length does not match trusted evidence");
  const headerDigest = response.headers.get("x-content-sha256");
  if (headerDigest && headerDigest !== output.digest) throw new CliError("verification output header digest does not match trusted evidence");
  const bytes = Buffer.from(await response.arrayBuffer());
  const stage = mkdtempSync(join(tmpdir(), "artyfact-verification-output-"));
  try {
    importVerificationArchive(bytes, output, stage);
    // Re-read the gate after the potentially slow cross-service download/import so a
    // superseded approval cannot be published from stale evidence.
    const current = await fetchActivation();
    if (verifiedReleaseIdentity(current) !== verifiedReleaseIdentity(activation))
      throw new CliError("approved System changed during output preparation; run publish again");
    const published = publishVerifiedRelease(stage, current, io, typeof values.namespace === "string" ? values.namespace : DEFAULT_NS);
    io.out(JSON.stringify({ verification: current.verification, release: published }));
  } finally { rmSync(stage, { recursive: true, force: true }); }
  return 0;
}

async function activateCommand(values: Values, io: OperatorIo): Promise<number> {
  const dir = string(values.dir, "--dir"), stateDir = string(values["state-dir"], "--state-dir");
  const { runtimeEnv, fetchActivation } = await connect(values, io);
  const activation = await fetchActivation();
  const prepared = prepareActivation(activation, { dir, stateDir, namespace: typeof values.namespace === "string" ? values.namespace : undefined }, { ...io, env: runtimeEnv });
  // Re-read the authoritative gate after preparation so a superseded System cannot be started from stale approval.
  const current = await fetchActivation();
  if (verifiedReleaseIdentity(current) !== verifiedReleaseIdentity(activation)) throw new CliError("approved System changed during local preparation; run activate again");
  if (values["prepare-only"]) { io.out(JSON.stringify({ prepared: true, ...prepared, activation })); return 0; }
  const port = typeof values.port === "string" ? values.port : "1337";
  if (!/^\d{2,5}$/.test(port)) throw new CliError("--port must be a numeric TCP port");
  const args = ["--filter", "@artyfact/platform", "run", "dev", "--host", "127.0.0.1", "--port", port, "--strictPort"];
  // Worker secrets reach the app only through the linked .dev.vars; Cloudflare access comes from the user's wrangler login.
  return (io.run ?? defaultRun)(prepared.checkout, args, childEnv(process.env, { HOSTED_DEMO: "0", ARTYFACT_PERSIST_STATE_DIR: prepared.stateDir }));
}

export async function operatorCommand(args: string[], io: OperatorIo): Promise<number> {
  const [action, ...rest] = args;
  if (action !== "verify" && action !== "publish" && action !== "activate") throw new CliError("usage: artyfact operator verify|publish|activate ...");
  const { values } = parseArgs({ args: rest, strict: true, allowPositionals: false, options: {
    system: { type: "string" }, plan: { type: "string" }, artifact: { type: "string" }, platform: { type: "string" }, namespace: { type: "string" },
    dir: { type: "string" }, "state-dir": { type: "string" }, "vars-file": { type: "string" }, "prepare-only": { type: "boolean" }, retry: { type: "boolean" }, port: { type: "string" },
  } });
  if (action === "verify") return verifyCommand(values, io);
  if (action === "publish") return publishCommand(values, io);
  return activateCommand(values, io);
}
