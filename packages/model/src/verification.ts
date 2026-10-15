import { sha256Hex } from "@artyfact/rules";
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
  error?: string;
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const MAX_CHECKS = 64;
const MAX_COMMAND = 500;

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
  if (!Array.isArray(checks) || checks.length > MAX_CHECKS) throw new Error(`checks must contain at most ${MAX_CHECKS} entries`);
  const seen = new Set<string>();
  for (const check of checks) {
    if (!check || typeof check !== "object") throw new Error("each check must be an object");
    assertId("checks.criterionId", check.criterionId);
    assertId("checks.hookId", check.hookId);
    if (typeof check.command !== "string" || !check.command || check.command.length > MAX_COMMAND || /[\0\r\n]/.test(check.command)) {
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
