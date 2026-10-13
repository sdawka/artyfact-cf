import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ImportSystemResponse, PromoteResponse, TemplateUpgradePlan, TemplateUpgradeResponse } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { walkTree } from "../worker/artifacts/genome-source";
import { setEditorTransport } from "../worker/editor";
import type { Evaluation as HookEvaluation, HookRunner, SubmissionContext } from "../worker/hooks/contract";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { appOwned, LOCK_PATH, planFiles, UPGRADE_AGENT } from "../worker/template-upgrade";
import { genomeFiles } from "./fixtures/genome";
import { FakeArtifacts, gitBlobHash } from "./helpers/fake-artifacts";
import { fakeReceivePack } from "./helpers/fake-receive-pack";
import { ADMIN, call, passing } from "./helpers/flows";

const TPL = "templates/thing/cloudflare-worker-webapp@1";
const SCAFFOLD_YAML = `repo: platform\npath: ${TPL}/scaffold\nbundle: examples/keep-in-touch-app\n`;
const platformTree = (files: Record<string, string>) => ({
  [`${TPL}/template.yaml`]: "id: template.thing.cloudflare-worker-webapp\n", [`${TPL}/scaffold.yaml`]: SCAFFOLD_YAML,
  ...Object.fromEntries(Object.entries(files).map(([p, t]) => [`${TPL}/scaffold/${p}`, t])),
});
const shas = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([p, t]) => [p, gitBlobHash(t)]));

const V1: Record<string, string> = {
  "package.json": "{}",
  "wrangler.jsonc": "{}",
  "src/index.ts": "export default {}",
  "src/worker/health.ts": "ok",
  "src/worker/old.ts": "old",
  "src/worker/routes/contacts.ts": "routes",
  "src/ui/people/index.html": "<main></main>",
  "source-map.yaml": "- glob: src/ui/people/**\n  nodes: [screen.people]\n",
  "README.md": "template readme",
  ".dev.vars": "SECRET=1",
};
const V2: Record<string, string> = {
  ...Object.fromEntries(Object.entries(V1).filter(([p]) => p !== "src/worker/old.ts")),
  "src/index.ts": "export default { v2: true }",
  "src/worker/health.ts": "ok v2",
  "src/worker/phenome.ts": "export const phenome = 1",
  "README.md": "template readme v2",
  ".dev.vars": "SECRET=2",
};

let seq = 0;
interface Setup { ns: FakeArtifacts; systemId: string; appRepo: string; imp: ImportSystemResponse; platform: string[] }

/** A System whose app repo holds `app`, with `platform` holding each scaffold version in turn (the last is the head). */
async function setup(app: Record<string, string>, versions: Record<string, string>[], opts: { noPlatform?: boolean } = {}): Promise<Setup> {
  const ns = new FakeArtifacts();
  const tag = `${++seq}${Math.random().toString(36).slice(2, 6)}`;
  const systemId = `system.tu${tag}`, genomeRepo = `tu-genome-${tag}`, appRepo = `tu-app-${tag}`;
  ns.create(genomeRepo).commit({
    ...genomeFiles, "system.yaml": genomeFiles["system.yaml"].replace("system.kit", systemId), "criteria.yaml": genomeFiles["criteria.yaml"].replaceAll("system.kit", systemId),
  }, "genome");
  const platform: string[] = [];
  if (!opts.noPlatform) {
    const repo = ns.create("platform");
    for (const v of versions) platform.push(repo.commit(platformTree(v), "platform-sync"));
  }
  ns.create(appRepo).commit(app, "scaffold");
  setArtifactsOverride(ns);
  setEditorTransport({ fetch: fakeReceivePack(ns).fetch });
  const res = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, genomeRepo, appRepo }, ADMIN);
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return { ns, systemId, appRepo, imp: res.json, platform };
}

/** The app as scaffolded from V1 (with its lock) and then edited: README, src/index.ts and the contacts route. */
function editedV1(platformV1: string): Record<string, string> {
  const files = Object.fromEntries(Object.entries(V1).filter(([p]) => p !== ".dev.vars"));
  return {
    ...files,
    "README.md": "my own readme",
    "src/index.ts": "export default { mine: true }",
    "src/worker/routes/contacts.ts": "my routes",
    [LOCK_PATH]: JSON.stringify({ template: "thing/cloudflare-worker-webapp@1", scaffoldCommit: platformV1, files: shas(V1) }),
  };
}

/** A System on V1 whose app was then edited (with its V1 lock), re-imported at that commit; `platform` is at V2. */
async function setupEdited(): Promise<Setup> {
  const s = await setup({ "package.json": "{}" }, [V1, V2]);
  const app = s.ns.repo(s.appRepo);
  app.commit(editedV1(s.platform[0]!), "edited");
  const res = await call<ImportSystemResponse>("POST", "/systems/import", { systemId: s.systemId, genomeRepo: s.imp.genomeRepo, appRepo: s.appRepo, force: true }, ADMIN);
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return { ...s, imp: res.json };
}

