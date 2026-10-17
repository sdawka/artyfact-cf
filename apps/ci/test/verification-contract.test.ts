import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizeVerificationRequest,
  VERIFICATION_CHECK_COMMAND_MAX,
  VERIFICATION_MAX_CHECKS,
  VERIFICATION_OUTPUT_MAX_BYTES,
  VERIFICATION_RESULT_MAX_BYTES,
  VERIFICATION_STEP_COMMAND_MAX,
  verificationLogKey,
  verificationOutputKey,
  verificationResultSchema,
  type VerificationRequest,
  type VerificationResult,
} from "@artyfact/model";
import { PACKAGE_OUTPUT_COMMAND, planVerificationSteps, runVerificationPipeline } from "../src/verification.ts";

// The platform parses CI results with verificationResultSchema; every result CI can persist must pass it.
const COMMIT = "a".repeat(40);
const longId = (prefix: string, i = 0) => `${prefix}.${i}`.padEnd(200, "x");
const genome = { repo: "r".repeat(128), commit: COMMIT, prefix: "p".repeat(256), digest: "b".repeat(64) };
const request = (command: (i: number) => string): VerificationRequest => ({
  version: 1, id: longId("verify"), systemId: longId("system"), planId: longId("plan"), candidateId: longId("candidate"), artifactId: longId("artifact"),
  source: { repo: "s".repeat(128), commit: COMMIT }, genome, pinnedGenome: genome, profile: "artyfact-self-v1",
  checks: Array.from({ length: VERIFICATION_MAX_CHECKS }, (_, i) => ({ criterionId: longId("C", i), hookId: longId("hook", i), command: command(i) })),
});

async function persisted(input: VerificationRequest, fail = false): Promise<VerificationResult[]> {
  const saved: VerificationResult[] = [];
  const id = normalizeVerificationRequest(input).id;
  await runVerificationPipeline({
    request: input,
    authorize: async () => {},
    ci: { runner: async () => { if (fail) throw Object.assign(new Error("x".repeat(10_000)), { name: "CiRunnerFailure", runner: { name: "candidate verification" } }); return { exitCode: 0, snapshot: { id: "snap", dir: "/workspace" } }; } },
    now: async () => new Date(0).toISOString(),
    persist: async (result) => { saved.push(structuredClone(result)); },
    packageOutput: async () => ({ key: verificationOutputKey(id), digest: "c".repeat(64), size: VERIFICATION_OUTPUT_MAX_BYTES, logKey: verificationLogKey(id) }),
  }).catch((error) => { if (!fail) throw error; });
  return saved;
}

function expectAccepted(results: VerificationResult[]) {
  expect(results.length).toBeGreaterThan(0);
  for (const result of results) {
    const parsed = verificationResultSchema.safeParse(result);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(VERIFICATION_RESULT_MAX_BYTES);
  }
}

describe("verification result contract with the platform", () => {
  it("accepts every result persisted for a typical run, including package output and logKey", async () => {
    const results = await persisted({ ...request(() => "npm test"), checks: [{ criterionId: "C.unit", hookId: "hook.unit", command: "npm test" }] });
    expect(results.at(-1)).toMatchObject({ status: "passed", steps: [{ name: "candidate verification" }, { name: "package output" }] });
    expectAccepted(results);
  });

  it("accepts the largest run CI can produce from maximal checks", async () => {
    for (const command of [(i: number) => `npm test -- ${i}`.padEnd(VERIFICATION_CHECK_COMMAND_MAX, "a"), () => "'".repeat(VERIFICATION_CHECK_COMMAND_MAX)]) {
      const results = await persisted(request(command));
      expect(results.at(-1)?.status).toBe("passed");
      expectAccepted(results);
    }
  });

  it("truncates long step commands for display, naming the full command's digest", async () => {
    const input = request(() => "'".repeat(VERIFICATION_CHECK_COMMAND_MAX));
    const planned = planVerificationSteps(normalizeVerificationRequest(input)).map((step) => step.command);
    expect(planned[1]).toBe(PACKAGE_OUTPUT_COMMAND);
    const steps = (await persisted(input)).at(-1)!.steps;
    steps.forEach((step, i) => {
      const digest = createHash("sha256").update(planned[i]!).digest("hex").slice(0, 12);
      expect(planned[i]!.length).toBeGreaterThan(VERIFICATION_STEP_COMMAND_MAX);
      expect(step.command).toHaveLength(VERIFICATION_STEP_COMMAND_MAX);
      expect(step.command).toBe(planned[i]!.slice(0, step.command.indexOf("… [truncated")) + `… [truncated; sha256:${digest}]`);
    });
  });

  it("accepts a failed run with its bounded error", async () => {
    const results = await persisted(request(() => "'".repeat(VERIFICATION_CHECK_COMMAND_MAX)), true);
    expect(results.at(-1)?.status).toBe("failed");
    expectAccepted(results);
  });
});
