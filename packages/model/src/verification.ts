import { sha256Hex } from "@artyfact/rules";
import { z } from "zod";
import { INTENT_BRIEF_PATH, INTENT_MANIFEST_PATH } from "./intent.ts";

export const VERIFICATION_PROFILE = "artyfact-self-v1" as const;

export interface VerificationGenomeRef {
  repo: string;
  commit: string;
  prefix: string;
  /** SHA-256 of the canonical sorted `[path,text]` Genome file pairs. */
  digest: string;
}

export interface VerificationCheck {
  criterionId: string;
  hookId: string;
  command: string;
}

export interface VerificationRequest {
  version: 1;
  id: string;
  systemId: string;
  planId: string;
  candidateId: string;
  artifactId: string;
  source: { repo: string; commit: string };
  /** Effective model whose digest is bound to the verification result. */
  genome: VerificationGenomeRef;
  /** Accepted model that authorizes requested hooks; defaults to `genome`. */
  pinnedGenome?: VerificationGenomeRef;
  profile: typeof VERIFICATION_PROFILE;
  checks?: VerificationCheck[];
}

export type VerificationStatus = "queued" | "running" | "passed" | "failed" | "error";

/** Largest packaged verification output, and the only R2 key a result may name for it. */
export const VERIFICATION_OUTPUT_MAX_BYTES = 16 * 1024 * 1024;
export const verificationOutputKey = (id: string) => `verification/v1/${id}/output.tar.gz`;
/** The only R2 key a result may name for its gate log. */
export const verificationLogKey = (id: string) => `verification/v1/${id}/gate.log`;

/** Maximum canonical model-source files accepted by remote verification. */
export const VERIFICATION_MODEL_MAX_FILES = 2_000;
export interface VerificationStep {
  name: string;
  command: string;
  status: VerificationStatus;
  durationMs?: number;
}
export interface VerificationCheckResult extends VerificationCheck { status: "passed" | "failed" | "error" }
export interface VerificationOutput { key: string; digest: string; size: number }
export interface VerificationResult {
  version: 1;
  request: VerificationRequest & { checks: VerificationCheck[] };
  status: VerificationStatus;
  steps: VerificationStep[];
  checks?: VerificationCheckResult[];
  startedAt?: string;
  finishedAt?: string;
  output?: VerificationOutput;
  /** R2 key of the passed gate's log tail, stored next to the output. */
  logKey?: string;
  error?: string;
}

export const VERIFICATION_MAX_CHECKS = 64;
export const VERIFICATION_CHECK_COMMAND_MAX = 500;
/**
 * A step echoes the exact script CI ran. The candidate gate inlines every check, and shell quoting can expand each
 * check five-fold, so the cap covers 64 checks of 500 quote characters with room for the fixed profile.
 */
export const VERIFICATION_STEP_COMMAND_MAX = 192 * 1024;
/** Largest result body the platform reads from CI; the worst-case result built from the limits above fits. */
export const VERIFICATION_RESULT_MAX_BYTES = 512 * 1024;
const verificationStatusSchema = z.enum(["queued", "running", "passed", "failed", "error"]);
/** Wire shape of a CI result. The request stays untrusted here and is checked by normalizeVerificationRequest. */
export const verificationResultSchema = z.object({
  version: z.literal(1),
  request: z.unknown(),
  status: verificationStatusSchema,
  steps: z.array(z.object({ name: z.string().max(200), command: z.string().max(VERIFICATION_STEP_COMMAND_MAX), status: verificationStatusSchema, durationMs: z.number().nonnegative().optional() })).max(100),
  checks: z.array(z.object({ criterionId: z.string(), hookId: z.string(), command: z.string(), status: z.enum(["passed", "failed", "error"]) })).max(VERIFICATION_MAX_CHECKS).optional(),
  startedAt: z.string().max(100).optional(),
  finishedAt: z.string().max(100).optional(),
  output: z.object({ key: z.string().min(1).max(512), digest: z.string().regex(/^[0-9a-f]{64}$/), size: z.number().int().positive().max(VERIFICATION_OUTPUT_MAX_BYTES) }).optional(),
  logKey: z.string().min(1).max(512).optional(),
  error: z.string().max(8000).optional(),
}).strict();

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;

function assertId(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !ID_RE.test(value)) throw new Error(`${name} must be a canonical id`);
}

function assertRepo(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !REPO_RE.test(value)) throw new Error(`${name} must be an Artifacts repository name`);
}

