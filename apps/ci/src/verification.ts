import { parse } from "yaml";
import {
  canonicalJson,
  normalizeVerificationRequest,
  VERIFICATION_OUTPUT_MAX_BYTES as OUTPUT_MAX,
  verificationLogKey,
  verificationModelDigest,
  verificationOutputKey,
  type VerificationCheck,
  type VerificationOutput,
  type VerificationRequest,
  type VerificationResult,
  type VerificationStep,
} from "@artyfact/model";
import { runnerFailure } from "./runner-failure";

const ERROR_MAX = 4_000;
const REQUEST_MAX = 64 * 1024;
/** Gate stdout stays well under the runner's 300 KB inline-log limit; the full log is kept in the workspace. */
export const GATE_TAIL_BYTES = 200_000;
/** The stored gate log is the tail of the full log, so one runaway command cannot fill R2. */
export const GATE_LOG_MAX_BYTES = 8 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** A failing gate is final (the patched runner throws NonRetryableError); a lost sandbox runs it once more. */
const candidateExecution = { retries: { limit: 1, delay: 30_000, backoff: "constant" as const }, timeout: 30 * 60 * 1_000, commandTimeoutMs: 30 * 60 * 1_000 - 60_000 };
/** Packaging is deterministic and runs no candidate code, so a retry rebuilds identical bytes. */
const PACKAGE_COMMAND_TIMEOUT_MS = 5 * 60 * 1_000;
/** Snapshot restore (the whole workspace, node_modules included) plus the command plus two capped reads and puts. */
const packaging = { retries: { limit: 2, delay: 5_000, backoff: "exponential" as const }, timeout: 15 * 60 * 1_000 };
const WORKSPACE_DIR = "/workspace";
const PACKAGE_ARCHIVE = "/tmp/out.tgz";
const PACKAGE_LOG = "/tmp/gate.log";

/** Total bytes of the packaged source trees; the archive itself is capped separately at OUTPUT_MAX. */
export const PACKAGE_SOURCE_MAX_BYTES = 64 * 1024 * 1024;
/** `ulimit -f` blocks (512 B in dash, 1 KiB in bash): every file the command writes stays under 128-256 MiB. */
const PACKAGE_FILE_BLOCKS = 262_144;

/**
 * Package the candidate's built output. The restored workspace is candidate-controlled, so the source tree is validated
 * before anything is read: every path component is a real directory or file inside the workspace (no symlink, no
 * escape through realpath), the trees hold only regular single-link files and directories, and their total size is
 * bounded. Copies never follow links, and the staged copy is checked again. The archive has fixed order and metadata,
 * so retries produce identical bytes. Dotfiles are dropped; the build emits only `.vite`, `.dev.vars` and
 * `client/.assetsignore`, and deploy needs none of them. The gate log tail is copied out under the same checks; it is
 * informational only. Nothing is printed and no credential enters the sandbox.
 */
