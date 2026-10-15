import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import type { Cloud } from "../src/cloud.ts";
import { importVerificationArchive, operatorCommand, operatorVars, prepareActivation, publishVerifiedRelease, validateActivation, verifiedReleaseIdentity, type Activation } from "../src/operator.ts";
import { modelDigestAt } from "../src/release.ts";

const tmp = mkdtempSync(join(tmpdir(), "artyfact-operator-test-"));
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const IDENT = ["-c", "user.name=test", "-c", "user.email=test@localhost"];
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function tar(entries: { name: string; body?: Buffer; type?: "0" | "5" | "2" }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const h = Buffer.alloc(512);
    h.write(e.name, 0, 100, "utf8");
    h.write("0000644\0", 100, 8, "ascii"); h.write("0000000\0", 108, 8, "ascii"); h.write("0000000\0", 116, 8, "ascii");
    const body = e.body ?? Buffer.alloc(0);
    h.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    h.write("00000000000\0", 136, 12, "ascii"); h.fill(0x20, 148, 156); h[156] = (e.type ?? "0").charCodeAt(0);
    h.write("ustar\0", 257, 6, "ascii"); h.write("00", 263, 2, "ascii");
    const sum = [...h].reduce((n, b) => n + b, 0);
    h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const required = () => tar([
  { name: "platform/artyfact_platform/wrangler.json", body: Buffer.from("{}") },
  { name: "platform/artyfact_platform/index.js", body: Buffer.from("export default {}") },
  { name: "platform/client/index.html", body: Buffer.from("<!doctype html>") },
  { name: "site/dist/index.html", body: Buffer.from("site") },
  { name: "site/wrangler.jsonc", body: Buffer.from("{}") },
]);
const outputOf = (bytes: Buffer) => ({ key: "verification/run.tar.gz", digest: createHash("sha256").update(bytes).digest("hex"), size: bytes.length });

function repo(name: string) {
  const source = join(tmp, `${name}-source`), bare = join(tmp, `${name}.git`);
  mkdirSync(join(source, "system"), { recursive: true });
  writeFileSync(join(source, "system/node.yaml"), "id: system.artyfact\n");
  writeFileSync(join(source, "package.json"), '{"workspaces":["apps/*"]}\n');
  writeFileSync(join(source, "package-lock.json"), '{"lockfileVersion":3}\n');
  sh(source, "init", "-q", "-b", "main"); sh(source, "add", "-A"); sh(source, ...IDENT, "commit", "-q", "-m", "source");
  const commit = sh(source, "rev-parse", "HEAD"), digest = modelDigestAt(source, commit, "system");
  sh(tmp, "clone", "-q", "--bare", source, bare);
  return { source, bare, commit, digest };
}

function cloud(sourceName: string, sourceBare: string) {
  const builds = join(tmp, `${sourceName}-builds.git`);
  const c: Cloud = {
    account: () => "a".repeat(32), ensureNamespace: () => "exists",
    repoExists: (_ns, name) => name === sourceName ? true : existsSync(builds),
    createRepo: (_ns, name) => { if (name !== "platform.builds") throw new Error(name); sh(tmp, "init", "-q", "--bare", "-b", "main", builds); },
    token: () => "read-token", fork: () => { throw new Error("unused"); },
    remote: (_ns, name) => `file://${name === sourceName ? sourceBare : builds}`,
  };
  return { c, builds };
}

function activation(name: string, commit: string, digest: string, output = outputOf(required())): Activation {
  const source = { repo: name, commit }, genome = { repo: name, commit, prefix: "system", digest };
  const verification = { version: 1 as const, request: { version: 1 as const, id: "verify-1", systemId: "system.artyfact", planId: "plan.self", candidateId: "candidate.one", artifactId: "artifact.platform", source, genome, profile: "artyfact-self-v1" as const, checks: [] }, status: "passed" as const, steps: [{ name: "ci", command: "npm run ci -- --ultra-compact", status: "passed" as const }], finishedAt: "2026-10-14T20:00:00.000Z", output };
  return { systemId: "system.artyfact", planId: "plan.self", systemCommit: "sc-2-bbbbbbbb", source, genome, verification };
}

describe("trusted verification output import", () => {
  it("checks the digest and imports only the fixed release layout", () => {
    const bytes = required(), dest = join(tmp, "import-good");
    importVerificationArchive(bytes, outputOf(bytes), dest);
    expect(readFileSync(join(dest, "platform/client/index.html"), "utf8")).toContain("doctype");
    expect(existsSync(join(dest, "release.json"))).toBe(false);
    expect(() => importVerificationArchive(bytes, { ...outputOf(bytes), digest: "0".repeat(64) }, join(tmp, "bad-digest"))).toThrow(/digest/);
  });

  it("rejects traversal and symlinks before writing anything", () => {
    for (const [label, bytes] of [
      ["traversal", tar([{ name: "../escape", body: Buffer.from("x") }])],
      ["symlink", tar([{ name: "platform/link", type: "2" }])],
    ] as const) {
      const dest = join(tmp, `bad-${label}`);
      expect(() => importVerificationArchive(bytes, outputOf(bytes), dest)).toThrow(/unsafe archive path|unsupported entry type/);
      expect(existsSync(dest)).toBe(false);
    }
  });
});

describe("operator verification and publication lifecycle", () => {
  it("finishes trusted verification before approval without requesting activation", async () => {
    const r = repo("verify-before-approval"), a = activation("verify-before-approval", r.commit, r.digest);
    const calls: string[] = [], output: string[] = [];
    const fetcher = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${init?.method} ${url.pathname}${url.search}`);
      if (url.pathname.endsWith("/verification/start")) return Response.json({ verification: { ...a.verification, status: "queued" } });
      if (url.pathname.endsWith("/verification/poll")) return Response.json({ verification: a.verification });
      return new Response("not approved", { status: 409 });
    }) as typeof fetch;
    await expect(operatorCommand(["verify", "--system", a.systemId, "--plan", a.planId, "--platform", "http://127.0.0.1:1337"], {
      out: (line) => output.push(line), err: () => {}, cwd: tmp, env: { ARTYFACT_ADMIN_TOKEN: "admin-test" }, fetch: fetcher, pollMs: 0,
    })).resolves.toBe(0);
    expect(calls).toEqual([
      "POST /api/systems/system.artyfact/realization-plans/plan.self/verification/start",
      "POST /api/systems/system.artyfact/realization-plans/plan.self/verification/poll",
    ]);
    expect(JSON.parse(output[0]!)).toEqual({ verification: a.verification });
  });

  it("gates publication on current approval", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${init?.method} ${url.pathname}${url.search}`);
      return new Response("not approved", { status: 409 });
    }) as typeof fetch;
    await expect(operatorCommand(["publish", "--system", "system.artyfact", "--plan", "plan.self", "--platform", "http://127.0.0.1:1337"], {
      out: () => {}, err: () => {}, cwd: tmp, env: { ARTYFACT_ADMIN_TOKEN: "admin-test" }, fetch: fetcher,
    })).rejects.toThrow(/409/);
    expect(calls).toEqual(["GET /api/systems/system.artyfact/realization-plans/plan.self/activation?artifactId=artifact.platform"]);
  });

  it("publishes an approved immutable output without restarting verification", async () => {
    const r = repo("publish-command"), lc = cloud("publish-command", r.bare), bytes = required();
    const a = activation("publish-command", r.commit, r.digest, outputOf(bytes));
    const calls: string[] = [], output: string[] = [];
    const fetcher = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${init?.method} ${url.pathname}${url.search}`);
      if (url.pathname.endsWith("/activation")) return Response.json(a);
      if (url.pathname.endsWith("/verification/output")) return new Response(bytes, { headers: { "content-length": String(bytes.length), "x-content-sha256": outputOf(bytes).digest } });
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    const io = { out: (line: string) => output.push(line), err: () => {}, cwd: tmp, env: { ARTYFACT_ADMIN_TOKEN: "admin-test" }, fetch: fetcher, cloud: lc.c };
    await expect(operatorCommand(["publish", "--system", a.systemId, "--plan", a.planId, "--platform", "http://127.0.0.1:1337"], io)).resolves.toBe(0);
    await expect(operatorCommand(["publish", "--system", a.systemId, "--plan", a.planId, "--platform", "http://127.0.0.1:1337"], io)).resolves.toBe(0);
    expect(calls).toHaveLength(6);
    expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
    expect(calls.some((call) => call.includes("/verification/start") || call.includes("/verification/poll"))).toBe(false);
    expect(output.map((line) => JSON.parse(line).release.action)).toEqual(["created", "reused"]);
  });

  it("refuses Artifacts publication when approval changes after output download", async () => {
    const r = repo("publish-race"), bytes = required(), approved = activation("publish-race", r.commit, r.digest, outputOf(bytes));
    const superseded = { ...approved, systemCommit: "sc-3-cccccccc" };
    let activationReads = 0, artifactsCalled = false;
    const fetcher = (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/activation")) return Response.json(++activationReads === 1 ? approved : superseded);
      if (url.pathname.endsWith("/verification/output")) return new Response(bytes, { headers: { "content-length": String(bytes.length) } });
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    const rejectingCloud = { account: () => { artifactsCalled = true; throw new Error("Artifacts must not be called"); } } as unknown as Cloud;
    await expect(operatorCommand(["publish", "--system", approved.systemId, "--plan", approved.planId, "--platform", "http://127.0.0.1:1337"], {
      out: () => {}, err: () => {}, cwd: tmp, env: { ARTYFACT_ADMIN_TOKEN: "admin-test" }, fetch: fetcher, cloud: rejectingCloud,
    })).rejects.toThrow(/changed during output preparation/);
    expect(activationReads).toBe(2);
    expect(artifactsCalled).toBe(false);
  });
});

describe("approved activation", () => {
  it("loads only allowed external operator variables and drops fake mode", () => {
    const file = join(tmp, "operator.env");
    writeFileSync(file, "ADMIN_TOKEN=admin\nVERIFICATION_TOKEN='verify'\nFAKE_S1=1\nUNRELATED=no\n", { mode: 0o600 });
    chmodSync(file, 0o600);
    expect(operatorVars(file, {})).toEqual({ ADMIN_TOKEN: "admin", VERIFICATION_TOKEN: "verify" });
    chmodSync(file, 0o644);
    expect(() => operatorVars(file, {})).toThrow(/0600/);
  });

  it("rejects mismatched source/model identity", () => {
    const r = repo("identity");
    const good = activation("identity", r.commit, r.digest);
    expect(validateActivation(good, { systemId: good.systemId, planId: good.planId, artifactId: "artifact.platform" })).toEqual(good);
    expect(() => validateActivation({ ...good, source: { ...good.source, commit: "c".repeat(40) } }, { systemId: good.systemId, planId: good.planId, artifactId: "artifact.platform" })).toThrow(/provenance/);
    expect(() => validateActivation({ ...good, systemCommit: "b".repeat(40) }, { systemId: good.systemId, planId: good.planId, artifactId: "artifact.platform" })).toThrow(/canonical sc-/);
    const shortSource = { ...good.source, commit: "sc-2-bbbbbbbb" };
    expect(() => validateActivation({ ...good, source: shortSource, verification: { ...good.verification, request: { ...good.verification.request, source: shortSource } } }, { systemId: good.systemId, planId: good.planId, artifactId: "artifact.platform" })).toThrow(/source\.commit must be 40 lowercase hex/);
  });

  it("prepares the exact clean source with its in-fork changed model and keeps state outside replacement checkouts", () => {
    const r = repo("approved-source"), lc = cloud("approved-source", r.bare), a = activation("approved-source", r.commit, r.digest);
    const state = join(tmp, "persistent-state"), installs: string[] = [];
    const io = { out: () => {}, err: () => {}, cwd: tmp, env: { ARTYFACT_ADMIN_TOKEN: "admin-test" }, cloud: lc.c, install: (d: string) => installs.push(d) };
    const first = prepareActivation(a, { dir: "run-one", stateDir: "persistent-state" }, io);
    writeFileSync(join(state, "durable-object.sqlite"), "state survives");
    const second = prepareActivation(a, { dir: "run-two", stateDir: "persistent-state" }, io);
    const retried = prepareActivation(a, { dir: "run-one", stateDir: "persistent-state" }, io);
    expect(sh(first.checkout, "rev-parse", "HEAD")).toBe(r.commit);
    expect(sh(second.checkout, "rev-parse", "HEAD")).toBe(r.commit);
    expect(readFileSync(join(state, "durable-object.sqlite"), "utf8")).toBe("state survives");
    expect(installs).toEqual([first.checkout, second.checkout]);
    expect(retried).toEqual(first);
    expect(readFileSync(join(first.checkout, ".git/artyfact-activation.json"), "utf8")).not.toContain("read-token");
    expect(existsSync(join(first.checkout, ".git/artyfact-read-token"))).toBe(false);
    expect(existsSync(join(first.checkout, ".dev.vars"))).toBe(false);
    expect(lstatSync(join(first.checkout, "apps/platform/.dev.vars")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(state, "operator.dev.vars"), "utf8")).toContain("ADMIN_TOKEN='admin-test'");

    const receipt = join(first.checkout, ".git/artyfact-activation.json"), receiptTarget = join(state, "activation.json");
    unlinkSync(receipt); symlinkSync(receiptTarget, receipt);
    expect(() => prepareActivation(a, { dir: "run-one", stateDir: "persistent-state" }, io)).toThrow(/unsafe|symlink/i);

    const external = join(state, "operator.dev.vars"), externalTarget = join(tmp, "operator-vars-target");
    unlinkSync(external); writeFileSync(externalTarget, "do not overwrite\n"); symlinkSync(externalTarget, external);
    expect(() => prepareActivation(a, { dir: "run-two", stateDir: "persistent-state" }, io)).toThrow(/ELOOP|symbolic link|unsafe/i);
    expect(readFileSync(externalTarget, "utf8")).toBe("do not overwrite\n");
  });

  it("accepts a separately governed Genome only when the source system directory has its exact digest", () => {
    const r = repo("external-genome"), lc = cloud("external-genome", r.bare);
    const a = activation("external-genome", r.commit, r.digest);
    a.genome = { repo: "artyfact.bootstrap.genome", commit: "c".repeat(40), prefix: "", digest: r.digest };
    a.verification.request.genome = a.genome;
    const io = { out: () => {}, err: () => {}, cwd: tmp, env: { ARTYFACT_ADMIN_TOKEN: "admin-test" }, cloud: lc.c, install: () => {} };
    expect(prepareActivation(a, { dir: "external-genome-run", stateDir: "external-genome-state" }, io).checkout).toBe(join(realpathSync(tmp), "external-genome-run"));

    const mismatch = activation("external-genome", r.commit, r.digest);
    mismatch.genome = { ...a.genome, digest: "f".repeat(64) };
    mismatch.verification.request.genome = mismatch.genome;
    expect(() => prepareActivation(mismatch, { dir: "external-genome-bad-run", stateDir: "external-genome-bad-state" }, io)).toThrow(/accepted Genome digest/);
  });

  it("rejects state paths and parents that symlink into the source checkout", () => {
    const r = repo("symlink-source"), lc = cloud("symlink-source", r.bare), a = activation("symlink-source", r.commit, r.digest);
    const io = { out: () => {}, err: () => {}, cwd: tmp, env: { ARTYFACT_ADMIN_TOKEN: "admin-test" }, cloud: lc.c, install: () => {} };
    const checkout = join(tmp, "symlink-run"), state = join(tmp, "symlink-state");
    symlinkSync(checkout, state);
    expect(() => prepareActivation(a, { dir: checkout, stateDir: state }, io)).toThrow(/symlink|canonical/i);
    expect(existsSync(checkout)).toBe(false);

    const parent = join(tmp, "symlink-state-parent"), parentAlias = join(tmp, "symlink-state-parent-alias");
    mkdirSync(parent);
    symlinkSync(parent, parentAlias);
    expect(() => prepareActivation(a, { dir: "symlink-run-parent", stateDir: join(parentAlias, "state") }, io)).toThrow(/symlink|canonical/i);
    expect(existsSync(join(tmp, "symlink-run-parent"))).toBe(false);
  });

  it("publishes the exact verified tree once and reuses the immutable release", () => {
    const r = repo("publish-source"), lc = cloud("publish-source", r.bare), bytes = required(), stage = join(tmp, "publish-stage");
    importVerificationArchive(bytes, outputOf(bytes), stage);
    const a = activation("publish-source", r.commit, r.digest, outputOf(bytes));
    const io = { out: () => {}, err: () => {}, cwd: tmp, env: {}, cloud: lc.c };
    const first = publishVerifiedRelease(stage, a, io), second = publishVerifiedRelease(stage, a, io);
    expect(first.action).toBe("created"); expect(second).toEqual({ ...first, action: "reused" });
    expect(first.version).toBe(`verified-${verifiedReleaseIdentity(a).slice(0, 24)}`);
    const manifest = JSON.parse(sh(tmp, "--git-dir", lc.builds, "show", "main:release.json"));
    expect(manifest).toMatchObject({ identity: verifiedReleaseIdentity(a), source: a.source, genome: a.genome, verification: { output: a.verification.output } });
    expect(sh(tmp, "--git-dir", lc.builds, "show", "main:platform/client/index.html")).toContain("doctype");
  });

  it("rechecks approval and runs Vite in real local mode with the external state directory", async () => {
    const r = repo("run-source"), lc = cloud("run-source", r.bare), a = activation("run-source", r.commit, r.digest);
    const calls: string[] = [], runs: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const fetcher = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push(`${init?.method} ${new URL(String(input)).pathname}${new URL(String(input)).search}`);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer admin-test");
      return Response.json(a);
    }) as typeof fetch;
    const code = await operatorCommand(["activate", "--system", a.systemId, "--plan", a.planId, "--artifact", "artifact.platform", "--platform", "http://127.0.0.1:1337", "--dir", "run-live", "--state-dir", "run-live-state", "--port", "1444"], {
      out: () => {}, err: () => {}, cwd: tmp, env: { ARTYFACT_ADMIN_TOKEN: "admin-test" }, cloud: lc.c, fetch: fetcher,
      install: () => {}, run: (_cwd, args, env) => (runs.push({ args, env }), 0),
    });
    expect(code).toBe(0);
    expect(calls).toHaveLength(2);
    expect(runs[0]!.args).toEqual(["run", "dev", "-w", "@artyfact/platform", "--", "--host", "127.0.0.1", "--port", "1444", "--strictPort"]);
    expect(runs[0]!.env.HOSTED_DEMO).toBe("0");
    expect(runs[0]!.env.ARTYFACT_PERSIST_STATE_DIR).toBe(join(realpathSync(tmp), "run-live-state"));
    expect(runs[0]!.env.ARTYFACT_ADMIN_TOKEN).toBeUndefined();
    expect(runs[0]!.env.ADMIN_TOKEN).toBeUndefined();
  });
});
