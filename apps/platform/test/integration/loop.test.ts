/**
 * End-to-end loop against the real Cloudflare Artifacts service (namespace `artyfact-test`).
 * Opt-in: ARTYFACT_INTEGRATION=1 npm test -w @artyfact/platform -- --project integration
 * Needs `wrangler` logged in (and `cf` if the namespace does not exist yet). Never prints tokens.
 *
 * wrangler dev (wrangler.integration.jsonc) → `artyfact init` on a copy of the example renamed `system.itest-peopling-<run>`
 * (repos `itest-peopling-<run>.genome/.app`, plus the shared `platform` repo) → start ×2 → CLI start ×2 → edit →
 * CLI submit ×2 → conflicts → promote A → promote B with the old head (409) → history; then deletes this run's repos
 * (never `platform`).
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ITEST_NAMESPACE, itestPrefix, systemRepoNames } from "@artyfact/cli/naming";

const run = promisify(execFile);
// The worker tsconfig types process.env as the Worker Env (literal var values); the child processes get plain strings.
const ENV = process.env as Record<string, string | undefined>;
const envWith = (extra: Record<string, string>) => ({ ...ENV, ...extra }) as unknown as NodeJS.ProcessEnv;
const ENABLED = ENV.ARTYFACT_INTEGRATION === "1";
const NS = ITEST_NAMESPACE;
const PLATFORM = resolve(__dirname, "../..");
const ROOT = resolve(PLATFORM, "../..");
const CLI = join(ROOT, "packages/cli/bin/artyfact.js");
const SLUG = itestPrefix("peopling", Date.now().toString(36));
const SYSTEM = `system.${SLUG}`;
const { genomeRepo: GENOME_REPO, appRepo: APP_REPO } = systemRepoNames(SYSTEM);
const ADMIN = `itest-${crypto.randomUUID()}`;
const WRANGLER = join(ROOT, "node_modules/.bin/wrangler");
const wrangler = (...args: string[]) => run(WRANGLER, args, { cwd: PLATFORM, maxBuffer: 1 << 24 });
/** Every repo this run created: the two imports and their forks (`<repo>--r<n>`), and nothing else. */
const ours = (name: string) => name.startsWith(`${SLUG}.`);

let server: ChildProcess | undefined;
let base = "";
let head0 = "";
const work = mkdtempSync(join(tmpdir(), "artyfact-it-"));

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    }).on("error", fail);
  });
}

async function api<T = Record<string, any>>(method: string, path: string, body?: unknown, admin = false): Promise<{ status: number; json: T }> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(admin && { authorization: `Bearer ${ADMIN}` }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as T };
}

/**
 * Run the real CLI binary; credentials only ever travel in the environment. The secret is passed to `start` only:
 * later commands read the copy `start` saved in `.artyfact.json`.
 */
async function cli(args: string[], cwd: string, token: string, secret = ""): Promise<string> {
  const { stdout } = await run(process.execPath, [CLI, ...args], { cwd, env: envWith({ ARTYFACT_TOKEN: token, ARTYFACT_SECRET: secret, ARTYFACT_URL: base }) });
  return stdout;
}

