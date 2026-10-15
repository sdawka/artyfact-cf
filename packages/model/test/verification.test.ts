import { describe, expect, it } from "vitest";
import { normalizeVerificationRequest, verificationModelDigest } from "../src/verification.ts";

const COMMIT = "a".repeat(40);
const request = {
  version: 1 as const,
  id: "verify.system-artyfact.1",
  systemId: "system.artyfact",
  planId: "plan.1",
  candidateId: "candidate.1",
  artifactId: "artifact.platform",
  source: { repo: "artyfact", commit: COMMIT },
  genome: { repo: "artyfact", commit: COMMIT, prefix: "genome", digest: "b".repeat(64) },
  profile: "artyfact-self-v1" as const,
};

describe("verification model contract", () => {
  it("hashes sorted normalized path and text pairs", () => {
    expect(verificationModelDigest([
      ["genome/b.yaml", "b"],
      ["genome/a.yaml", "a"],
    ])).toBe("a0cb11eef3204fa68ce8f819c9bfdef64763853c4c43d6b8a9290761708e7034");
  });

  it("rejects duplicate and unsafe model paths", () => {
    expect(() => verificationModelDigest([["genome/a.yaml", "a"], ["genome/a.yaml", "b"]])).toThrow(/duplicate/i);
    expect(() => verificationModelDigest([["../node.yaml", "x"]])).toThrow(/relative/i);
  });

  it("normalizes omitted checks and rejects non-canonical identities", () => {
    expect(normalizeVerificationRequest(request)).toEqual({ ...request, checks: [] });
    expect(() => normalizeVerificationRequest({ ...request, id: "../verify" })).toThrow(/id/i);
    expect(() => normalizeVerificationRequest({ ...request, source: { ...request.source, commit: "main" } })).toThrow(/commit/i);
    expect(() => normalizeVerificationRequest({ ...request, genome: { ...request.genome, prefix: "/genome" } })).toThrow(/prefix/i);
  });

  it("accepts only bounded exact hook identities and commands", () => {
    const checks = [{ criterionId: "C.artyfact.unit", hookId: "hook.artyfact.unit", command: "npm test" }];
    expect(normalizeVerificationRequest({ ...request, checks }).checks).toEqual(checks);
    expect(() => normalizeVerificationRequest({ ...request, checks: [{ ...checks[0], command: "npm test\nprintenv" }] })).toThrow(/command/i);
    expect(() => normalizeVerificationRequest({ ...request, checks: Array.from({ length: 65 }, () => checks[0]) })).toThrow(/checks/i);
  });
});
