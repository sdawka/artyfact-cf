import { describe, expect, it, vi } from "vitest";
import type { VerificationRequest, VerificationResult } from "@artyfact/model";
import { verificationModelDigest } from "@artyfact/model";
import {
  authorizeVerification,
  handleVerificationHttp,
  planVerificationSteps,
  runVerificationPipeline,
  storeVerificationOutput,
  type VerificationHttpDeps,
} from "../src/verification.ts";

const COMMIT = "a".repeat(40);
const model = new Map([
  ["node.yaml", `id: system.artyfact\nkind: system\ncriteria:\n  - id: C.unit\n    hooks:\n      - id: hook.unit\n        engine: vitest\n        inputs:\n          command: npm test\n`],
]);
const base: VerificationRequest = {
  version: 1,
  id: "verify.1",
  systemId: "system.artyfact",
  planId: "plan.1",
  candidateId: "candidate.1",
  artifactId: "artifact.platform",
  source: { repo: "artyfact", commit: COMMIT },
  genome: { repo: "artyfact", commit: COMMIT, prefix: "genome", digest: verificationModelDigest(model) },
  profile: "artyfact-self-v1",
  checks: [{ criterionId: "C.unit", hookId: "hook.unit", command: "npm test" }],
};

describe("verification authorization", () => {
  it("binds the source identity, model digest, System, and exact accepted hook", () => {
    expect(authorizeVerification(base, model, model)).toEqual(base.checks);
    expect(() => authorizeVerification({ ...base, genome: { ...base.genome, digest: "b".repeat(64) } }, model, model)).toThrow(/digest/i);
    expect(() => authorizeVerification({ ...base, systemId: "system.other" }, model, model)).toThrow(/System/i);
    expect(() => authorizeVerification({ ...base, checks: [{ ...base.checks![0], command: "npm test && deploy" }] }, model, model)).toThrow(/authorized/i);
  });

  it("uses pinnedGenome to authorize checks while binding the effective model", () => {
    const effective = new Map([["node.yaml", "id: system.artyfact\nkind: system\n"]]);
    const request = {
      ...base,
      source: { repo: "artyfact", commit: "c".repeat(40) },
      genome: { repo: "artyfact", commit: "c".repeat(40), prefix: "system", digest: verificationModelDigest(effective) },
      pinnedGenome: base.genome,
    };
    expect(authorizeVerification(request, effective, model)).toEqual(base.checks);
  });
});

describe("verification plan", () => {
  it("is fixed, retries only infrastructure setup, and never receives Cloudflare credentials", () => {
    const steps = planVerificationSteps(base);
    expect(steps.slice(0, 3).map((s) => [s.name, s.command])).toEqual([
      ["install", "npm ci"],
      ["browser setup", "npx --no-install playwright install --with-deps chromium"],
      ["full gate", "npm run ci -- --ultra-compact"],
    ]);
    expect(steps.some((s) => s.command.includes("deploy"))).toBe(false);
    expect(steps.every((s) => s.cloudflareCredentials === undefined && s.secrets === undefined)).toBe(true);
    expect(steps.every((s) => s.cache === undefined)).toBe(true);
    expect(steps.map((s) => s.config.retries.limit)).toEqual([1, 1, 0, 0, 0]);
    expect(steps.find((s) => s.name === "check 1")?.command).toBe("npm test");
    expect(steps.find((s) => s.name === "package output")?.command).toContain("apps/platform/dist");
  });
});