export const packageOutputCommand = (archive: string, log: string) => String.raw`set -eu
export LC_ALL=C
ulimit -f ${PACKAGE_FILE_BLOCKS}
root="$(pwd -P)"
fail() { echo "$*" >&2; exit 1; }
inside() {
  [ ! -L "$1" ] || fail "$1 is a symlink"
  [ -e "$1" ] || fail "$1 is missing"
  [ "$(realpath -- "$1")" = "$root/$1" ] || fail "$1 escapes the workspace"
}
for path in apps apps/platform apps/platform/dist apps/site apps/site/dist apps/site/wrangler.jsonc; do inside "$path"; done
sources="apps/platform/dist apps/site/dist apps/site/wrangler.jsonc"
if find $sources -type l -print -quit | grep -q .; then fail 'output contains a symlink'; fi
if find $sources ! -type f ! -type d -print -quit | grep -q .; then fail 'output contains an unsupported file type'; fi
if find $sources -type f -links +1 -print -quit | grep -q .; then fail 'output contains a hardlink'; fi
if find $sources -type f -size +${PACKAGE_SOURCE_MAX_BYTES}c -print -quit | grep -q .; then fail 'output exceeds the source limit'; fi
total="$(find $sources -type f -exec sh -c 'for f do wc -c < "$f"; done' sh {} + | awk '{ s += $1 } END { print s + 0 }')"
[ "$total" -le ${PACKAGE_SOURCE_MAX_BYTES} ] || fail 'output exceeds the source limit'
test -d apps/platform/dist/artyfact_platform
test -f apps/platform/dist/artyfact_platform/wrangler.json
test -f apps/platform/dist/artyfact_platform/index.js
test -f apps/platform/dist/client/index.html
test -f apps/site/dist/index.html
test -f apps/site/wrangler.jsonc
gate=.verification/gate.log
if [ -d .verification ] && [ ! -L .verification ] && [ "$(realpath -- .verification)" = "$root/.verification" ] \
  && [ -f "$gate" ] && [ ! -L "$gate" ] && [ "$(realpath -- "$gate")" = "$root/$gate" ] && [ -z "$(find "$gate" -links +1)" ]; then
  tail -c ${GATE_LOG_MAX_BYTES} "$gate" > ${log}
else
  echo 'gate log is missing or unsafe' > ${log}
fi
stage="$(mktemp -d)"
tarfile="$(mktemp)"
archive=${archive}
trap 'rm -rf "$stage"; rm -f "$tarfile"' EXIT
rm -f "$archive"
mkdir -p "$stage/platform" "$stage/site/dist"
cp -R -P apps/platform/dist/. "$stage/platform/"
cp -R -P apps/site/dist/. "$stage/site/dist/"
cp -P apps/site/wrangler.jsonc "$stage/site/wrangler.jsonc"
find "$stage" -depth -name '.*' -exec rm -rf -- {} +
if find "$stage" -type l -print -quit | grep -q .; then fail 'output contains a symlink'; fi
if find "$stage" -type f -links +1 -print -quit | grep -q .; then fail 'output contains a hardlink'; fi
if find "$stage" ! -type f ! -type d -print -quit | grep -q .; then fail 'output contains an unsupported file type'; fi
tar --sort=name --format=ustar --mtime=@0 --owner=0 --group=0 --numeric-owner --mode='u+rwX,go+rX,go-w' -C "$stage" -cf "$tarfile" platform site
gzip -n -9 -c "$tarfile" > "$archive"
size="$(wc -c < "$archive")"
test "$size" -le ${OUTPUT_MAX}`;

export const PACKAGE_OUTPUT_COMMAND = packageOutputCommand(PACKAGE_ARCHIVE, PACKAGE_LOG);

/** Run a command with its stdout discarded and only a bounded stderr tail returned. */
export const boundedStderr = (command: string) => String.raw`err="$(mktemp)"
sh -c ${shellQuote(command)} > /dev/null 2> "$err"
status=$?
tail -c ${ERROR_MAX / 2} "$err" >&2
rm -f "$err"
exit "$status"`;

export interface VerificationPlannedStep {
  name: string;
  command: string;
  cache?: { inputs: string[] };
  config: typeof candidateExecution | typeof packaging;
  cloudflareCredentials?: never;
  secrets?: never;
}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

/** Fixed profile plus exact commands already authorized from the accepted Genome, in one unsnapshotted execution. */
export function planVerificationSteps(request: VerificationRequest): VerificationPlannedStep[] {
  const commands = [
    // Artifacts checkout exports the pinned tree without .git. Inventory tests need its exact source index,
    // including committed files now matched by .gitignore, before installation creates generated files.
    "git init -q && git add -f -A",
    "npm ci",
    "npx --no-install playwright install --with-deps chromium",
    "npm run ci -- --ultra-compact",
    ...(request.checks ?? []).map((check) => check.command),
  ];
  // Each literal runs in its own shell so comments and quoting cannot alter later commands. `&&` stops at the first
  // failure and keeps its status without `set -e`, which would skip the tail. The full log stays outside the workspace
  // until the gate passes, so the exported-source index never sees it; then it moves into the snapshot.
  const gate = String.raw`set -u
full="$(mktemp)"
status=0
{ ${commands.map((command) => `sh -c ${shellQuote(command)}`).join(" &&\n  ")}
} > "$full" 2>&1 || status=$?
tail -c ${GATE_TAIL_BYTES} "$full"
if [ "$status" -eq 0 ]; then mkdir -p .verification && mv "$full" .verification/gate.log || status=$?; else rm -f "$full"; fi
exit "$status"`;
  return [
    // Keep dependencies in the live sandbox that installed them. Snapshot restoration is reserved for packaging the
    // already-built output, which runs in a trusted step rather than a runner (see packageVerificationOutput).
    { name: "candidate verification", command: gate, config: candidateExecution },
    { name: "package output", command: PACKAGE_OUTPUT_COMMAND, config: packaging },
  ];
}