const plan = (s: Setup, ref?: string) => call<TemplateUpgradePlan>("GET", `/systems/${s.systemId}/template-upgrade${ref ? `?ref=${ref}` : ""}`);
const apply = (s: Setup, body: unknown, headers: Record<string, string> = ADMIN) =>
  call<TemplateUpgradeResponse & { error?: { code: string } }>("POST", `/systems/${s.systemId}/template-upgrade`, body, headers);
const head = async (s: Setup) => (await call<{ head: string | null }>("GET", `/systems/${s.systemId}`)).json.head;

/** Every criterion of the test Genome passes (the upgrade's default criteria include C.people.lint, which `passing` skips). */
const CRITERIA = ["C.people.audit", "C.people.list", "C.people.sorted", "C.people.lint", "C.people.later", "C.webapp.exists", "C.webapp.health"];
function evalOf(ctx: SubmissionContext, criterion: string, verdict: HookEvaluation["verdict"]): HookEvaluation {
  const at = new Date().toISOString();
  return {
    id: `${ctx.candidate.id}:hook:${criterion}`, candidate: ctx.candidate.id, hook: `hook:${criterion}`, criterion, ownerId: "o", subjectId: "s",
    targetRef: ctx.candidate.commit, execution: "completed", verdict, verifier: "artyfact-platform", startedAt: at, finishedAt: at,
    observations: [], limitations: [], provenance: {},
  };
}
const allPass: HookRunner = {
  ...passing,
  async runSubmission(ctx) {
    const f = ctx.promotionFacts;
    const promotion = f ? (f.currentBaseCommit === ctx.candidate.baseCommit && f.manifestExact && f.evidenceFresh ? "pass" : "fail") : "unknown";
    return [...CRITERIA.map((c) => evalOf(ctx, c, "pass")), evalOf(ctx, "C.system.promotion", promotion)];
  },
};

beforeEach(() => setHooks({ runner: () => allPass }));
afterEach(() => { setArtifactsOverride(undefined); setEditorTransport(undefined); resetHooks(); });

describe("template upgrade plan (pure)", () => {
  const t = new Map(Object.entries({ a: "t1", b: "t2", c: "t3", d: "t4", e: "t5", "README.md": "r2", ".dev.vars": "s2", "node_modules/x/i.js": "n" }));
  const lock = { template: "thing/x@1", scaffoldCommit: "c".repeat(40), files: { a: "t1", b: "old", c: "old", d: "t4", gone: "g", gone2: "g", e: "old", "README.md": "r1" } };

  it("classifies add / update / conflict / remove and omits identical and app-only work", () => {
    const app = new Map(Object.entries({ a: "t1", b: "old", c: "mine", d: "mine", gone: "g", gone2: "edited", e: "t5", "README.md": "mine", "extra.ts": "x" }));
    const files = planFiles(t, app, lock);
    expect(files.map((f) => [f.path, f.action])).toEqual([["b", "update"], ["gone", "remove"], ["c", "conflict"], ["gone2", "conflict"]]);
    expect(files.find((f) => f.path === "c")?.reason).toMatch(/app edited it/);
    expect(files.find((f) => f.path === "gone2")?.reason).toMatch(/no longer ships it, but the app edited it/);
  });

  it("adds new template files, and re-offers a file the app deleted only when the template changed it", () => {
    const files = planFiles(new Map([["new.ts", "n"], ["kept.ts", "k1"], ["changed.ts", "c2"]]), new Map(), {
      template: "thing/x@1", scaffoldCommit: "c".repeat(40), files: { "kept.ts": "k1", "changed.ts": "c1" },
    });
    expect(files.map((f) => [f.path, f.action])).toEqual([["new.ts", "add"], ["changed.ts", "conflict"]]);
  });

  it("without a lock, every differing file is a conflict; README and ignored paths never appear", () => {
    const app = new Map(Object.entries({ a: "t1", b: "mine", "README.md": "mine" }));
    const files = planFiles(t, app, null);
    expect(files.map((f) => [f.path, f.action])).toEqual([["c", "add"], ["d", "add"], ["e", "add"], ["b", "conflict"]]);
    expect(files.find((f) => f.path === "b")?.reason).toMatch(/no template lock/);
    for (const p of ["README.md", "docs/README", ".dev.vars", ".env.local", "node_modules/a.js", ".wrangler/x", "dist/a.js", LOCK_PATH, ".artyfact.json"]) {
      expect(appOwned(p), p).toBe(true);
    }
    expect(appOwned(".dev.vars.example")).toBe(false);
  });
});

