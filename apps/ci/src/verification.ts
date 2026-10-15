import { parse } from "yaml";
import {
  normalizeVerificationRequest,
  verificationModelDigest,
  type VerificationCheck,
  type VerificationOutput,
  type VerificationRequest,
  type VerificationResult,
  type VerificationStep,
} from "@artyfact/model";

const ERROR_MAX = 4_000;
const REQUEST_MAX = 64 * 1024;
const OUTPUT_MAX = 16 * 1024 * 1024;
const BASE64_MAX = Math.ceil(OUTPUT_MAX / 3) * 4;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

const never = { retries: { limit: 0, delay: 1_000 } };
const candidateExecution = { ...never, timeout: 30 * 60 * 1_000, commandTimeoutMs: 30 * 60 * 1_000 - 10_000 };

/**
 * Candidate-controlled files are copied into a private staging directory, checked for unsafe file types, and archived
 * with fixed metadata. The archive is the only stdout, so the Worker can bound, hash and store it without credentials
 * ever entering the sandbox.
 */
export const PACKAGE_OUTPUT_COMMAND = String.raw`set -eu
test -d apps/platform/dist
test -f apps/platform/dist/artyfact_platform/wrangler.json
test -f apps/platform/dist/artyfact_platform/index.js
test -f apps/platform/dist/client/index.html
test -d apps/site/dist
test -f apps/site/dist/index.html
test -f apps/site/wrangler.jsonc
stage="$(mktemp -d)"
tarfile="$(mktemp)"
archive="$(mktemp)"
trap 'rm -rf "$stage"; rm -f "$tarfile" "$archive"' EXIT
mkdir -p "$stage/platform" "$stage/site/dist"
cp -R apps/platform/dist/. "$stage/platform/"
cp -R apps/site/dist/. "$stage/site/dist/"
cp apps/site/wrangler.jsonc "$stage/site/wrangler.jsonc"
find "$stage" -depth -name '.*' -exec rm -rf -- {} +
if find "$stage" -type l -print -quit | grep -q .; then echo 'output contains a symlink' >&2; exit 1; fi
if find "$stage" -type f -links +1 -print -quit | grep -q .; then echo 'output contains a hardlink' >&2; exit 1; fi
if find "$stage" ! -type f ! -type d -print -quit | grep -q .; then echo 'output contains an unsupported file type' >&2; exit 1; fi
tar --sort=name --format=ustar --mtime=@0 --owner=0 --group=0 --numeric-owner --mode='u+rwX,go+rX,go-w' -C "$stage" -cf "$tarfile" platform site
gzip -n -9 -c "$tarfile" > "$archive"
size="$(wc -c < "$archive")"
test "$size" -le ${OUTPUT_MAX}
base64 -w 0 "$archive"`;