describe.skipIf(!ENABLED)("integration: the demo loop on real Artifacts", () => {
  beforeAll(async () => {
    const who = await wrangler("whoami");
    const accountId = /[0-9a-f]{32}/.exec(who.stdout)?.[0];
    if (!accountId) throw new Error("wrangler whoami shows no account id; run `wrangler login`");

    const port = await freePort();
    base = `http://localhost:${port}`;
    // wrangler directly (not via npx) in its own process group, so teardown can stop workerd with it.
    server = spawn(WRANGLER, [
      "dev", "-c", "wrangler.integration.jsonc", "--port", String(port), "--persist-to", join(work, "state"),
      "--var", `ADMIN_TOKEN:${ADMIN}`, "--var", `ACCOUNT_ID:${accountId}`, "--var", "FAKE_S1:1", "--var", `PUBLIC_URL:${base}`,
    ], { cwd: PLATFORM, stdio: ["ignore", "ignore", "pipe"], detached: true });
    let up = false;
    for (let i = 0; i < 90 && !up; i++) {
      try {
        up = (await fetch(`${base}/api/health`)).ok;
      } catch { /* not up yet */ }
      if (!up) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!up) throw new Error("wrangler dev did not answer /api/health within 90 s");

    // A project copy under this run's System id, so `init` derives this run's repo names.
    const project = join(work, "project");
    const skip = (p: string) => !/(^|\/)(node_modules|dist|\.wrangler)(\/|$)/.test(p);
    cpSync(join(ROOT, "examples/peopling-system"), join(project, "system"), { recursive: true, filter: skip });
    cpSync(join(ROOT, "examples/peopling-app"), join(project, "app"), { recursive: true, filter: skip });
    for (const f of ["system.yaml", "criteria.yaml"]) {
      const path = join(project, "system", f);
      writeFileSync(path, readFileSync(path, "utf8").replaceAll("system.peopling", SYSTEM));
    }
    const { stdout } = await run(process.execPath, [CLI, "init", "--dir", project, "--namespace", NS, "--platform", base, "--no-review"], {
      cwd: work, maxBuffer: 1 << 24, env: envWith({ ARTYFACT_ADMIN_TOKEN: ADMIN, CLOUDFLARE_ACCOUNT_ID: accountId }),
    });
    expect(stdout).toContain(`${SYSTEM} -> ${GENOME_REPO}, ${APP_REPO} (namespace ${NS})`);
    head0 = /imported \S+ at (sc-\S+)/.exec(stdout)?.[1] ?? "";
    expect(head0, stdout).toMatch(/^sc-1-/);
  }, 360_000);

  afterAll(async () => {
    if (server?.pid) {
      const exited = new Promise((r) => server!.once("exit", r));
      try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
    }
    // List the namespace rather than trusting a local record, so a fork from a start that failed an assertion is
    // still removed. Only this run's repos match `ours`.
    let names: string[] = [GENOME_REPO, APP_REPO, `${APP_REPO}--r1`, `${APP_REPO}--r2`];
    try {
      const { stdout } = await wrangler("artifacts", "repos", "list", "--namespace", NS, "--json");
      names = (JSON.parse(stdout) as { name: string }[]).map((r) => r.name);
    } catch (e) {
      console.error(`cleanup: listing ${NS} failed (${(e as Error).message.split("\n")[0]}); deleting the expected names`);
    }
    for (const repo of names.filter(ours)) {
      await wrangler("artifacts", "repos", "delete", repo, "--namespace", NS, "--force").catch((e: Error) => console.error(`cleanup ${repo}: ${e.message.split("\n")[0]}`));
    }
    rmSync(work, { recursive: true, force: true });
  }, 120_000);

  it("init → start ×2 → submit ×2 → conflicts → promote → 409 → history", async () => {
    // A re-import (what a second `init` sends) is a no-op on the same commits, and records the platform commit.
    const imp = await api("POST", "/systems/import", { systemId: SYSTEM }, true);
    expect(imp.status, JSON.stringify(imp.json)).toBe(201);
    expect(imp.json).toMatchObject({ head: head0, genomeRepo: GENOME_REPO, appRepo: APP_REPO, platform: { repo: "platform" } });

    const model = await api(`GET`, `/systems/${SYSTEM}/model?rev=head`);
    expect(model.json.readiness.findings.filter((f: { level: string }) => f.level === "error")).toEqual([]);

    expect((await api("POST", `/systems/${SYSTEM}/evolutions/evolution.1/realizations`, { agentLabel: "anon" })).status).toBe(401);
    const start = (agentLabel: string) => api("POST", `/systems/${SYSTEM}/evolutions/evolution.1/realizations`, { agentLabel }, true);
    const [a, b] = (await Promise.all([start("agent-a"), start("agent-b")])).map((r) => {
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      return {
        rid: r.json.realization.id as string, token: r.json.token.value as string, secret: r.json.secret as string,
        fork: r.json.packet.workspace.fork as string,
      };
    });
    expect(new Set([a.fork, b.fork])).toEqual(new Set([`${APP_REPO}--r1`, `${APP_REPO}--r2`]));

    const dirA = join(work, "a"), dirB = join(work, "b");
    await cli(["start", a.rid, "--system", SYSTEM, "--evolution", "evolution.1", "--dir", dirA], work, a.token, a.secret);
    await cli(["start", b.rid, "--system", SYSTEM, "--evolution", "evolution.1", "--dir", dirB], work, b.token, b.secret);

    // A: the AddContactDialog save handler. B: owner-only read in the contacts routes. Different files.
    writeFileSync(join(dirA, "public/people/add-contact-dialog.js"), "// Save posts the contact and keeps values on failure.\nexport {};\n");
    appendFileSync(join(dirB, "src/worker/routes/contacts.ts"), "\n// policy.ownerOnly: another owner's record answers like a missing one.\n");
    await cli(["checkpoint", "save handler"], dirA, a.token);
    const outA = await cli(["submit", "--json"], dirA, a.token);
    const outB = await cli(["submit", "--json"], dirB, b.token);
    const subA = JSON.parse(outA), subB = JSON.parse(outB);
    const candA = (subA.candidate?.id ?? subA.candidate) as string, candB = (subB.candidate?.id ?? subB.candidate) as string;
    expect(candA).toMatch(/^candidate\./);
    expect(candB).toMatch(/^candidate\./);

    // A repeat submit of the same commit converges on the same candidate.
    const again = JSON.parse(await cli(["submit", "--json"], dirA, a.token));
    expect(again.candidate?.id ?? again.candidate).toBe(candA);

    const conflicts = await api("GET", `/systems/${SYSTEM}/conflicts`);
    const soft = conflicts.json.conflicts.find((c: { kind: string }) => c.kind === "soft-semantic");
    expect(soft, JSON.stringify(conflicts.json)).toBeTruthy();
    expect(soft.nodes).toContain("operation.contact.save");

    const pa = await api("POST", `/systems/${SYSTEM}/promote`, { candidateIds: [candA], expectedHead: head0, rationale: "Integration: advisories acknowledged." }, true);
    expect(pa.status, JSON.stringify(pa.json)).toBe(200);
    const pb = await api("POST", `/systems/${SYSTEM}/promote`, { candidateIds: [candB], expectedHead: head0, rationale: "stale" }, true);
    expect(pb.status).toBe(409);
    expect(pb.json.error).toMatchObject({ code: "stale-base", details: { currentHead: pa.json.commit.id } });

    const history = await api("GET", `/systems/${SYSTEM}/history`);
    const top = history.json.commits[0];
    expect(top.id).toBe(pa.json.commit.id);
    expect(top.manifest[0]).toMatchObject({ repo: a.fork, commit: subA.candidate?.commit ?? expect.stringMatching(/^[0-9a-f]{40}$/) });
  }, 300_000);
});