type YamlMap = Record<string, unknown>;
const object = (value: unknown): value is YamlMap => !!value && typeof value === "object" && !Array.isArray(value);

function systemId(files: ReadonlyMap<string, string>): string | null {
  const root = files.get("node.yaml") ?? files.get("system.yaml");
  if (!root) return null;
  const doc: unknown = parse(root);
  return object(doc) && typeof doc.id === "string" ? doc.id : null;
}

function acceptedChecks(files: ReadonlyMap<string, string>): Map<string, VerificationCheck> {
  const out = new Map<string, VerificationCheck>();
  for (const [path, text] of files) {
    if (!/\.ya?ml$/.test(path)) continue;
    const doc: unknown = parse(text);
    if (!object(doc) || !Array.isArray(doc.criteria)) continue;
    for (const criterion of doc.criteria) {
      if (!object(criterion) || typeof criterion.id !== "string" || !Array.isArray(criterion.hooks)) continue;
      for (const hook of criterion.hooks) {
        if (!object(hook) || typeof hook.id !== "string" || (hook.engine !== "vitest" && hook.engine !== "browser") || !object(hook.inputs) || typeof hook.inputs.command !== "string") continue;
        const value = { criterionId: criterion.id, hookId: hook.id, command: hook.inputs.command };
        const key = `${value.criterionId}\0${value.hookId}`;
        if (out.has(key)) throw new Error(`accepted Genome defines duplicate hook ${criterion.id}/${hook.id}`);
        out.set(key, value);
      }
    }
  }
  return out;
}

/** Bind exact model bytes and permit only command literals in execution hooks of the accepted pinned model. */
export function authorizeVerification(
  request: VerificationRequest,
  effectiveFiles: ReadonlyMap<string, string>,
  pinnedFiles: ReadonlyMap<string, string>,
): VerificationCheck[] {
  const normalized = normalizeVerificationRequest(request);
  const effectiveDigest = verificationModelDigest(effectiveFiles);
  if (effectiveDigest !== normalized.genome.digest) throw new Error("effective Genome digest does not match the request");
  const pinned = normalized.pinnedGenome ?? normalized.genome;
  const pinnedDigest = verificationModelDigest(pinnedFiles);
  if (pinnedDigest !== pinned.digest) throw new Error("pinned Genome digest does not match the request");
  if (systemId(effectiveFiles) !== normalized.systemId || systemId(pinnedFiles) !== normalized.systemId) {
    throw new Error("Genome System identity does not match systemId");
  }
  const allow = acceptedChecks(pinnedFiles);
  for (const check of normalized.checks) {
    const accepted = allow.get(`${check.criterionId}\0${check.hookId}`);
    if (!accepted || accepted.command !== check.command) throw new Error(`check ${check.criterionId}/${check.hookId} is not an authorized pinned hook`);
  }
  return normalized.checks;
}

/** Serializable workspace backup handle, as @cloudflare/ci returns it. */
export interface WorkspaceSnapshot { id: string; dir: string; localBucket?: boolean }

export interface RunnerLike {
  exitCode: number;
  logs?: { stdout: string | ReadableStream<Uint8Array>; stderr?: string | ReadableStream<Uint8Array> };
  snapshot?: WorkspaceSnapshot;
}
export interface CiLike { runner(step: VerificationPlannedStep): Promise<RunnerLike> }