export interface VerificationPlannedStep {
  name: string;
  command: string;
  cache?: { inputs: string[] };
  config: typeof never | typeof candidateExecution;
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
  return [
    // Keep dependencies in the live sandbox that installed them. Snapshot restoration is reserved for packaging the
    // already-built output. Each literal runs in its own shell so comments and quoting cannot alter later commands.
    { name: "candidate verification", command: `set -eu\n${commands.map((command) => `sh -c ${shellQuote(command)}`).join("\n")}`, config: candidateExecution },
    { name: "package output", command: PACKAGE_OUTPUT_COMMAND, config: never },
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

export interface RunnerLike {
  exitCode: number;
  logs?: { stdout: string | ReadableStream<Uint8Array>; stderr?: string | ReadableStream<Uint8Array> };
  runner(step: VerificationPlannedStep): Promise<RunnerLike>;
}
export interface CiLike { runner(step: VerificationPlannedStep): Promise<RunnerLike> }

export interface VerificationPipelineInput {
  request: VerificationRequest;
  authorize(): Promise<void>;
  ci: CiLike;
  now(name: string): Promise<string>;
  persist(result: VerificationResult, checkpoint: string): Promise<void>;
  storeOutput(bytes: Uint8Array): Promise<VerificationOutput>;
}

function failedRunner(error: unknown): string | null {
  const value = error as { name?: string; runner?: { name?: string } };
  return value?.name === "CiRunnerFailure" ? value.runner?.name ?? "unknown" : null;
}

async function readBounded(log: string | ReadableStream<Uint8Array> | undefined, maximum: number): Promise<string> {
  if (log === undefined) throw new Error("package output is missing");
  if (typeof log === "string") {
    if (log.length > maximum) throw new Error("package output exceeds the limit");
    return log;
  }
  const reader = log.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
      if (text.length > maximum) throw new Error("package output exceeds the limit");
    }
    text += decoder.decode();
    return text;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function cancelRunnerLogs(runner: RunnerLike, includeStdout = true): Promise<void> {
  const streams = [includeStdout ? runner.logs?.stdout : undefined, runner.logs?.stderr]
    .filter((log): log is ReadableStream<Uint8Array> => typeof log !== "string" && log !== undefined);
  await Promise.allSettled(streams.map((stream) => stream.cancel()));
}

/** Decode a bounded base64 archive without accepting log framing or trailing output. */
export async function packageBytes(runner: RunnerLike): Promise<Uint8Array> {
  try {
    const encoded = await readBounded(runner.logs?.stdout, BASE64_MAX);
    if (!encoded || encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error("package output is not canonical base64");
    }
    const binary = atob(encoded);
    if (binary.length > OUTPUT_MAX) throw new Error("package output exceeds the limit");
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } finally {
    await cancelRunnerLogs(runner, false);
  }
}

/** Execute the fixed profile, persist every observable status, and publish output only after every gate passes. */
export async function runVerificationPipeline(input: VerificationPipelineInput): Promise<VerificationResult> {
  const request = normalizeVerificationRequest(input.request);
  const result: VerificationResult = { version: 1, request, status: "running", steps: [], checks: [] };
  let current: VerificationPlannedStep | undefined;
  try {
    await input.authorize();
    result.startedAt = await input.now("verification started");
    await input.persist(result, "persist running");
    let runner: RunnerLike | null = null;
    const plan = planVerificationSteps(request);
    for (let index = 0; index < plan.length; index++) {
      current = plan[index];
      const started = Date.parse(await input.now(`${current.name} started`));
      runner = await (runner ? runner.runner(current) : input.ci.runner(current));
      const step: VerificationStep = { name: current.name, command: current.command, status: "passed", durationMs: Date.parse(await input.now(`${current.name} finished`)) - started };
      result.steps.push(step);
      if (current.name === "candidate verification") {
        result.checks!.push(...request.checks.map((check) => ({ ...check, status: "passed" as const })));
      }
      if (index < plan.length - 1) await cancelRunnerLogs(runner);
      await input.persist(result, `persist ${current.name}`);
    }
    const bytes = await packageBytes(runner!);
    result.output = await input.storeOutput(bytes);
    result.status = "passed";
    result.finishedAt = await input.now("verification finished");
    await input.persist(result, "persist passed");
    return result;
  } catch (error) {
    const runnerName = failedRunner(error);
    const status = runnerName !== null ? "failed" : "error";
    const name = runnerName && runnerName !== "unknown" ? runnerName : current?.name ?? "authorize";
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

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

async function authorized(header: string | null, token: string): Promise<boolean> {
  if (!token || !header?.startsWith("Bearer ")) return false;
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
  replaceResult(result: VerificationResult): Promise<void>;
  start(request: VerificationRequest & { checks: VerificationCheck[] }): Promise<void>;
  getOutput(key: string): Promise<Response | null>;
}

export interface VerificationBucketLike {
  head(key: string): Promise<{ size: number; customMetadata?: Record<string, string> } | null>;
  put(
    key: string,
    value: Uint8Array | string,
    options?: { onlyIf?: { etagDoesNotMatch?: string }; httpMetadata?: { contentType?: string; cacheControl?: string }; customMetadata?: Record<string, string>; sha256?: ArrayBuffer },
  ): Promise<unknown | null>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; text(): Promise<string> } | null>;
}

export const verificationResultKey = (id: string) => `verification/v1/${id}/result.json`;
export const verificationOutputKey = (id: string) => `verification/v1/${id}/output.tar.gz`;

const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** Atomically store immutable output bytes in trusted R2 and return their exact identity. */
export async function storeVerificationOutput(bucket: VerificationBucketLike, id: string, bytes: Uint8Array): Promise<VerificationOutput> {
  if (!ID_RE.test(id)) throw new Error("verification output id is invalid");
  if (bytes.byteLength === 0 || bytes.byteLength > OUTPUT_MAX) throw new Error("verification output size is invalid");
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error("verification output is not gzip");
  const digestBytes = await crypto.subtle.digest("SHA-256", bytes);
  const digest = hex(digestBytes);
  const key = verificationOutputKey(id);
  const metadata = { digest };
  const existing = await bucket.head(key);
  if (existing) {
    if (existing.size !== bytes.byteLength || existing.customMetadata?.digest !== digest) throw new Error("verification output is immutable");
    return { key, digest, size: bytes.byteLength };
  }
  const stored = await bucket.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/gzip", cacheControl: "private, no-store" },
    customMetadata: metadata,
    sha256: digestBytes,
  });
  if (!stored) {
    const raced = await bucket.head(key);
    if (!raced || raced.size !== bytes.byteLength || raced.customMetadata?.digest !== digest) throw new Error("verification output is immutable");
  }
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
    if (existing) return canonical(existing.request) === canonical(normalized) ? json(existing, 202) : json({ error: "verification id already belongs to another request" }, 409);
    const queued: VerificationResult = { version: 1, request: normalized, status: "queued", steps: [], checks: [] };
    if (!await deps.createQueued(queued)) {
      const raced = await deps.getResult(normalized.id);
      return raced && canonical(raced.request) === canonical(normalized) ? json(raced, 202) : json({ error: "verification id already belongs to another request" }, 409);
    }
    try {
      await deps.start(normalized);
      return json(queued, 202);
    } catch (error) {
      const failed = { ...queued, status: "error" as const, finishedAt: new Date().toISOString(), error: String((error as Error)?.message ?? error).slice(0, ERROR_MAX) };
      await deps.replaceResult(failed);
      return json(failed, 503);
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
