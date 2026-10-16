import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerificationRequest, VerificationResult } from "@artyfact/model";
import { VERIFICATION_OUTPUT_MAX_BYTES, verificationModelDigest } from "@artyfact/model";
import {
  boundedStderr,
  GATE_TAIL_BYTES,
  PACKAGE_OUTPUT_COMMAND,
  PACKAGE_SOURCE_MAX_BYTES,
  packageOutputCommand,
  packageVerificationOutput,
  type PackageSandbox,
  authorized,
  authorizeVerification,
  createQueuedResult,
  failQueuedResult,
  getVerificationResult,
  handleVerificationHttp,
  persistVerificationResult,
  planVerificationSteps,
  runVerificationPipeline,
  storeVerificationOutput,
  VERIFICATION_STALE_MS,
  type VerificationBucketLike,
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
  it("indexes the exported source before installation adds generated files", () => {
    const root = mkdtempSync(join(tmpdir(), "artyfact-export-test-"));
    const workspace = join(root, "workspace");
    const bin = join(root, "bin");
    try {
      mkdirSync(workspace);
      mkdirSync(bin);
      writeFileSync(join(workspace, ".gitignore"), "tracked.txt\nnode_modules/\n");
      writeFileSync(join(workspace, "tracked.txt"), "an ignored but committed source file\n");
      writeFileSync(join(bin, "npm"), "#!/bin/sh\nmkdir -p node_modules\nprintf generated > node_modules/output\n", { mode: 0o755 });
      writeFileSync(join(bin, "npx"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const command = planVerificationSteps({ ...base, checks: [] })[0]!.command;
      execFileSync("sh", ["-c", command], { cwd: workspace, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: "pipe" });
      const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: workspace, encoding: "utf8" }).split("\0").filter(Boolean);
      expect(tracked).toEqual([".gitignore", "tracked.txt"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs setup, the full gate, and exact quoted checks in one bounded credentialless runner", () => {
    const request = { ...base, checks: [{ ...base.checks![0], command: `printf '%s\\n' "it's exact" # comment` }] };
    const steps = planVerificationSteps(request);
    expect(steps.map((s) => s.name)).toEqual(["candidate verification", "package output"]);
    expect(steps[0]?.command).toContain("sh -c 'npm ci'");
    expect(steps[0]?.command).toContain("sh -c 'npx --no-install playwright install --with-deps chromium'");
    expect(steps[0]?.command).toContain("sh -c 'npm run ci -- --ultra-compact'");
    expect(steps[0]?.command).toContain(`sh -c 'printf '"'"'%s\\n'"'"' "it'"'"'s exact" # comment'`);
    expect(steps.some((s) => s.command.includes("deploy"))).toBe(false);
    expect(steps.every((s) => s.cloudflareCredentials === undefined && s.secrets === undefined)).toBe(true);
    expect(steps.every((s) => s.cache === undefined)).toBe(true);
    expect(steps[0]?.config).toEqual({ retries: { limit: 0, delay: 1_000 }, timeout: 1_800_000, commandTimeoutMs: 1_740_000 });
    expect(steps.find((s) => s.name === "package output")?.command).toContain("apps/platform/dist");
  });
});

describe("verification gate log", () => {
  /** Run the planned gate in a scratch workspace whose fake `npm` prints `bytes` of log and exits `status` on `npm run`. */
  function runGate(bytes: number, status: number) {
    const root = mkdtempSync(join(tmpdir(), "artyfact-gate-test-"));
    const workspace = join(root, "workspace"), bin = join(root, "bin");
    mkdirSync(workspace);
    mkdirSync(bin);
    writeFileSync(join(workspace, "source.txt"), "source\n");
    writeFileSync(join(bin, "npm"), `#!/bin/sh\nif [ "$1" = run ]; then head -c ${bytes} /dev/zero | tr '\\0' x; echo; echo end-of-log >&2; exit ${status}; fi\n`, { mode: 0o755 });
    writeFileSync(join(bin, "npx"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const command = planVerificationSteps({ ...base, checks: [] })[0]!.command;
    let stdout: Buffer, exitCode = 0;
    try {
      stdout = execFileSync("sh", ["-c", command], { cwd: workspace, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
      const failure = error as { status: number; stdout: Buffer };
      stdout = failure.stdout;
      exitCode = failure.status;
    }
    return { root, workspace, stdout, exitCode };
  }

  it("prints only a bounded tail and keeps the full log in the workspace when the gate passes", () => {
    const run = runGate(500_000, 0);
    try {
      expect(run.exitCode).toBe(0);
      expect(run.stdout.byteLength).toBe(GATE_TAIL_BYTES);
      expect(run.stdout.toString().endsWith("end-of-log\n")).toBe(true);
      const log = readFileSync(join(run.workspace, ".verification/gate.log"), "utf8");
      expect(log.length).toBeGreaterThan(500_000);
      const tracked = execFileSync("git", ["ls-files"], { cwd: run.workspace, encoding: "utf8" }).trim().split("\n");
      expect(tracked).toEqual(["source.txt"]);
    } finally {
      rmSync(run.root, { recursive: true, force: true });
    }
  });

  it("keeps the failing command's exit status and a bounded tail", () => {
    const run = runGate(500_000, 3);
    try {
      expect(run.exitCode).toBe(3);
      expect(run.stdout.byteLength).toBe(GATE_TAIL_BYTES);
      expect(run.stdout.toString().endsWith("end-of-log\n")).toBe(true);
      expect(existsSync(join(run.workspace, ".verification"))).toBe(false);
    } finally {
      rmSync(run.root, { recursive: true, force: true });
    }
  });
});

describe("package command against a candidate workspace", () => {
  const gnuTar = (() => { try { return execFileSync("tar", ["--version"], { encoding: "utf8" }).includes("GNU tar"); } catch { return false; } })();

  /** A workspace with valid built output, a gate log, and a secret outside it that an attack would try to package. */
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "artyfact-package-test-"));
    const workspace = join(root, "workspace"), bin = join(root, "bin"), secret = join(root, "secret");
    const write = (path: string, text: string) => { mkdirSync(join(workspace, path, ".."), { recursive: true }); writeFileSync(join(workspace, path), text); };
    write("apps/platform/dist/artyfact_platform/wrangler.json", "{}");
    write("apps/platform/dist/artyfact_platform/index.js", "export default {}");
    write("apps/platform/dist/artyfact_platform/.dev.vars", "SECRET=1");
    write("apps/platform/dist/client/index.html", "<p>platform</p>");
    write("apps/platform/dist/client/.assetsignore", "wrangler.json");
    write("apps/site/dist/index.html", "<p>site</p>");
    write("apps/site/wrangler.jsonc", "{}");
    write(".verification/gate.log", "gate passed\n");
    mkdirSync(join(secret, "dist"), { recursive: true });
    writeFileSync(join(secret, "environ"), "CF_TOKEN=leaked");
    writeFileSync(join(secret, "dist/index.html"), "CF_TOKEN=leaked");
    writeFileSync(join(secret, "wrangler.jsonc"), "CF_TOKEN=leaked");
    mkdirSync(bin);
    // BSD tar has no --sort; a stand-in archiver keeps the checks testable off Linux.
    if (!gnuTar) writeFileSync(join(bin, "tar"), '#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = -cf ]; then out=$2; fi; shift; done\nprintf stand-in > "$out"\n', { mode: 0o755 });
    const archive = join(root, "out.tgz"), log = join(root, "gate.log");
    const run = () => {
      try {
        execFileSync("sh", ["-c", boundedStderr(packageOutputCommand(archive, log))], { cwd: workspace, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: "pipe" });
        return { exitCode: 0, stderr: "" };
      } catch (error) {
        const failure = error as { status: number; stderr: Buffer };
        return { exitCode: failure.status, stderr: failure.stderr.toString() };
      }
    };
    return { root, workspace, secret, archive, log, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  it("archives valid output without dotfiles, deterministically, and copies the gate log", () => {
    const f = fixture();
    try {
      expect(f.run()).toEqual({ exitCode: 0, stderr: "" });
      const first = readFileSync(f.archive);
      expect([first[0], first[1]]).toEqual([0x1f, 0x8b]);
      expect(readFileSync(f.log, "utf8")).toBe("gate passed\n");
      if (gnuTar) {
        const entries = execFileSync("tar", ["-tzf", f.archive], { encoding: "utf8" }).trim().split("\n");
        expect(entries).toContain("platform/client/index.html");
        expect(entries).toContain("site/wrangler.jsonc");
        expect(entries.some((entry) => entry.split("/").some((part) => part.startsWith(".")))).toBe(false);
        expect(f.run().exitCode).toBe(0);
        expect(readFileSync(f.archive)).toEqual(first);
      }
    } finally {
      f.cleanup();
    }
  });

  const attacks: [string, (f: ReturnType<typeof fixture>) => void, RegExp][] = [
    ["a symlinked wrangler.jsonc", (f) => { rmSync(join(f.workspace, "apps/site/wrangler.jsonc")); symlinkSync(join(f.secret, "environ"), join(f.workspace, "apps/site/wrangler.jsonc")); }, /apps\/site\/wrangler.jsonc is a symlink/],
    ["a symlinked parent directory", (f) => { rmSync(join(f.workspace, "apps/site"), { recursive: true }); symlinkSync(f.secret, join(f.workspace, "apps/site")); }, /apps\/site is a symlink/],
    ["a symlinked apps directory", (f) => { const moved = join(f.root, "apps"); execFileSync("mv", [join(f.workspace, "apps"), moved]); symlinkSync(moved, join(f.workspace, "apps")); }, /apps is a symlink/],
    ["a symlink inside dist", (f) => { symlinkSync(join(f.secret, "environ"), join(f.workspace, "apps/platform/dist/client/environ")); }, /output contains a symlink/],
    ["a hardlink inside dist", (f) => { linkSync(join(f.secret, "environ"), join(f.workspace, "apps/site/dist/environ")); }, /output contains a hardlink/],
    ["a fifo inside dist", (f) => { execFileSync("mkfifo", [join(f.workspace, "apps/site/dist/pipe")]); }, /unsupported file type/],
    ["a sparse file over the source cap", (f) => { const big = join(f.workspace, "apps/site/dist/big.bin"); writeFileSync(big, ""); truncateSync(big, PACKAGE_SOURCE_MAX_BYTES + 1); }, /exceeds the source limit/],
    ["missing built output", (f) => { rmSync(join(f.workspace, "apps/site/dist/index.html")); }, /^$/],
  ];
  for (const [name, attack, message] of attacks) {
    it(`refuses ${name} before packaging`, () => {
      const f = fixture();
      try {
        attack(f);
        const result = f.run();
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toMatch(message);
        expect(existsSync(f.archive)).toBe(false);
      } finally {
        f.cleanup();
      }
    });
  }

  it("does not follow a symlinked gate log or .verification directory", () => {
    for (const attack of [
      (f: ReturnType<typeof fixture>) => { rmSync(join(f.workspace, ".verification/gate.log")); symlinkSync(join(f.secret, "environ"), join(f.workspace, ".verification/gate.log")); },
      (f: ReturnType<typeof fixture>) => { rmSync(join(f.workspace, ".verification"), { recursive: true }); writeFileSync(join(f.secret, "gate.log"), "CF_TOKEN=leaked"); symlinkSync(f.secret, join(f.workspace, ".verification")); },
      (f: ReturnType<typeof fixture>) => { rmSync(join(f.workspace, ".verification/gate.log")); linkSync(join(f.secret, "environ"), join(f.workspace, ".verification/gate.log")); },
    ]) {
      const f = fixture();
      try {
        attack(f);
        expect(f.run().exitCode).toBe(0);
        expect(readFileSync(f.log, "utf8")).toBe("gate log is missing or unsafe\n");
      } finally {
        f.cleanup();
      }
    }
  });

  it("keeps the package command's set -e semantics and bounds its stderr", () => {
    const run = (command: string) => {
      try { execFileSync("sh", ["-c", boundedStderr(command)], { stdio: "pipe" }); return { exitCode: 0, stderr: "" }; }
      catch (error) { const e = error as { status: number; stderr: Buffer }; return { exitCode: e.status, stderr: e.stderr.toString() }; }
    };
    expect(run("set -eu\nfalse\necho unreachable >&2")).toEqual({ exitCode: 1, stderr: "" });
    const noisy = run("head -c 100000 /dev/zero | tr '\\0' e >&2; exit 4");
    expect(noisy.exitCode).toBe(4);
    expect(noisy.stderr.length).toBe(2_000);
  });
});

describe("trusted package step", () => {
  const snapshot = { id: "backup-1", dir: "/workspace" };
  const archive = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
  const streamOf = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });

  function harness(files: Record<string, { bytes: Uint8Array; size?: number }>, exitCode = 0) {
    const calls: string[] = [];
    const destroy = vi.fn(async () => {});
    const sandbox: PackageSandbox = {
      restoreBackup: async (backup) => { calls.push(`restore ${backup.id}`); },
      exec: async (command, options) => { calls.push(`exec ${options.cwd} ${command === boundedStderr(PACKAGE_OUTPUT_COMMAND)}`); return { exitCode, stderr: exitCode ? "tar failed" : "" }; },
      readFile: async (path) => {
        const file = files[path];
        if (!file) throw new Error(`missing ${path}`);
        return { content: streamOf(file.bytes), size: file.size ?? file.bytes.byteLength };
      },
      destroy,
    };
    const objects = new Map<string, { bytes: Uint8Array; customMetadata?: Record<string, string> }>();
    const bucket: VerificationBucketLike = {
      head: async (key) => { const value = objects.get(key); return value ? { size: value.bytes.byteLength, customMetadata: value.customMetadata } : null; },
      put: async (key, value, options) => {
        if (options?.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) return null;
        objects.set(key, { bytes: typeof value === "string" ? new TextEncoder().encode(value) : value, customMetadata: options?.customMetadata });
        return {};
      },
      get: async () => null,
    };
    return { sandbox, bucket, objects, calls, destroy };
  }

  it("stores the archive and gate log in R2 and returns only their references", async () => {
    const log = new TextEncoder().encode("gate passed\n");
    const h = harness({ "/tmp/out.tgz": { bytes: archive }, "/tmp/gate.log": { bytes: log } });
    const packaged = await packageVerificationOutput({ sandbox: h.sandbox, snapshot, bucket: h.bucket, id: base.id });
    expect(packaged).toEqual({
      key: "verification/v1/verify.1/output.tar.gz",
      digest: "fd72d30440b0bae1b1c6db6c8ad807f238ef3ca613aa7e8d5329e1e8ddf7da72",
      size: 4,
      logKey: "verification/v1/verify.1/gate.log",
    });
    expect(structuredClone(packaged)).toEqual(packaged);
    expect(h.calls).toEqual(["restore backup-1", "exec /workspace true"]);
    expect([...h.objects.get(packaged.key)!.bytes]).toEqual([...archive]);
    expect(h.objects.get(packaged.key)!.customMetadata).toEqual({ digest: packaged.digest });
    expect(h.objects.get(packaged.logKey)!.bytes).toEqual(log);
    expect(h.destroy).toHaveBeenCalledOnce();
    // A retry rebuilds the same deterministic archive and reuses the stored object.
    await expect(packageVerificationOutput({ sandbox: h.sandbox, snapshot, bucket: h.bucket, id: base.id })).resolves.toEqual(packaged);
  });

  it("never overwrites a stored gate log with different bytes", async () => {
    const h = harness({ "/tmp/out.tgz": { bytes: archive }, "/tmp/gate.log": { bytes: new TextEncoder().encode("second\n") } });
    await h.bucket.put("verification/v1/verify.1/gate.log", new TextEncoder().encode("first\n"), { customMetadata: { digest: "0".repeat(64) } });
    await expect(packageVerificationOutput({ sandbox: h.sandbox, snapshot, bucket: h.bucket, id: base.id })).rejects.toThrow(/gate log is immutable/);
    expect(new TextDecoder().decode(h.objects.get("verification/v1/verify.1/gate.log")!.bytes)).toBe("first\n");
    expect(h.destroy).toHaveBeenCalledOnce();
  });

  it("writes the archive to a file instead of printing it", () => {
    expect(PACKAGE_OUTPUT_COMMAND).not.toContain("base64");
    expect(PACKAGE_OUTPUT_COMMAND).toContain("archive=/tmp/out.tgz");
    expect(PACKAGE_OUTPUT_COMMAND).toContain("gzip -n");
    expect(PACKAGE_OUTPUT_COMMAND).toContain("--mtime=@0");
  });

  it("refuses an archive over the size cap before reading it and destroys the sandbox", async () => {
    const h = harness({ "/tmp/out.tgz": { bytes: archive, size: VERIFICATION_OUTPUT_MAX_BYTES + 1 }, "/tmp/gate.log": { bytes: new Uint8Array() } });
    await expect(packageVerificationOutput({ sandbox: h.sandbox, snapshot, bucket: h.bucket, id: base.id })).rejects.toThrow(/package output exceeds the limit/);
    expect(h.objects.has("verification/v1/verify.1/output.tar.gz")).toBe(false);
    expect(h.destroy).toHaveBeenCalledOnce();
  });

  it("refuses a stream longer than its reported size", async () => {
    const h = harness({ "/tmp/out.tgz": { bytes: archive, size: 2 }, "/tmp/gate.log": { bytes: new Uint8Array() } });
    await expect(packageVerificationOutput({ sandbox: h.sandbox, snapshot, bucket: h.bucket, id: base.id })).rejects.toThrow(/larger than reported/);
    expect(h.objects.has("verification/v1/verify.1/output.tar.gz")).toBe(false);
    expect(h.destroy).toHaveBeenCalledOnce();
  });

  it("refuses bytes that are not gzip", async () => {
    const h = harness({ "/tmp/out.tgz": { bytes: new Uint8Array([1, 2, 3]) }, "/tmp/gate.log": { bytes: new Uint8Array() } });
    await expect(packageVerificationOutput({ sandbox: h.sandbox, snapshot, bucket: h.bucket, id: base.id })).rejects.toThrow(/not gzip/);
    expect(h.destroy).toHaveBeenCalledOnce();
  });

  it("destroys the sandbox when the package command fails", async () => {
    const h = harness({}, 1);
    await expect(packageVerificationOutput({ sandbox: h.sandbox, snapshot, bucket: h.bucket, id: base.id })).rejects.toThrow(/package output exited 1: tar failed/);
    expect(h.objects.size).toBe(0);
    expect(h.destroy).toHaveBeenCalledOnce();
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
      failQueued: async (result) => {
        if (results.get(result.request.id)?.status !== "queued") return results.get(result.request.id) ?? null;
        results.set(result.request.id, result);
        return result;
      },
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
  const snapshot = { id: "backup-1", dir: "/workspace" };
  const packaged = { key: "verification/v1/verify.1/output.tar.gz", digest: "d".repeat(64), size: 4, logKey: "verification/v1/verify.1/gate.log" };

  it("runs the gate in one live runner, then packages its snapshot in the trusted step", async () => {
    const streams = Array.from({ length: 2 }, trackedStream);
    const planned: string[] = [];
    const packagedFrom: unknown[] = [];
    const candidateRunner = { exitCode: 0, logs: { stdout: streams[0]!.stream, stderr: streams[1]!.stream }, snapshot };
    const result = await runVerificationPipeline({
      request: base,
      authorize: async () => {},
      ci: { runner: async (step: { name: string }) => { planned.push(step.name); return candidateRunner; } },
      now: async () => new Date(0).toISOString(),
      persist: async () => {},
      packageOutput: async (step, from) => { planned.push(step.name); packagedFrom.push(from); return packaged; },
    });
    expect(planned).toEqual(["candidate verification", "package output"]);
    expect(packagedFrom).toEqual([snapshot]);
    expect(result.steps.map((step) => [step.name, step.status])).toEqual([["candidate verification", "passed"], ["package output", "passed"]]);
    expect(result.checks).toEqual([{ ...base.checks![0], status: "passed" }]);
    expect(result.output).toEqual({ key: packaged.key, digest: packaged.digest, size: packaged.size });
    expect(result.logKey).toBe(packaged.logKey);
    expect(result.status).toBe("passed");
    for (const tracked of streams) expect(tracked.cancel).toHaveBeenCalledOnce();
  });

  it("records a package failure as an error on the package step", async () => {
    const saved: VerificationResult[] = [];
    await expect(runVerificationPipeline({
      request: { ...base, checks: [] },
      authorize: async () => {},
      ci: { runner: async () => ({ exitCode: 0, logs: { stdout: "", stderr: "" }, snapshot }) },
      now: async () => new Date(0).toISOString(),
      persist: async (result) => { saved.push(structuredClone(result)); },
      packageOutput: async () => { throw new Error("package output exceeds the limit"); },
    })).rejects.toThrow(/exceeds the limit/);
    expect(saved.at(-1)).toMatchObject({ status: "error", error: "package output exceeds the limit", steps: [{ name: "candidate verification", status: "passed" }, { name: "package output", status: "error" }] });
    expect(saved.at(-1)?.output).toBeUndefined();
  });

  it("does not package, publish, or mark checks passed after combined candidate execution fails", async () => {
    const planned: string[] = [];
    const saved: VerificationResult[] = [];
    const failure = Object.assign(new Error("tests failed"), { name: "CiRunnerFailure", runner: { name: "candidate verification" } });
    const ci = { runner: async (step: { name: string }) => { planned.push(step.name); throw failure; } };
    await expect(runVerificationPipeline({
      request: base,
      authorize: async () => {},
      ci,
      now: (() => { let n = 0; return async () => new Date(n++ * 1000).toISOString(); })(),
      persist: async (result) => { saved.push(structuredClone(result)); },
      packageOutput: async () => { throw new Error("must not package"); },
    })).rejects.toThrow("tests failed");
    expect(planned).toEqual(["candidate verification"]);
    expect(saved.at(-1)).toMatchObject({ status: "failed", steps: [{ name: "candidate verification", status: "failed" }], checks: [] });
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

describe("verification result store", () => {
  /** An R2 stand-in with etags, upload times, and the two conditional-put forms the store uses. */
  function fakeBucket() {
    const objects = new Map<string, { text: string; etag: string; uploaded: Date }>();
    let clock = 0, version = 0;
    const bucket: VerificationBucketLike & { advance(ms: number): void } = {
      advance: (ms) => { clock += ms; },
      head: async () => null,
      put: async (key, value, options) => {
        const current = objects.get(key);
        if (options?.onlyIf?.etagDoesNotMatch === "*" && current) return null;
        if (options?.onlyIf?.etagMatches !== undefined && current?.etag !== options.onlyIf.etagMatches) return null;
        objects.set(key, { text: String(value), etag: `e${++version}`, uploaded: new Date(clock) });
        return {};
      },
      get: async (key) => {
        const o = objects.get(key);
        return o ? { body: new ReadableStream(), text: async () => o.text, etag: o.etag, uploaded: o.uploaded } : null;
      },
    };
    return bucket;
  }
  const queuedOf = (): VerificationResult => ({ version: 1, request: { ...base, checks: base.checks ?? [] }, status: "queued", steps: [] });

  it("writes progress by compare-and-swap and keeps terminal results immutable", async () => {
    const bucket = fakeBucket();
    expect(await createQueuedResult(bucket, queuedOf())).toBe(true);
    expect(await createQueuedResult(bucket, queuedOf())).toBe(false);
    await persistVerificationResult(bucket, { ...queuedOf(), status: "running", startedAt: "t0" });
    const failed: VerificationResult = { ...queuedOf(), status: "failed", finishedAt: "t1" };
    await persistVerificationResult(bucket, failed);
    await expect(persistVerificationResult(bucket, failed)).resolves.toBeUndefined();
    await expect(persistVerificationResult(bucket, { ...queuedOf(), status: "passed" })).rejects.toThrow(/immutable/);
  });

  it("never lets a start failure overwrite a run that already progressed", async () => {
    const bucket = fakeBucket();
    await createQueuedResult(bucket, queuedOf());
    const running: VerificationResult = { ...queuedOf(), status: "running", startedAt: "t0" };
    await persistVerificationResult(bucket, running);
    const error: VerificationResult = { ...queuedOf(), status: "error", error: "start failed" };
    expect(await failQueuedResult(bucket, error)).toEqual(running);
    const other = fakeBucket();
    await createQueuedResult(other, queuedOf());
    expect(await failQueuedResult(other, error)).toEqual(error);
  });

  it("settles a run without progress past the bound as error, and a late writer cannot revive it", async () => {
    const bucket = fakeBucket();
    await createQueuedResult(bucket, queuedOf());
    await persistVerificationResult(bucket, { ...queuedOf(), status: "running", startedAt: "t0" });
    expect((await getVerificationResult(bucket, base.id, new Date(VERIFICATION_STALE_MS - 1)))?.status).toBe("running");
    const settled = await getVerificationResult(bucket, base.id, new Date(VERIFICATION_STALE_MS));
    expect(settled).toMatchObject({ status: "error", error: expect.stringMatching(/no progress/) });
    await expect(persistVerificationResult(bucket, { ...queuedOf(), status: "passed" })).rejects.toThrow(/immutable/);
  });

  it("answers 202 with the stored run when the Workflow start fails after it progressed", async () => {
    const results = new Map<string, VerificationResult>();
    const deps: VerificationHttpDeps = {
      token: "verification-secret", authorize: async () => {},
      getResult: async (id) => results.get(id) ?? null,
      createQueued: async (result) => { results.set(result.request.id, result); return true; },
      failQueued: async () => ({ ...queuedOf(), status: "running" }),
      start: async () => { throw new Error("create timed out"); },
      getOutput: async () => null,
    };
    const response = await handleVerificationHttp(new Request("https://ci.test/verify", {
      method: "POST", headers: { authorization: "Bearer verification-secret", "content-type": "application/json" }, body: JSON.stringify(base),
    }), deps);
    expect(response.status).toBe(202);
    expect((await response.json() as VerificationResult).status).toBe("running");
  });
});

describe("authorized", () => {
  it("accepts the bare token when the configured secret ends with a newline", async () => {
    expect(await authorized("Bearer s3cret", "s3cret\n")).toBe(true);
    expect(await authorized("Bearer s3cret", "s3cret\r\n")).toBe(true);
  });

  it("still matches the header exactly", async () => {
    expect(await authorized("Bearer s3cret\n", "s3cret\n")).toBe(false);
    expect(await authorized("Bearer s3cret ", "s3cret")).toBe(false);
    expect(await authorized("Bearer s3cre", "s3cret")).toBe(false);
  });

  it("rejects everything when the secret is empty or whitespace", async () => {
    expect(await authorized("Bearer ", "")).toBe(false);
    expect(await authorized("Bearer ", "\n")).toBe(false);
    expect(await authorized("Bearer  ", "  ")).toBe(false);
  });
});