function assertCommit(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !COMMIT_RE.test(value)) throw new Error(`${name} must be 40 lowercase hex`);
}

function assertRelativePath(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !value || value.length > 256 || value.startsWith("/") || value.endsWith("/") || value.includes("\\")) {
    throw new Error(`${name} must be a bounded relative path`);
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(`${name} must be a canonical relative path`);
}

function assertPrefix(name: string, value: unknown): asserts value is string {
  if (value === "") return;
  assertRelativePath(name, value);
}

function assertGenome(name: string, value: unknown): asserts value is VerificationGenomeRef {
  if (!value || typeof value !== "object") throw new Error(`${name} is required`);
  const ref = value as Partial<VerificationGenomeRef>;
  assertRepo(`${name}.repo`, ref.repo);
  assertCommit(`${name}.commit`, ref.commit);
  assertPrefix(`${name}.prefix`, ref.prefix);
  if (typeof ref.digest !== "string" || !DIGEST_RE.test(ref.digest)) throw new Error(`${name}.digest must be 64 lowercase hex`);
}

/** Validate untrusted wire data and make the optional checks list explicit for immutable persistence. */
export function normalizeVerificationRequest(value: unknown): VerificationRequest & { checks: VerificationCheck[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("verification request must be an object");
  const input = value as Partial<VerificationRequest>;
  if (input.version !== 1) throw new Error("verification request version must be 1");
  for (const field of ["id", "systemId", "planId", "candidateId", "artifactId"] as const) assertId(field, input[field]);
  const { id, systemId, planId, candidateId, artifactId } = input as VerificationRequest;
  if (!input.source || typeof input.source !== "object") throw new Error("source is required");
  assertRepo("source.repo", input.source.repo);
  assertCommit("source.commit", input.source.commit);
  assertGenome("genome", input.genome);
  if (input.pinnedGenome !== undefined) assertGenome("pinnedGenome", input.pinnedGenome);
  if (input.profile !== VERIFICATION_PROFILE) throw new Error(`profile must be ${VERIFICATION_PROFILE}`);
  const checks = input.checks ?? [];
  if (!Array.isArray(checks) || checks.length > VERIFICATION_MAX_CHECKS) throw new Error(`checks must contain at most ${VERIFICATION_MAX_CHECKS} entries`);
  const seen = new Set<string>();
  for (const check of checks) {
    if (!check || typeof check !== "object") throw new Error("each check must be an object");
    assertId("checks.criterionId", check.criterionId);
    assertId("checks.hookId", check.hookId);
    if (typeof check.command !== "string" || !check.command || check.command.length > VERIFICATION_CHECK_COMMAND_MAX || /[\0\r\n]/.test(check.command)) {
      throw new Error("checks.command must be a bounded single-line command");
    }
    const key = `${check.criterionId}\0${check.hookId}`;
    if (seen.has(key)) throw new Error(`duplicate check ${check.criterionId}/${check.hookId}`);
    seen.add(key);
  }
  return {
    version: 1,
    id,
    systemId,
    planId,
    candidateId,
    artifactId,
    source: { repo: input.source.repo, commit: input.source.commit },
    genome: { repo: input.genome.repo, commit: input.genome.commit, prefix: input.genome.prefix, digest: input.genome.digest },
    ...(input.pinnedGenome && { pinnedGenome: { ...input.pinnedGenome } }),
    profile: VERIFICATION_PROFILE,
    checks: checks.map((check) => ({ criterionId: check.criterionId, hookId: check.hookId, command: check.command })),
  };
}

/** A Genome source file (Genome-relative path): YAML, or one of the two intent sidecars. Nothing else is part of the model. */
export const isGenomeSource = (path: string): boolean => /\.ya?ml$/.test(path) || path === INTENT_BRIEF_PATH || path === INTENT_MANIFEST_PATH;

/**
 * Canonical digest for the exact Genome file set. Paths are sorted and text bytes are preserved.
 * Callers must provide repository-relative paths; duplicate paths are rejected rather than overwritten.
 */
export function verificationModelDigest(files: Iterable<readonly [string, string]>): string {
  const entries: [string, string][] = [];
  const seen = new Set<string>();
  for (const pair of files) {
    const [path, text] = pair;
    assertRelativePath("model file path", path);
    if (seen.has(path)) throw new Error(`duplicate model file path ${path}`);
    if (typeof text !== "string") throw new Error(`model file ${path} must be text`);
    seen.add(path);
    entries.push([path, text]);
  }
  entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return sha256Hex(JSON.stringify(entries));
}