/** What the trusted package step returns: references into R2, never the bytes. */
export interface VerificationPackage extends VerificationOutput { logKey: string }

export interface VerificationPipelineInput {
  request: VerificationRequest;
  authorize(): Promise<void>;
  ci: CiLike;
  now(name: string): Promise<string>;
  persist(result: VerificationResult, checkpoint: string): Promise<void>;
  /** Durable step that packages the gate snapshot into R2 (see {@link packageVerificationOutput}). */
  packageOutput(step: VerificationPlannedStep, snapshot: WorkspaceSnapshot): Promise<VerificationPackage>;
}

async function cancelRunnerLogs(runner: RunnerLike): Promise<void> {
  const streams = [runner.logs?.stdout, runner.logs?.stderr]
    .filter((log): log is ReadableStream<Uint8Array> => typeof log !== "string" && log !== undefined);
  await Promise.allSettled(streams.map((stream) => stream.cancel()));
}

/** Execute the fixed profile, persist every observable status, and publish output only after every gate passes. */
export async function runVerificationPipeline(input: VerificationPipelineInput): Promise<VerificationResult> {
  const request = normalizeVerificationRequest(input.request);
  const result: VerificationResult = { version: 1, request, status: "running", steps: [], checks: [] };
  let current: VerificationPlannedStep | undefined;
  const timed = async <T>(step: VerificationPlannedStep, run: () => Promise<T>): Promise<T> => {
    current = step;
    const started = Date.parse(await input.now(`${step.name} started`));
    const value = await run();
    result.steps.push({ name: step.name, command: step.command, status: "passed", durationMs: Date.parse(await input.now(`${step.name} finished`)) - started });
    return value;
  };
  try {
    await input.authorize();
    result.startedAt = await input.now("verification started");
    await input.persist(result, "persist running");
    const [gate, pack] = planVerificationSteps(request) as [VerificationPlannedStep, VerificationPlannedStep];
    const runner = await timed(gate, () => input.ci.runner(gate));
    result.checks!.push(...request.checks.map((check) => ({ ...check, status: "passed" as const })));
    await cancelRunnerLogs(runner);
    if (!runner.snapshot) throw new Error("candidate verification produced no workspace snapshot");
    await input.persist(result, `persist ${gate.name}`);
    const snapshot = runner.snapshot;
    const packaged = await timed(pack, () => input.packageOutput(pack, snapshot));
    result.output = { key: packaged.key, digest: packaged.digest, size: packaged.size };
    result.logKey = packaged.logKey;
    result.status = "passed";
    result.finishedAt = await input.now("verification finished");
    await input.persist(result, "persist passed");
    return result;
  } catch (error) {
    // Only the candidate's own exit code or timeout is a verdict; a lost sandbox or any other throw is infrastructure.
    const failure = runnerFailure(error);
    const status = failure?.commandFailed ? "failed" : "error";
    const name = failure && failure.runner !== "unknown" ? failure.runner : current?.name ?? "authorize";
    const existingStep = result.steps.find((step) => step.name === name);
    if (existingStep && current?.name === "package output" && status === "error") {
      existingStep.status = "error";
    } else if (!existingStep) {
      result.steps.push({ name, command: current?.command ?? "validate pinned verification request", status });
    }
    result.status = status;
    result.error = String((error as Error)?.message ?? error).slice(0, ERROR_MAX);
    result.finishedAt = await input.now("verification finished");
    await input.persist(result, `persist ${status}`);
    throw error;
  }
}

/** The slice of the Sandbox SDK the package step uses, so it can be exercised without a container. */
export interface PackageSandbox {
  restoreBackup(backup: WorkspaceSnapshot): Promise<unknown>;
  exec(command: string, options: { cwd: string; timeout: number }): Promise<{ exitCode: number; stderr: string }>;
  readFile(path: string, options: { encoding: "none" }): Promise<{ content: ReadableStream<Uint8Array>; size: number }>;
  destroy(): Promise<void>;
}

