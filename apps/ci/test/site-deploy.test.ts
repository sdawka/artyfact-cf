import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WRANGLER } from "../src/deploy-config";
import type { DoStep } from "../src/pipeline";
import {
  handleSiteDeployBatch, handleSiteDeployHttp, recordSiteDeploy, runSiteDeploy, SITE_CONFIG_ENV, SITE_DEPLOY_LATEST, siteDeployCommand,
  siteDeployConfig, siteDeployKey, sitePushOf, validateRelease, type SiteDeployInput, type SiteDeployRecord, type SiteQueueMessage,
} from "../src/site-deploy";

const COMMIT = "c".repeat(40), SOURCE = "a".repeat(40), ACCOUNT = "acc";
const VERSION = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const SITE_CONFIG = readFileSync(join(__dirname, "../../site/wrangler.jsonc"), "utf8");
const RELEASE = JSON.stringify({
  version: `v-${SOURCE.slice(0, 12)}`, gitCommit: SOURCE,
  workers: { "artyfact-platform": { config: "platform/artyfact_platform/wrangler.json" }, "artyfact-site": { config: "site/wrangler.jsonc" } },
});
const pushed = (over: { namespace?: string; repoName?: string; ref?: string; after?: string } = {}) => ({
  type: "cf.artifacts.repo.pushed",
  source: { type: "artifacts.repo", namespace: over.namespace ?? "artyfact", repoName: over.repoName ?? "platform.builds" },
  payload: { ref: over.ref ?? "refs/heads/main", before: "0".repeat(40), after: over.after ?? COMMIT, commits: [] },
});
const message = (body: unknown, id = "m1") => ({ id, body, ack: vi.fn(), retry: vi.fn() }) satisfies SiteQueueMessage;

describe("site deploy trigger", () => {
  it("accepts only pushes to artyfact/platform.builds main", () => {
    expect(sitePushOf(pushed())).toEqual({ commit: COMMIT });
    expect(sitePushOf(JSON.stringify(pushed()))).toEqual({ commit: COMMIT });
    expect(sitePushOf(pushed({ repoName: "artyfact.app--r1" }))).toHaveProperty("ignored");
    expect(sitePushOf(pushed({ namespace: "other" }))).toHaveProperty("ignored");
    expect(sitePushOf(pushed({ ref: "refs/tags/v-aaaaaaaaaaaa" }))).toHaveProperty("ignored");
    expect(sitePushOf(pushed({ after: "0".repeat(40) }))).toHaveProperty("ignored");
    expect(sitePushOf({ type: "cf.artifacts.repo.created" })).toHaveProperty("ignored");
  });

  it("starts one run per commit and treats redelivery as a no-op", async () => {
    const started = new Set<string>(), recorded = new Set<string>();
    const deps = {
      recorded: async (commit: string) => recorded.has(commit),
      start: vi.fn(async (commit: string) => { started.add(commit); }),
    };
    const first = message(pushed()), redelivered = message(pushed(), "m2"), other = message(pushed({ repoName: "artyfact.app" }), "m3");
    await handleSiteDeployBatch([first, other], deps);
    recorded.add(COMMIT);
    await handleSiteDeployBatch([redelivered], deps);
    expect(deps.start).toHaveBeenCalledTimes(1);
    for (const m of [first, redelivered, other]) expect(m.ack).toHaveBeenCalledOnce();
    const failing = message(pushed({ after: "d".repeat(40) }), "m4");
    await handleSiteDeployBatch([failing], { recorded: async () => false, start: async () => { throw new Error("workflows down"); } });
    expect(failing.retry).toHaveBeenCalledOnce();
  });
});

describe("site deploy validation", () => {
  it("reads the source commit from either release manifest", () => {
    expect(validateRelease(RELEASE)).toEqual({ release: `v-${SOURCE.slice(0, 12)}`, sourceCommit: SOURCE });
    const verified = { version: `verified-${"b".repeat(24)}`, source: { repo: "artyfact.app", commit: SOURCE }, workers: JSON.parse(RELEASE).workers };
    expect(validateRelease(JSON.stringify(verified))).toEqual({ release: verified.version, sourceCommit: SOURCE });
    expect(() => validateRelease(null)).toThrow(/missing/);
    expect(() => validateRelease(JSON.stringify({ ...JSON.parse(RELEASE), workers: {} }))).toThrow(/artyfact-site/);
    expect(() => validateRelease(JSON.stringify({ ...JSON.parse(RELEASE), gitCommit: "HEAD" }))).toThrow(/source commit/);
  });

  it("accepts the committed site config as assets-only and uploads the checkout's site/dist", () => {
    const config = siteDeployConfig(SITE_CONFIG, ACCOUNT);
    expect(config).toMatchObject({ name: "artyfact-site", account_id: ACCOUNT, assets: { directory: "/workspace/site/dist" } });
    expect(config).not.toHaveProperty("$schema");
    expect(() => siteDeployConfig(SITE_CONFIG.replace('"name"', '"main": "x.js", "name"'), ACCOUNT)).toThrow(/main is not allowed/);
    expect(() => siteDeployConfig(SITE_CONFIG.replace('"./dist"', '"../platform"'), ACCOUNT)).toThrow(/assets.directory/);
    expect(() => siteDeployConfig(SITE_CONFIG.replace('"name"', '"build": { "command": "curl x" }, "name"'), ACCOUNT)).toThrow(/build is not allowed/);
    expect(() => siteDeployConfig(SITE_CONFIG.replace('"artyfact-site"', '"artyfact-platform"'), ACCOUNT)).toThrow(/name must be artyfact-site/);
  });

  it("uploads with the pinned Wrangler and only Cloudflare credentials in its environment", () => {
    const command = siteDeployCommand();
    execFileSync("sh", ["-n", "-c", command]);
    expect(command).toContain(`${WRANGLER} deploy --config "$C/wrangler.json"`);
    expect(command).toContain(`"$${SITE_CONFIG_ENV}"`);
    expect(command).toContain("/usr/bin/env -i");
    expect(command).not.toMatch(/npx|npm /);
  });
});