describe("verification HTTP", () => {
  const queued = (request: VerificationRequest): VerificationResult => ({ version: 1, request: { ...request, checks: request.checks ?? [] }, status: "queued", steps: [] });
  function harness() {
    const results = new Map<string, VerificationResult>();
    const outputs = new Map<string, Uint8Array>();
    const start = vi.fn(async () => {});
    const deps: VerificationHttpDeps = {
      token: "verification-secret",
      authorize: async () => {},
      getResult: async (id) => results.get(id) ?? null,
      createQueued: async (result) => {
        if (results.has(result.request.id)) return false;
        results.set(result.request.id, result);
        return true;
      },
      replaceResult: async (result) => { results.set(result.request.id, result); },
      start,
      getOutput: async (key) => outputs.has(key) ? new Response(outputs.get(key)) : null,
    };
    return { deps, results, outputs, start };
  }

  it("requires the dedicated bearer and polls an immutable idempotent request", async () => {
    const h = harness();
    const unauthorized = await handleVerificationHttp(new Request("https://ci.test/verify", { method: "POST", body: JSON.stringify(base) }), h.deps);
    expect(unauthorized.status).toBe(401);
    const post = () => handleVerificationHttp(new Request("https://ci.test/verify", {
      method: "POST", headers: { authorization: "Bearer verification-secret", "content-type": "application/json" }, body: JSON.stringify(base),
    }), h.deps);
    expect((await post()).status).toBe(202);
    expect((await post()).status).toBe(202);
    expect(h.start).toHaveBeenCalledTimes(1);
    const polled = await handleVerificationHttp(new Request("https://ci.test/verify/verify.1", { headers: { authorization: "Bearer verification-secret" } }), h.deps);
    expect((await polled.json() as VerificationResult).status).toBe("queued");
    const conflict = await handleVerificationHttp(new Request("https://ci.test/verify", {
      method: "POST", headers: { authorization: "Bearer verification-secret", "content-type": "application/json" }, body: JSON.stringify({ ...base, planId: "plan.2" }),
    }), h.deps);
    expect(conflict.status).toBe(409);
  });

  it("serves output only for the passed result and exact stored key", async () => {
    const h = harness();
    const result = queued(base);
    h.results.set(base.id, { ...result, status: "passed", output: { key: "verification/v1/verify.1/output.tar.gz", digest: "d".repeat(64), size: 3 } });
    h.outputs.set("verification/v1/verify.1/output.tar.gz", new Uint8Array([1, 2, 3]));
    const response = await handleVerificationHttp(new Request("https://ci.test/verify/verify.1/output", { headers: { authorization: "Bearer verification-secret" } }), h.deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"${"d".repeat(64)}"`);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  });
});

describe("verification pipeline", () => {
  const trackedStream = () => {
    const cancel = vi.fn();
    return { cancel, stream: new ReadableStream<Uint8Array>({ cancel }) };
  };

  it("closes both log streams before chaining every successful intermediate runner", async () => {
    const streams = Array.from({ length: 9 }, trackedStream);
    const archive = btoa(String.fromCharCode(0x1f, 0x8b, 0x08, 0x00));
    const packageStderr = streams[8]!;
    const runners = [0, 2, 4, 6].map((offset, index) => ({
      exitCode: 0,
      logs: { stdout: streams[offset]!.stream, stderr: streams[offset + 1]!.stream },
      runner: async () => runners[index + 1] ?? packageRunner,
    }));
    const packageRunner = { exitCode: 0, logs: { stdout: archive, stderr: packageStderr.stream }, runner: async () => packageRunner };
    await runVerificationPipeline({
      request: base,
      authorize: async () => {},
      ci: { runner: async () => runners[0]! },
      now: async () => new Date(0).toISOString(),
      persist: async () => {},
      storeOutput: async (bytes) => ({ key: "output", digest: "d".repeat(64), size: bytes.byteLength }),
    });
    for (const tracked of streams) expect(tracked.cancel).toHaveBeenCalledOnce();
  });

  it("closes package stderr when package stdout is malformed", async () => {
    const packageStderr = trackedStream();
    const packageRunner = { exitCode: 0, logs: { stdout: "not base64", stderr: packageStderr.stream }, runner: async () => packageRunner };
    const intermediate = { exitCode: 0, logs: { stdout: "", stderr: "" }, runner: async () => packageRunner };
    const ci = { runner: async () => intermediate };
    await expect(runVerificationPipeline({
      request: { ...base, checks: [] },
      authorize: async () => {},
      ci,
      now: async () => new Date(0).toISOString(),
      persist: async () => {},
      storeOutput: async () => { throw new Error("must not store"); },
    })).rejects.toThrow(/canonical base64/i);
    expect(packageStderr.cancel).toHaveBeenCalledOnce();
  });

  it("does not package or publish output after a failed full gate", async () => {
    const planned: string[] = [];
    const saved: VerificationResult[] = [];
    const installLogs = [trackedStream(), trackedStream()];
    const browserLogs = [trackedStream(), trackedStream()];
    const failure = Object.assign(new Error("tests failed"), { name: "CiRunnerFailure", runner: { name: "full gate" } });
    const browserRunner = {
      exitCode: 0,
      logs: { stdout: browserLogs[0]!.stream, stderr: browserLogs[1]!.stream },
      runner: async (step: { name: string }) => { planned.push(step.name); throw failure; },
    };
    const installRunner = {
      exitCode: 0,
      logs: { stdout: installLogs[0]!.stream, stderr: installLogs[1]!.stream },
      runner: async (step: { name: string }) => { planned.push(step.name); return browserRunner; },
    };
    const ci = { runner: async (step: { name: string }) => { planned.push(step.name); return installRunner; } };
    await expect(runVerificationPipeline({
      request: base,
      authorize: async () => {},
      ci,
      now: (() => { let n = 0; return async () => new Date(n++ * 1000).toISOString(); })(),
      persist: async (result) => { saved.push(structuredClone(result)); },
      storeOutput: async () => { throw new Error("must not store"); },
    })).rejects.toThrow("tests failed");
    expect(planned).toEqual(["install", "browser setup", "full gate"]);
    for (const tracked of [...installLogs, ...browserLogs]) expect(tracked.cancel).toHaveBeenCalledOnce();
    expect(saved.at(-1)).toMatchObject({ status: "failed", steps: [{ name: "install", status: "passed" }, { name: "browser setup", status: "passed" }, { name: "full gate", status: "failed" }] });
    expect(saved.at(-1)?.output).toBeUndefined();
  });

  it("stores the immutable archive under a digest-bound R2 key", async () => {
    const objects = new Map<string, { bytes: Uint8Array; customMetadata?: Record<string, string> }>();
    const bucket = {
      head: async (key: string) => { const value = objects.get(key); return value ? { size: value.bytes.byteLength, customMetadata: value.customMetadata } : null; },
      put: async (key: string, bytes: Uint8Array | string, options?: { customMetadata?: Record<string, string> }) => {
        if (objects.has(key)) return null;
        objects.set(key, { bytes: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes, customMetadata: options?.customMetadata });
        return {};
      },
      get: async () => null,
    };
    const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
    await expect(storeVerificationOutput(bucket, base.id, bytes)).resolves.toEqual({
      key: "verification/v1/verify.1/output.tar.gz",
      digest: "fd72d30440b0bae1b1c6db6c8ad807f238ef3ca613aa7e8d5329e1e8ddf7da72",
      size: 4,
    });
    await expect(storeVerificationOutput(bucket, base.id, new Uint8Array([0x1f, 0x8b, 0x09]))).rejects.toThrow(/immutable/i);
  });
});