/** Read a sandbox file into memory, refusing it before or during the read once it passes `maximum` bytes. */
async function readCapped(sandbox: PackageSandbox, path: string, maximum: number, what: string): Promise<Uint8Array> {
  const { content, size } = await sandbox.readFile(path, { encoding: "none" });
  const reader = content.getReader();
  try {
    if (!Number.isSafeInteger(size) || size < 0 || size > maximum) throw new Error(`${what} exceeds the limit`);
    const bytes = new Uint8Array(size);
    let offset = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (offset + next.value.byteLength > size) throw new Error(`${what} is larger than reported`);
      bytes.set(next.value, offset);
      offset += next.value.byteLength;
    }
    if (offset !== size) throw new Error(`${what} is shorter than reported`);
    return bytes;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Trusted package step. A fresh sandbox restores the passed gate's snapshot (no source overlay, so no checkout token
 * reaches it), runs only the fixed package command, and the Worker reads the archive and gate log back as bytes. Both
 * land in R2 and only their references return, which keeps the Workflow step result small and serialisable.
 */
export async function packageVerificationOutput(input: {
  sandbox: PackageSandbox;
  snapshot: WorkspaceSnapshot;
  bucket: VerificationBucketLike;
  id: string;
}): Promise<VerificationPackage> {
  const { sandbox, bucket, id } = input;
  if (!ID_RE.test(id)) throw new Error("verification output id is invalid");
  try {
    await sandbox.restoreBackup(input.snapshot);
    const run = await sandbox.exec(boundedStderr(PACKAGE_OUTPUT_COMMAND), { cwd: WORKSPACE_DIR, timeout: PACKAGE_COMMAND_TIMEOUT_MS });
    if (run.exitCode !== 0) throw new Error(`package output exited ${run.exitCode}: ${run.stderr.slice(-ERROR_MAX / 2)}`);
    // Candidate-written and informational only: nothing reads it back as evidence.
    const log = await readCapped(sandbox, PACKAGE_LOG, GATE_LOG_MAX_BYTES, "gate log");
    const logKey = verificationLogKey(id);
    await storeImmutable(bucket, logKey, log, "text/plain; charset=utf-8", "gate log");
    const output = await storeVerificationOutput(bucket, id, await readCapped(sandbox, PACKAGE_ARCHIVE, OUTPUT_MAX, "package output"));
    return { ...output, logKey };
  } finally {
    await sandbox.destroy().catch((error) => console.error("failed to destroy package sandbox", { error }));
  }
}

export async function authorized(header: string | null, configured: string): Promise<boolean> {
  // A secret piped through `echo ... | wrangler secret put` keeps its newline; only the configured side is trimmed.
  const token = configured.replace(/[\r\n]+$/, "");
  if (!token.trim() || !header?.startsWith("Bearer ")) return false;
  const values = await Promise.all([header.slice(7), token].map((value) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  const [left, right] = values.map((value) => new Uint8Array(value));
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i]! ^ right[i]!;
  return difference === 0;
}

async function boundedJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("content-type must be application/json");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > REQUEST_MAX) throw new Error("request body exceeds 64 KiB");
  if (!request.body) throw new Error("request body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > REQUEST_MAX) { await reader.cancel(); throw new Error("request body exceeds 64 KiB"); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export interface VerificationHttpDeps {
  token: string;
  authorize(request: VerificationRequest & { checks: VerificationCheck[] }): Promise<void>;
  getResult(id: string): Promise<VerificationResult | null>;
  /** Atomic create-if-absent. */
  createQueued(result: VerificationResult): Promise<boolean>;
  /** Settle a still-queued result whose Workflow failed to start; returns what is stored afterwards. */
  failQueued(result: VerificationResult): Promise<VerificationResult | null>;
  start(request: VerificationRequest & { checks: VerificationCheck[] }): Promise<void>;
  getOutput(key: string): Promise<Response | null>;
}