describe("site deploy run", () => {
  const step: DoStep = (_name, fn) => fn();
  const input = (over: Partial<SiteDeployInput> = {}) => {
    const records: SiteDeployRecord[] = [];
    const runner = vi.fn(async (_options: Parameters<SiteDeployInput["ci"]["runner"]>[0]) => ({ logs: { stdout: `Uploaded artyfact-site\nCurrent Version ID: ${VERSION}\n` } }));
    const files: Record<string, string> = { "release.json": RELEASE, "site/wrangler.jsonc": SITE_CONFIG };
    const value: SiteDeployInput = {
      commit: COMMIT, accountId: ACCOUNT, step, ci: { runner },
      readFile: async (path) => files[path] ?? null,
      mainHead: async () => COMMIT,
      record: async (r) => { records.push(r); },
      ...over,
    };
    return { value, records, runner };
  };

  it("deploys only the site from the exact commit and records the Worker version", async () => {
    const h = input();
    const record = await runSiteDeploy(h.value);
    expect(record).toMatchObject({ commit: COMMIT, status: "deployed", release: `v-${SOURCE.slice(0, 12)}`, sourceCommit: SOURCE, versionId: VERSION });
    expect(h.runner).toHaveBeenCalledOnce();
    const options = h.runner.mock.calls[0]![0];
    expect(options.cloudflareCredentials).toEqual({ accountId: ACCOUNT });
    expect(JSON.parse(options.env[SITE_CONFIG_ENV]!).name).toBe("artyfact-site");
    expect(h.records).toEqual([record]);
  });

  it("skips an upload once main has moved on", async () => {
    const h = input({ mainHead: async () => "e".repeat(40) });
    expect((await runSiteDeploy(h.value)).status).toBe("superseded");
    expect(h.runner).not.toHaveBeenCalled();
  });

  it("records a refused release as failed and rethrows", async () => {
    const h = input({ readFile: async () => null });
    await expect(runSiteDeploy(h.value)).rejects.toThrow(/release.json is missing/);
    expect(h.records[0]).toMatchObject({ status: "failed", error: "release.json is missing" });
    expect(h.runner).not.toHaveBeenCalled();
  });
});

describe("site deploy records", () => {
  function bucket() {
    const objects = new Map<string, string>();
    return {
      objects,
      put: async (key: string, value: string) => { objects.set(key, value); return {}; },
      get: async (key: string) => (objects.has(key) ? { text: async () => objects.get(key)! } : null),
    };
  }
  const record = (status: SiteDeployRecord["status"], commit = COMMIT): SiteDeployRecord => ({ commit, status, startedAt: "t0", finishedAt: "t1" });

  it("keeps latest on the last deploy or failure, never a late superseded run", async () => {
    const b = bucket();
    await recordSiteDeploy(b, record("deployed"));
    await recordSiteDeploy(b, record("superseded", "d".repeat(40)));
    expect(JSON.parse(b.objects.get(SITE_DEPLOY_LATEST)!).commit).toBe(COMMIT);
    expect(b.objects.has(siteDeployKey("d".repeat(40)))).toBe(true);
  });

  it("serves records read-only behind the operator bearer", async () => {
    const b = bucket();
    await recordSiteDeploy(b, record("deployed"));
    const get = (path: string, auth = "Bearer op-token", method = "GET") =>
      handleSiteDeployHttp(new Request(`https://ci.test${path}`, { method, headers: { authorization: auth } }), { token: "op-token", bucket: b });
    expect((await get("/site-deploys/latest", "Bearer wrong")).status).toBe(401);
    expect(await (await get("/site-deploys/latest")).json()).toMatchObject({ commit: COMMIT, status: "deployed" });
    expect((await get(`/site-deploys/${COMMIT}`)).status).toBe(200);
    expect((await get(`/site-deploys/${"f".repeat(40)}`)).status).toBe(404);
    expect((await get("/site-deploys/latest", "Bearer op-token", "POST")).status).toBe(404);
  });
});