describe("template upgrade routes", () => {
  it("plans add / update / remove / conflict against the app's lock, never README or secret files", async () => {
    const s = await setupEdited();
    const p = await plan(s, "head");
    expect(p.status, JSON.stringify(p.json)).toBe(200);
    expect(p.json).toMatchObject({ template: "thing/cloudflare-worker-webapp@1", from: s.platform[0], to: s.platform[1], upToDate: false, locked: true, app: { repo: s.appRepo, commit: s.imp.appCommit } });
    expect(p.json.files.map((f) => [f.path, f.action])).toEqual([
      ["src/worker/phenome.ts", "add"], ["src/worker/health.ts", "update"], ["src/worker/old.ts", "remove"], ["src/index.ts", "conflict"],
    ]);
  });

  it("applies the plan as an ordinary candidate, includes a conflict on request, and is up to date after promote", async () => {
    const s = await setupEdited();
    expect((await apply(s, {}, {})).status).toBe(401);
    expect((await apply(s, {}, { authorization: "Bearer wrong" })).status).toBe(403);
    expect((await apply(s, { include: ["src/worker/health.ts"] })).status).toBe(422);

    const res = await apply(s, { include: ["src/index.ts"] });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const short = s.platform[1]!.slice(0, 7);
    expect(res.json.evolution).toMatchObject({ title: `Upgrade app template to ${short}`, kind: "implementation" });
    expect(res.json.realization).toMatchObject({ evolution: res.json.evolution.id, agent: { id: UPGRADE_AGENT, role: "author" }, origin: "editor" });
    expect([...res.json.candidate.changedPaths].sort()).toEqual([LOCK_PATH, "src/index.ts", "src/worker/health.ts", "src/worker/old.ts", "src/worker/phenome.ts"]);
    expect(res.json.plan.files).toHaveLength(4);

    const fork = s.ns.repo(res.json.realization.workspace.fork);
    const files = await walkTree(fork, res.json.candidate.commit);
    expect(files.get("src/index.ts")).toBe(V2["src/index.ts"]);
    expect(files.get("src/worker/phenome.ts")).toBe(V2["src/worker/phenome.ts"]);
    expect(files.has("src/worker/old.ts")).toBe(false);
    expect(files.get("README.md")).toBe("my own readme");
    expect(files.get("src/worker/routes/contacts.ts")).toBe("my routes");
    const lock = JSON.parse(files.get(LOCK_PATH)!) as { template: string; scaffoldCommit: string; files: Record<string, string> };
    expect(lock.scaffoldCommit).toBe(s.platform[1]);
    expect(lock.files).toEqual(shas(Object.fromEntries(Object.entries(V2).filter(([p]) => !appOwned(p)))));

    // The candidate's own plan is up to date already; promote it and the head is too.
    expect((await plan(s, res.json.candidate.id)).json.upToDate).toBe(true);
    const promoted = await call<PromoteResponse>("POST", `/systems/${s.systemId}/promote`, { candidates: [res.json.candidate.id], expectedHead: await head(s), rationale: "template upgrade" }, ADMIN);
    expect(promoted.status, JSON.stringify(promoted.json)).toBe(200);
    const after = await plan(s);
    expect(after.json).toMatchObject({ upToDate: true, files: [], from: s.platform[1], to: s.platform[1] });
    const again = await apply(s, {});
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe("up-to-date");
  });

  it("keeps the app's version of a conflict it was not told to include, and remembers that choice", async () => {
    const s = await setupEdited();
    const res = await apply(s, {});
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect([...res.json.candidate.changedPaths].sort()).toEqual([LOCK_PATH, "src/worker/health.ts", "src/worker/old.ts", "src/worker/phenome.ts"]);
    const promoted = await call<PromoteResponse>("POST", `/systems/${s.systemId}/promote`, { candidates: [res.json.candidate.id], expectedHead: await head(s), rationale: "upgrade" }, ADMIN);
    expect(promoted.status, JSON.stringify(promoted.json)).toBe(200);
    const after = (await plan(s)).json;
    expect(after.upToDate).toBe(true);
    expect(after.files).toEqual([]);
  });

  it("without a lock, differing files are conflicts and identical ones are omitted; applying records the lock", async () => {
    const app = Object.fromEntries(Object.entries(V1).filter(([p]) => p !== "src/worker/old.ts" && p !== ".dev.vars"));
    const s = await setup({ ...app, "src/index.ts": "export default { mine: true }", "README.md": "mine" }, [V2]);
    const p = (await plan(s)).json;
    expect(p).toMatchObject({ from: null, to: s.platform[0], locked: false, upToDate: false });
    expect(p.files.map((f) => [f.path, f.action])).toEqual([
      ["src/worker/phenome.ts", "add"], ["src/index.ts", "conflict"], ["src/worker/health.ts", "conflict"],
    ]);
    const res = await apply(s, { include: ["src/worker/health.ts"] });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect([...res.json.candidate.changedPaths].sort()).toEqual([LOCK_PATH, "src/worker/health.ts", "src/worker/phenome.ts"]);
  });

  it("refuses with 422 when the namespace has no platform repo", async () => {
    const s = await setup(V1, [], { noPlatform: true });
    const p = await call<{ error: { code: string } }>("GET", `/systems/${s.systemId}/template-upgrade`);
    expect(p.status).toBe(422);
    expect(p.json.error.code).toBe("platform-unsynced");
  });
});