export interface VerificationBucketLike {
  head(key: string): Promise<{ size: number; customMetadata?: Record<string, string> } | null>;
  put(
    key: string,
    value: Uint8Array | string,
    options?: { onlyIf?: { etagDoesNotMatch?: string; etagMatches?: string }; httpMetadata?: { contentType?: string; cacheControl?: string }; customMetadata?: Record<string, string>; sha256?: ArrayBuffer },
  ): Promise<unknown | null>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; text(): Promise<string>; etag: string; uploaded: Date } | null>;
}

export const verificationResultKey = (id: string) => `verification/v1/${id}/result.json`;
export { verificationLogKey, verificationOutputKey };

/** A run with no recorded progress for this long is settled as `error`, so the platform's retry path can proceed. */
export const VERIFICATION_STALE_MS = 2 * 60 * 60 * 1000;
const terminal = (status: VerificationResult["status"]) => status === "passed" || status === "failed" || status === "error";
const RESULT_HTTP = { contentType: "application/json", cacheControl: "private, no-store" };

async function readResult(bucket: VerificationBucketLike, id: string) {
  const object = await bucket.get(verificationResultKey(id));
  return object ? { result: JSON.parse(await object.text()) as VerificationResult, etag: object.etag, uploaded: object.uploaded } : null;
}

const putResult = (bucket: VerificationBucketLike, result: VerificationResult, onlyIf: { etagMatches: string } | { etagDoesNotMatch: "*" }) =>
  bucket.put(verificationResultKey(result.request.id), JSON.stringify(result), { onlyIf, httpMetadata: RESULT_HTTP });

/** Atomic create-if-absent of the first queued result. */
export const createQueuedResult = async (bucket: VerificationBucketLike, result: VerificationResult) => !!await putResult(bucket, result, { etagDoesNotMatch: "*" });

/** Read a result; one stuck without progress past the bound is settled as `error` atomically, so a late writer cannot revive it. */
export async function getVerificationResult(bucket: VerificationBucketLike, id: string, now = new Date()): Promise<VerificationResult | null> {
  const stored = await readResult(bucket, id);
  if (!stored || terminal(stored.result.status) || now.getTime() - stored.uploaded.getTime() < VERIFICATION_STALE_MS) return stored?.result ?? null;
  const expired: VerificationResult = { ...stored.result, status: "error", finishedAt: now.toISOString(),
    error: `verification made no progress for ${VERIFICATION_STALE_MS / 3_600_000}h; retry it with a new id` };
  if (await putResult(bucket, expired, { etagMatches: stored.etag })) return expired;
  return (await readResult(bucket, id))?.result ?? null;
}

/** Compare-and-swap progress write. Terminal results are immutable; a concurrent writer fails the write so the step retries. */
export async function persistVerificationResult(bucket: VerificationBucketLike, result: VerificationResult): Promise<void> {
  const stored = await readResult(bucket, result.request.id);
  if (stored && terminal(stored.result.status)) {
    if (canonicalJson(stored.result) !== canonicalJson(result)) throw new Error(`terminal verification ${result.request.id} is immutable`);
    return;
  }
  if (!await putResult(bucket, result, stored ? { etagMatches: stored.etag } : { etagDoesNotMatch: "*" }))
    throw new Error(`verification ${result.request.id} changed concurrently`);
}

/** Only a result still `queued` is replaced; a Workflow that started despite the error keeps its own progress. */
export async function failQueuedResult(bucket: VerificationBucketLike, result: VerificationResult): Promise<VerificationResult | null> {
  const stored = await readResult(bucket, result.request.id);
  if (!stored || stored.result.status !== "queued") return stored?.result ?? null;
  if (await putResult(bucket, result, { etagMatches: stored.etag })) return result;
  return (await readResult(bucket, result.request.id))?.result ?? null;
}

const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** Create-if-absent put; an existing object must carry the same size and digest, so a retry is a no-op. */
async function storeImmutable(bucket: VerificationBucketLike, key: string, bytes: Uint8Array, contentType: string, what: string): Promise<string> {
  const digestBytes = await crypto.subtle.digest("SHA-256", bytes);
  const digest = hex(digestBytes);
  const same = (object: { size: number; customMetadata?: Record<string, string> } | null) =>
    !!object && object.size === bytes.byteLength && object.customMetadata?.digest === digest;
  const existing = await bucket.head(key);
  if (existing) {
    if (!same(existing)) throw new Error(`${what} is immutable`);
    return digest;
  }
  const stored = await bucket.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType, cacheControl: "private, no-store" },
    customMetadata: { digest },
    sha256: digestBytes,
  });
  if (!stored && !same(await bucket.head(key))) throw new Error(`${what} is immutable`);
  return digest;
}

/** Atomically store immutable output bytes in trusted R2 and return their exact identity. */
export async function storeVerificationOutput(bucket: VerificationBucketLike, id: string, bytes: Uint8Array): Promise<VerificationOutput> {
  if (!ID_RE.test(id)) throw new Error("verification output id is invalid");
  if (bytes.byteLength === 0 || bytes.byteLength > OUTPUT_MAX) throw new Error("verification output size is invalid");
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error("verification output is not gzip");
  const key = verificationOutputKey(id);
  const digest = await storeImmutable(bucket, key, bytes, "application/gzip", "verification output");
  return { key, digest, size: bytes.byteLength };
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

/** Authenticated POST/GET surface; all public input is normalized before it reaches Workflows or R2 keys. */
export async function handleVerificationHttp(request: Request, deps: VerificationHttpDeps): Promise<Response> {
  if (!await authorized(request.headers.get("authorization"), deps.token)) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/verify") {
    let normalized: VerificationRequest & { checks: VerificationCheck[] };
    try {
      normalized = normalizeVerificationRequest(await boundedJson(request));
      await deps.authorize(normalized);
    } catch (error) {
      return json({ error: String((error as Error)?.message ?? error).slice(0, 500) }, 422);
    }
    const existing = await deps.getResult(normalized.id);
    if (existing) return canonicalJson(existing.request) === canonicalJson(normalized) ? json(existing, 202) : json({ error: "verification id already belongs to another request" }, 409);
    const queued: VerificationResult = { version: 1, request: normalized, status: "queued", steps: [], checks: [] };
    if (!await deps.createQueued(queued)) {
      const raced = await deps.getResult(normalized.id);
      return raced && canonicalJson(raced.request) === canonicalJson(normalized) ? json(raced, 202) : json({ error: "verification id already belongs to another request" }, 409);
    }
    try {
      await deps.start(normalized);
      return json(queued, 202);
    } catch (error) {
      const failed = { ...queued, status: "error" as const, finishedAt: new Date().toISOString(), error: String((error as Error)?.message ?? error).slice(0, ERROR_MAX) };
      const current = await deps.failQueued(failed);
      return current && current !== failed ? json(current, 202) : json(failed, 503);
    }
  }
  const match = /^\/verify\/([^/]+)(\/output)?$/.exec(url.pathname);
  if (request.method !== "GET" || !match) return json({ error: "not found" }, 404);
  let id: string;
  try { id = decodeURIComponent(match[1]!); } catch { return json({ error: "not found" }, 404); }
  if (!ID_RE.test(id)) return json({ error: "not found" }, 404);
  const result = await deps.getResult(id);
  if (!result) return json({ error: "not found" }, 404);
  if (!match[2]) return json(result);
  if (result.status !== "passed" || !result.output) return json({ error: "output is not available" }, 409);
  const object = await deps.getOutput(result.output.key);
  if (!object) return json({ error: "verified output is missing" }, 500);
  const headers = new Headers(object.headers);
  headers.set("content-type", "application/gzip");
  headers.set("content-length", String(result.output.size));
  headers.set("etag", `"${result.output.digest}"`);
  headers.set("content-disposition", `attachment; filename="artyfact-verification-${id}.tar.gz"`);
  headers.set("cache-control", "private, no-store");
  return new Response(object.body, { status: 200, headers });
}
