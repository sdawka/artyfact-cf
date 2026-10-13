import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ApiError, CandidatesResponse, ConflictsResponse, Evaluation, GenomeCandidateReview, ImportSystemResponse, ModelBundle, PacketResponse, PromoteResponse, RealizationResponse,
  SerializedModel, StartWorkResponse, SubmitResponse, SystemsResponse, HistoryResponse, WorkResponse, ReadinessResponse,
} from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { clearGenomeMemo } from "../worker/artifacts/genome-source";
import { REGISTRY, type SystemAuthority } from "../worker/do/system-authority";
import type { Evaluation as HookEvaluation, HookRunner, SubmissionContext } from "../worker/hooks/contract";
import { defaultHookRunner, hookRunner, noopHookRunner, queueEntry, resetHooks, setHooks } from "../worker/hooks/index";
import { PUSHED } from "../worker/hooks/queue";
import { appFiles, genomeFiles, genomeFor } from "./fixtures/genome";
import { FakeArtifacts } from "./helpers/fake-artifacts";

const ADMIN = { authorization: "Bearer test-admin-token" };
let seq = 0;

/** Realization secrets seen in start responses, by realization id. */
const secrets = new Map<string, string>();
const START_RE = /\/evolutions\/[^/]+\/realizations$/;
const RZ_RE = /\/realizations\/([^/]+)(\/(packet|checkpoints|submit|sync))?$/;

/**
 * Without explicit `headers`, a call carries the credentials its route needs: the admin bearer on start work, and the
 * realization's own secret on its guarded routes. Pass `headers` (even `{}`) to test auth itself.
 */
function defaultAuth(method: string, path: string): Record<string, string> {
  if (method === "POST" && START_RE.test(path)) return ADMIN;
  const s = secrets.get(RZ_RE.exec(path)?.[1] ?? "");
  return s ? { authorization: `Bearer ${s}` } : {};
}

async function call<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; json: T }> {
  const res = await exports.default.fetch(new Request(`http://example.com/api${path}`, {
    method, headers: { "content-type": "application/json", ...(headers ?? defaultAuth(method, path)) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }));
  const json = (await res.json()) as T;
  const started = json as Partial<StartWorkResponse>;
  if (started.secret && started.realization?.id) secrets.set(started.realization.id, started.secret);
  return { status: res.status, json };
}

/** Each test gets its own System id so DO state never leaks between tests. */
function setup(ns = new FakeArtifacts()) {
  const id = `system.kit`;
  const suffix = `-${++seq}`;
  const genomeRepo = `kit-system${suffix}`, appRepo = `kit-app${suffix}`;
  const files = { ...genomeFiles };
  ns.create(genomeRepo).commit(files, "genome");
  ns.create(appRepo).commit(appFiles, "scaffold");
  setArtifactsOverride(ns);
  return { ns, id, genomeRepo, appRepo };
}

const seen: SubmissionContext[] = [];
const REQUIRED = ["C.people.audit", "C.people.list", "C.people.sorted", "C.system.promotion", "C.webapp.exists"];
const modelOf = (b: ModelBundle) => b.model as SerializedModel;
const hookEval = (ctx: SubmissionContext, criterion: string, execution: HookEvaluation["execution"], verdict: HookEvaluation["verdict"]): HookEvaluation => {
  const at = new Date().toISOString();
  return {
    id: `${ctx.candidate.id}:hook:${criterion}`, candidate: ctx.candidate.id, hook: `hook:${criterion}`, criterion, ownerId: "o", subjectId: "s",
    targetRef: ctx.candidate.commit, execution, verdict, verifier: "artyfact-platform", startedAt: at,
    ...(execution === "completed" && { finishedAt: at }), observations: [{ promotion: !!ctx.promotionFacts }], limitations: [], provenance: {},
  };
};
/** Mirrors the hooks slice's C.system.promotion: not-run without promotionFacts, pass only when every fact holds. */
const promotionEval = (ctx: SubmissionContext): HookEvaluation => {
  const f = ctx.promotionFacts;
  if (!f) return hookEval(ctx, "C.system.promotion", "not-run", "unknown");
  const ok = f.currentBaseCommit === ctx.candidate.baseCommit && f.manifestExact === true && f.evidenceFresh === true;
  return hookEval(ctx, "C.system.promotion", "completed", ok ? "pass" : "fail");
};
const passing: HookRunner = {
  async runSubmission(ctx) {
    seen.push(ctx);
    return REQUIRED.map((c) => (c === "C.system.promotion" ? promotionEval(ctx) : hookEval(ctx, c, "completed", "pass")));
  },
  async runGenome(ctx) {
    const base = await noopHookRunner.runGenome(ctx);
    const signals = { id: "entity.ContactRecord", changeClass: null, contradicts: {}, weakens: null, specificity: null, touchesConsent: null, level: "info", verdict: "pass", provenance: {} };
    // Genome candidates face the same gate as app candidates at accept, so they get the same evaluations.
    const evaluations = REQUIRED.map((c) => (c === "C.system.promotion" ? promotionEval(ctx) : hookEval(ctx, c, "completed", "pass")));
    return { ...base, evaluations, review: [{ subject: "entity.ContactRecord", judgment: "reviewDelta", level: "info", verdict: "pass", signals: signals as never }] };
  },
  async conflicts(ctx) {
    return ctx.openCandidates.length
      ? [{ kind: "soft-semantic", candidates: [ctx.candidate.id, ...ctx.openCandidates.map((c) => c.id)].sort(), subjects: ["screen.people"], nodes: ["screen.people"], paths: [], message: "both touch screen.people" }]
      : [];
  },
};

beforeEach(() => { seen.length = 0; setHooks({ runner: () => passing }); });
afterEach(() => { setArtifactsOverride(undefined); resetHooks(); });

/** System ids are global DO names; give each test a unique one by rewriting the root node.yaml. */
function uniqueSystem(ns: FakeArtifacts, genomeRepo: string): string {
  const id = `system.kit${seq}`;
  const files = { ...genomeFor(id), };
  ns.repo(genomeRepo).commit(files, "rename");
  return id;
}

async function imported(ns?: FakeArtifacts) {
  const s = setup(ns);
  const systemId = uniqueSystem(s.ns, s.genomeRepo);
  const res = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, genomeRepo: s.genomeRepo, appRepo: s.appRepo }, ADMIN);
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return { ...s, systemId, imp: res.json };
}

describe("routes: import names and platform provenance", () => {
  /** A System whose repos carry only the derived names `<slug>.genome` / `<slug>.app`. */
  function slugNamed(ns = new FakeArtifacts()) {
    const slug = `kitslug${++seq}`, systemId = `system.${slug}`;
    ns.create(`${slug}.genome`).commit({
      ...genomeFor(systemId),
    }, "genome");
    ns.create(`${slug}.app`).commit(appFiles, "scaffold");
    setArtifactsOverride(ns);
    return { ns, systemId, slug };
  }
  const PLATFORM_FILES = {
    "README.md": "platform", "manifest.json": "{}",
    "templates/rule-packs/metamodel@1/pack.dl": "% metamodel",
    "templates/thing/cloudflare-worker-webapp@1/template.yaml": "id: template.thing.cloudflare-worker-webapp",
  };

  it("derives omitted repo names from the slug, names forks <slug>.app--r<n>, and warns platform.unsynced", async () => {
    const { ns, systemId, slug } = slugNamed();
    const res = await call<ImportSystemResponse>("POST", "/systems/import", { systemId }, ADMIN);
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json).toMatchObject({ genomeRepo: `${slug}.genome`, appRepo: `${slug}.app`, platform: null });
    expect(res.json.warnings.map((w) => [w.level, w.rule])).toEqual([["warning", "platform.unsynced"]]);
    const rd = await call<ReadinessResponse>("GET", `/systems/${systemId}/readiness`);
    expect(rd.json.findings.some((f) => f.rule === "platform.unsynced")).toBe(true);
    expect(rd.json.modelReadiness.blockers.some((f) => f.rule === "platform.unsynced")).toBe(false);
    const a = await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {});
    expect(a.status, JSON.stringify(a.json)).toBe(201);
    expect(a.json.realization.workspace.fork).toBe(`${slug}.app--r1`);
    expect(ns.repos.has(`${slug}.app--r1`)).toBe(true);
    const entry = await runInDurableObject(env.SYSTEMS.getByName(REGISTRY), (i: SystemAuthority) => i.resolveFork(`${slug}.app--r1`));
    expect(entry).toMatchObject({ systemId });
  });

  it("records the platform commit on import and on later commits, with a warning per missing pin", async () => {
    const { ns, systemId } = slugNamed();
    const p1 = ns.create("platform").commit({ "README.md": "platform", "templates/rule-packs/metamodel@1/pack.dl": "% metamodel" }, "sync");
    const res = await call<ImportSystemResponse>("POST", "/systems/import", { systemId }, ADMIN);
    expect(res.json.platform).toEqual({ repo: "platform", commit: p1 });
    expect(res.json.warnings.map((w) => [w.rule, w.subject])).toEqual([["platform.pin-missing", "template.thing.cloudflare-worker-webapp@1"]]);
    const rd = await call<ReadinessResponse>("GET", `/systems/${systemId}/readiness`);
    expect(rd.json.findings.some((f) => f.rule === "platform.unsynced")).toBe(false);

    const p2 = ns.repo("platform").commit(PLATFORM_FILES, "sync");
    const again = await call<ImportSystemResponse>("POST", "/systems/import", { systemId }, ADMIN);
    expect(again.status).toBe(201);
    expect(again.json.warnings).toEqual([]);
    expect(again.json.platform).toEqual({ repo: "platform", commit: p2 });
    // A platform-only change writes no System commit; it updates the head's recorded provenance in place.
    expect(again.json.head).toBe(res.json.head);
    const hist = await call<HistoryResponse>("GET", `/systems/${systemId}/history`);
    expect(hist.json.commits.map((c) => [c.decision.policy, c.composition?.platform?.commit])).toEqual([["import", p1]]);
    const state = await runInDurableObject(env.SYSTEMS.getByName(systemId), (i: SystemAuthority) => i.state());
    expect(state!.platform).toEqual({ repo: "platform", commit: p2 });
    const same = await call<ImportSystemResponse>("POST", "/systems/import", { systemId }, ADMIN);
    expect(same.json.head).toBe(res.json.head);
  });

  it("never fails the import because platform cannot be read; keeps the recorded provenance and warns", async () => {
    const { ns, systemId } = slugNamed();
    const p1 = ns.create("platform").commit(PLATFORM_FILES, "sync");
    expect((await call<ImportSystemResponse>("POST", "/systems/import", { systemId }, ADMIN)).json.platform).toEqual({ repo: "platform", commit: p1 });
    const get = ns.get.bind(ns);
    ns.get = async (name: string) => (name === "platform" ? Promise.reject(Object.assign(new Error("upstream"), { code: "INTERNAL" })) : get(name));
    const again = await call<ImportSystemResponse>("POST", "/systems/import", { systemId }, ADMIN);
    expect(again.status, JSON.stringify(again.json)).toBe(201);
    expect(again.json.platform).toEqual({ repo: "platform", commit: p1 });
    expect(again.json.warnings.map((w) => [w.rule, w.message])).toEqual([["platform.unreadable", expect.stringContaining("(INTERNAL)")]]);
    const state = await runInDurableObject(env.SYSTEMS.getByName(systemId), (i: SystemAuthority) => i.state());
    expect(state!.platform).toEqual({ repo: "platform", commit: p1 });
  });

  it("checks platform pins against the canonical Genome after an accepted amendment", async () => {
    const { ns, systemId, slug } = slugNamed();
    ns.create("platform").commit(PLATFORM_FILES, "sync");
    const res = await call<ImportSystemResponse>("POST", "/systems/import", { systemId }, ADMIN);
    expect(res.json.warnings).toEqual([]);
    // Accept a Genome amendment that also pins readiness@1, which platform lacks.
    const files = {
      ...genomeFor(systemId),
      "node.yaml": genomeFor(systemId)["node.yaml"]!.replace('    - id: metamodel\n      version: "1"\n', '    - id: metamodel\n      version: "1"\n    - id: readiness\n      version: "1"\n'),
    };
    await runInDurableObject(env.SYSTEMS.getByName(systemId), async (i: SystemAuthority) => {
      const r = i.reserveRealization({ evolutionId: "evolution.1", target: "genome" });
      const commit = ns.create(r.forkRepo).commit(files, "amend");
      const { candidate } = i.recordCandidate({ realizationId: r.realization.id, commit, manifest: {}, changedPaths: ["node.yaml"], changedNodes: [] });
      const at = new Date().toISOString();
      const pass = (criterion: string): Evaluation => ({
        id: "", candidate: candidate.id, criterion, hook: `hook.${criterion}`, verdict: "pass", execution: "completed", observations: [], verifier: "test",
        ownerId: "system", subjectId: systemId, targetRef: candidate.id, startedAt: at, finishedAt: at, limitations: [], provenance: {},
      });
      i.recordEvaluations(candidate.id, ["C.people.list", "C.people.sorted", "C.people.later"].map(pass), "awaiting-admin");
      const out = await i.accept({ realizationId: r.realization.id, candidateId: candidate.id, commit, rationale: "ok", by: "admin", evolutions: [], gates: [], artifactId: "artifact.webapp", templateVersions: {}, hookVersions: {} });
      expect(out, JSON.stringify(out)).toMatchObject({ ok: true });
    });
    const again = await call<ImportSystemResponse>("POST", "/systems/import", { systemId }, ADMIN);
    expect(again.status, JSON.stringify(again.json)).toBe(201);
    expect(again.json.warnings.map((w) => [w.rule, w.subject])).toEqual([["platform.pin-missing", "readiness@1"]]);
  });

  it("skips realization numbers whose fork already exists in the namespace", async () => {
    const { ns, systemId, slug } = slugNamed();
    // Forks left by an earlier platform state on the same namespace.
    ns.create(`${slug}.app--r1`).commit({ "README.md": "old run" });
    ns.create(`${slug}.genome--r2`).commit({ "README.md": "old run" });
    expect((await call<ImportSystemResponse>("POST", "/systems/import", { systemId }, ADMIN)).status).toBe(201);
    const a = await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {});
    expect(a.status, JSON.stringify(a.json)).toBe(201);
    expect([a.json.realization.id, a.json.realization.workspace.fork]).toEqual(["realization.1.r2", `${slug}.app--r2`]);
    const b = await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {});
    expect(b.json.realization.workspace.fork).toBe(`${slug}.app--r3`);
  });

  it("records scaffoldFrom on the app binding and validates it", async () => {
    const { systemId } = slugNamed();
    const bad = await call<ApiError>("POST", "/systems/import", { systemId, scaffoldFrom: { repo: "platform", commit: "nope" } }, ADMIN);
    expect(bad.status).toBe(400);
    const scaffoldFrom = { repo: "platform", commit: "d".repeat(40), path: "templates/thing/cloudflare-worker-webapp@1/scaffold" };
    const res = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, scaffoldFrom }, ADMIN);
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const hist = await call<HistoryResponse>("GET", `/systems/${systemId}/history`);
    expect(hist.json.commits[0].composition?.artifacts["artifact.webapp"]).toMatchObject({ scaffoldFrom });
  });
});

describe("routes: import → model → start → submit → promote", () => {
  it("runs the happy path", async () => {
    const { ns, systemId, appRepo, genomeRepo, imp } = await imported();
    expect(imp.evolutions).toEqual(["evolution.1", "evolution.2"]);

    const list = await call<SystemsResponse>("GET", "/systems");
    expect(list.json.systems.some((s) => s.systemId === systemId)).toBe(true);

    const genomeCalls = ns.repo(genomeRepo).calls.length;
    const model = await call<ModelBundle>("GET", `/systems/${systemId}/model`);
    expect(model.status).toBe(200);
    expect(model.json.genomeCommit).toBe(imp.genomeCommit);
    expect(modelOf(model.json).index.byId["screen.people"]).toEqual({ id: "screen.people", type: "node", kind: "screen", name: "People" });
    expect(modelOf(model.json).index.paths["screen.people"]).toEqual([systemId, "thing.webapp", "section.ui", "screen.people"]);
    expect(model.json.readiness.modelReadiness).toBeDefined();
    const rd = await call<ReadinessResponse>("GET", `/systems/${systemId}/readiness?rev=${imp.head}`);
    expect(rd.json.packs.map((p) => p.id).filter((id) => !id.startsWith("engine."))).toEqual(["facts", "metamodel"]);
    // Full rules Readiness on the wire, served from the DO cache written at import (no Artifacts reads).
    for (const r of [model.json.readiness, rd.json]) {
      expect(r).toMatchObject({ snapshotHash: expect.any(String), incomplete: expect.any(Boolean), actionable: expect.any(Boolean) });
      expect(Object.values(r.derived).every(Array.isArray)).toBe(true);
      expect(r.findings.every((f) => "derivation" in f)).toBe(true);
    }
    expect(ns.repo(genomeRepo).calls.length).toBe(genomeCalls);

    const start = await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, { agentLabel: "claude" });
    expect(start.status, JSON.stringify(start.json)).toBe(201);
    const rid = start.json.realization.id;
    expect(rid).toBe("realization.1.r1");
    expect(start.json.realization.workspace.fork).toBe(`${appRepo}--r1`);
    expect(start.json.remote).toBe(`https://test-account.artifacts.cloudflare.net/git/artyfact/${appRepo}--r1.git`);
    expect(start.json.token.value).toMatch(/^secret-/);
    expect(start.json.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(start.json.packet.workspace.secret).toBe(start.json.secret);
    expect(start.json.startCommand).toBe(
      `ARTYFACT_TOKEN=${start.json.token.value} ARTYFACT_SECRET=${start.json.secret} npx artyfact start ${rid} --system ${systemId} --evolution evolution.1 --dir ./${rid}`,
    );
    expect(start.json.packet.startCommand).toContain("ARTYFACT_TOKEN=<token> ARTYFACT_SECRET=<secret> npx artyfact start");
    expect(start.json.packet.markdown).toContain(start.json.packet.startCommand);
    expect(JSON.stringify(start.json.packet)).not.toContain(start.json.token.value);
    expect(start.json.packet.permittedPaths.sort()).toEqual(["src/ui/**", "src/ui/people/**"]);
    expect(start.json.packet.commands).toEqual(["npm install", "npm run dev", "npm test"]);
    expect(ns.repo(`${appRepo}--r1`).tokens).toEqual([{ id: expect.any(String), scope: "write", ttl: 21600 }]);

    // The packet route never re-issues the token.
    const pk = await call<PacketResponse>("GET", `/systems/${systemId}/evolutions/evolution.1/realizations/${rid}/packet`);
    expect(pk.json.packet.hash).toBe(start.json.packet.hash);
    expect(JSON.stringify(pk.json)).not.toContain(start.json.token.value);
    expect(start.json.cli).toBe(start.json.startCommand);
    expect(JSON.stringify(pk.json)).not.toContain(start.json.cli);
    expect(JSON.stringify(pk.json)).not.toContain(start.json.secret);
    const stored = await runInDurableObject(env.SYSTEMS.getByName(systemId), (i: SystemAuthority) => i.realization(rid));
    expect(JSON.stringify(stored)).not.toContain(start.json.token.value);
    expect(JSON.stringify(stored)).not.toContain(start.json.secret);
    const viaRegistry = await call<PacketResponse>("GET", `/realizations/${rid}/packet`);
    expect(viaRegistry.json.systemId).toBe(systemId);

    const cp = await call<{ checkpoint: { seq: number } }>("POST", `/systems/${systemId}/realizations/${rid}/checkpoints`, { message: "scaffolded list" });
    expect(cp.status).toBe(201);

    // Agent pushes a commit to its fork.
    const fork = ns.repo(`${appRepo}--r1`);
    const commit = fork.commit({ ...appFiles, "src/ui/people/list.ts": "export const list = []" }, "people list");

    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations/${rid}/submit`, { commit });
    expect(sub.status, JSON.stringify(sub.json)).toBe(201);
    expect(sub.json.candidate.changedPaths).toEqual(["src/ui/people/list.ts"]);
    expect(sub.json.candidate.changedSubjects.sort()).toEqual(["component.AddContactDialog", "screen.people", "section.ui"]);
    expect(sub.json.evaluations.map((e) => e.criterion).sort()).toEqual(REQUIRED);
    expect(sub.json.evaluations.find((e) => e.criterion === "C.system.promotion")).toMatchObject({ execution: "not-run", verdict: "unknown" });
    expect(sub.json.realization.status).toBe("evaluated");
    // Only the manifest hook's required files are read for sizes; other blobs are "not measured" (-1).
    expect(seen[0].tree).toContainEqual({ path: "wrangler.jsonc", size: 2 });
    expect(seen[0].tree).toContainEqual({ path: "src/ui/people/list.ts", size: -1 });
    // Reads: the three required files plus source-map.yaml (for pathNodes); never the other blobs.
    expect(fork.calls.filter((c) => c.startsWith("readBlob:"))).toHaveLength(4);
    expect(seen[0].candidate.pathNodes!["src/ui/people/list.ts"].sort()).toEqual(["component.AddContactDialog", "screen.people", "section.ui"]);
    expect(seen[0].genomeFiles["node.yaml"]).toContain(systemId);
    expect(seen[0].permittedPaths.sort()).toEqual(["src/ui/**", "src/ui/people/**"]);
    expect(seen[0].promotionFacts).toBeUndefined();

    // Same commit again: one candidate.
    const again = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${rid}/submit`, { commit });
    expect(again.status).toBe(200);
    expect(again.json.created).toBe(false);
    expect(again.json.candidate.id).toBe(sub.json.candidate.id);

    const view = await call<RealizationResponse>("GET", `/systems/${systemId}/evolutions/evolution.1/realizations/${rid}`);
    expect(view.json.realization.checkpoints).toHaveLength(1);
    expect(view.json.id).toBe(rid);
    expect(view.json.candidateDetail?.id).toBe(sub.json.candidate.id);
    expect(view.json.evaluations).toHaveLength(REQUIRED.length);

    // Promotion requires the admin token.
    const body = { candidateIds: [sub.json.candidate.id], expectedHead: imp.head, rationale: "looks right" };
    expect((await call<ApiError>("POST", `/systems/${systemId}/promote`, body)).status).toBe(401);
    const wrong = await call<ApiError>("POST", `/systems/${systemId}/promote`, body, { authorization: "Bearer nope" });
    expect([wrong.status, wrong.json.error.code]).toEqual([403, "forbidden"]);
    const promoted = await call<PromoteResponse>("POST", `/systems/${systemId}/promote`, body, ADMIN);
    expect(promoted.status, JSON.stringify(promoted.json)).toBe(200);
    expect(promoted.json.commit.parent).toBe(imp.head);
    expect(promoted.json.commit.composition!.artifacts["artifact.webapp"]).toEqual({ repo: `${appRepo}--r1`, commit });
    expect(promoted.json.advisories).toEqual([]);
    expect(seen.at(-1)!.promotionFacts).toEqual({ currentBaseCommit: imp.appCommit, manifestExact: true, evidenceFresh: true });

    // Replaying the same promotion is stale.
    const stale = await call<ApiError>("POST", `/systems/${systemId}/promote`, body, ADMIN);
    expect(stale.status).toBe(409);
    expect(stale.json.error).toMatchObject({ code: "stale-base", details: { currentHead: promoted.json.commit.id } });

    const hist = await call<HistoryResponse>("GET", `/systems/${systemId}/history`);
    expect(hist.json.commits.map((c) => c.id)).toEqual([promoted.json.commit.id, imp.head]);
    const work = await call<WorkResponse>("GET", `/systems/${systemId}/work`);
    expect(work.json.evolutions.find((e) => e.id === "evolution.1")!.state).toBe("promoted");
  });

  it("reports conflicts and rejects the sibling on promotion", async () => {
    const { ns, systemId, appRepo, imp } = await imported();
    const start = (label: string) => call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, { agentLabel: label });
    const a = (await start("a")).json, b = (await start("b")).json;
    expect(b.packet.concurrentWork.map((w) => w.realization)).toEqual([a.realization.id]);
    const ca = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    const cb = ns.repo(`${appRepo}--r2`).commit({ ...appFiles, "src/ui/people/b.ts": "b" });
    await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: ca });
    const sb = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${b.realization.id}/submit`, { commit: cb });
    expect(sb.json.conflicts).toHaveLength(1);
    const conflicts = await call<ConflictsResponse>("GET", `/systems/${systemId}/conflicts`);
    expect(conflicts.status).toBe(200);
    expect(conflicts.json.conflicts).toHaveLength(1);
    expect(conflicts.json.computedAt).toEqual(expect.any(String));
    // Reads serve stored results: the runner is not called on GET.
    let calls = 0;
    setHooks({ runner: () => ({ ...passing, async conflicts(ctx) { calls++; return passing.conflicts(ctx); } }) });
    await call("GET", `/systems/${systemId}/conflicts`);
    await call("GET", `/systems/${systemId}/realizations/${a.realization.id}`);
    await call("GET", `/systems/${systemId}/evolutions/evolution.1/candidates`);
    expect(calls).toBe(0);
    setHooks({ runner: () => passing });
    const cands = await call<{ candidates: { id: string }[] }>("GET", `/systems/${systemId}/evolutions/evolution.1/candidates`);
    expect(cands.json.candidates).toHaveLength(2);

    const pa = await call<PromoteResponse>("POST", `/systems/${systemId}/promote`,
      { candidates: [cands.json.candidates.find((c) => c.id.includes(".r1."))!.id], expectedHead: imp.head, rationale: "A" }, ADMIN);
    expect(pa.json.rejected).toHaveLength(1);
    const pb = await call<ApiError>("POST", `/systems/${systemId}/promote`,
      { candidates: [sb.json.candidate.id], expectedHead: pa.json.commit.id, rationale: "B" }, ADMIN);
    expect(pb.status).toBe(409);
    expect(pb.json.error.code).toBe("stale-base");
  });

  it("a realization's later submit neither conflicts with nor counts its own earlier candidate", async () => {
    const { ns, systemId, appRepo } = await imported();
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, { agentLabel: "a" })).json;
    const fork = ns.repo(`${appRepo}--r1`);
    const c1 = fork.commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    const c2 = fork.commit({ ...appFiles, "src/ui/people/a.ts": "a2" });
    await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: c1 });
    const second = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: c2 });
    expect(second.status).toBe(201);
    expect(second.json.conflicts).toEqual([]);
    expect(seen.at(-1)!.openCandidates).toEqual([]);
  });

  it("refuses to promote two app candidates in one System commit (409 invalid-state, manifestExact false)", async () => {
    const { ns, systemId, appRepo, imp } = await imported();
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const c1 = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    const s1 = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: c1 });
    // A second candidate from the same realization at a later commit.
    const c2 = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a2" });
    const s2 = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: c2 });
    expect(s2.json.candidate.id).not.toBe(s1.json.candidate.id);
    const res = await call<ApiError>("POST", `/systems/${systemId}/promote`, { candidates: [s1.json.candidate.id, s2.json.candidate.id], expectedHead: imp.head, rationale: "x" }, ADMIN);
    expect(res.status).toBe(409);
    expect(res.json.error).toMatchObject({ code: "invalid-state", message: expect.stringContaining("2 app candidates") });
    expect(seen.filter((x) => x.promotionFacts).map((x) => x.promotionFacts!.manifestExact)).toEqual([false, false]);
    const sys = await call<{ head: string }>("GET", `/systems/${systemId}`);
    expect(sys.json.head).toBe(imp.head);
  });

  it("refuses promotion with 409 gate-unavailable when the canonical Genome does not load", async () => {
    const { ns, systemId, appRepo, imp } = await imported();
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const c = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: c });
    expect(sub.status).toBe(201);
    // Point the Genome source at a repo that does not exist and drop every cached copy of the Genome.
    await runInDurableObject(env.SYSTEMS.getByName(systemId), (_i: SystemAuthority, state) => {
      state.storage.sql.exec("DELETE FROM model_cache");
      state.storage.sql.exec("INSERT OR REPLACE INTO head (k, v) VALUES ('genome_source', 'no-such-repo')");
    });
    clearGenomeMemo();
    const res = await call<ApiError>("POST", `/systems/${systemId}/promote`, { candidates: [sub.json.candidate.id], expectedHead: imp.head, rationale: "x" }, ADMIN);
    expect(res.status).toBe(409);
    expect(res.json.error).toMatchObject({ code: "gate-unavailable", message: expect.stringContaining("does not load") });
    const sys = await call<{ head: string }>("GET", `/systems/${systemId}`);
    expect(sys.json.head).toBe(imp.head);
  });

  it("refuses promotion with 409 gate-unavailable when the Evolution is unknown to the System", async () => {
    const { ns, systemId, appRepo, imp } = await imported();
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const c = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: c });
    await runInDurableObject(env.SYSTEMS.getByName(systemId), (_i: SystemAuthority, state) => {
      state.storage.sql.exec("DELETE FROM evolutions WHERE id = 'evolution.1'");
    });
    const res = await call<ApiError>("POST", `/systems/${systemId}/promote`, { candidates: [sub.json.candidate.id], expectedHead: imp.head, rationale: "x" }, ADMIN);
    expect(res.status).toBe(409);
    expect(res.json.error).toMatchObject({ code: "gate-unavailable", message: expect.stringContaining("evolution.1") });
  });

  it("blocks promotion when required criteria are not pass+completed", async () => {
    const { ns, systemId, appRepo, imp } = await imported();
    setHooks({ runner: () => ({ ...passing, async runSubmission(ctx) { return [hookEval(ctx, "C.people.list", "not-run", "unknown"), hookEval(ctx, "C.people.lint", "completed", "fail")]; } }) });
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const c = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: c });
    const res = await call<ApiError>("POST", `/systems/${systemId}/promote`, { candidates: [sub.json.candidate.id], expectedHead: imp.head, rationale: "" }, ADMIN);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("blocked");
    const details = res.json.error.details as { blocking: { criterion: string }[]; advisories: { criterion: string }[] };
    // Pool = acceptance ∪ promotion-gated, then hard + bound hook blocks. C.people.list is acceptance though gated
    // [submission] only; C.people.audit is [promotion] only. C.people.sorted (soft, no hook) is an advisory.
    expect(details.blocking.map((b) => b.criterion).sort()).toEqual(["C.people.audit", "C.people.list", "C.system.promotion", "C.webapp.exists"]);
    expect(details.advisories.map((b) => b.criterion)).toContain("C.people.sorted");
    // C.people.lint is [submission] only and not acceptance: a failing evaluation neither blocks nor advises.
    expect([...details.blocking, ...details.advisories].map((b) => b.criterion)).not.toContain("C.people.lint");
  });

  it("C.system.promotion blocks without promotionFacts and passes with them", async () => {
    const { ns, systemId, appRepo, imp } = await imported();
    // A runner that ignores the promotion revalidation (as if promotionFacts were never supplied).
    let useFacts = false;
    setHooks({ runner: () => ({ ...passing, async runSubmission(ctx) { return passing.runSubmission(useFacts ? ctx : { ...ctx, promotionFacts: undefined }); } }) });
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const c = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: c });
    const body = { candidates: [sub.json.candidate.id], expectedHead: imp.head, rationale: "ok" };
    const blocked = await call<ApiError>("POST", `/systems/${systemId}/promote`, body, ADMIN);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toMatchObject({ code: "blocked", details: { blocking: [{ criterion: "C.system.promotion", verdict: "unknown", execution: "not-run" }] } });
    useFacts = true;
    const ok = await call<PromoteResponse>("POST", `/systems/${systemId}/promote`, body, ADMIN);
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
  });

  it("refuses a red soft criterion without a rationale and promotes with one", async () => {
    const { ns, systemId, appRepo, imp } = await imported();
    setHooks({ runner: () => ({ ...passing, async runSubmission(ctx) {
      return (await passing.runSubmission(ctx)).map((e) => (e.criterion === "C.people.sorted" ? { ...e, verdict: "fail" as const } : e));
    } }) });
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const c = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: c });
    const body = { candidates: [sub.json.candidate.id], expectedHead: imp.head, rationale: "" };
    const refused = await call<ApiError>("POST", `/systems/${systemId}/promote`, body, ADMIN);
    expect(refused.status).toBe(400);
    expect(refused.json.error).toMatchObject({ code: "advisories-unacknowledged", details: { blocking: [], advisories: [{ criterion: "C.people.sorted", severity: "soft", verdict: "fail" }] } });
    const ok = await call<PromoteResponse>("POST", `/systems/${systemId}/promote`, { ...body, rationale: "sorting follows next week" }, ADMIN);
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json.advisories.map((x) => x.criterion)).toEqual(["C.people.sorted"]);
    expect(ok.json.commit.decision.acknowledged).toEqual(["C.people.sorted"]);
  });

  it("detects a manifest that no longer matches the fork", async () => {
    const { ns, systemId, appRepo, imp } = await imported();
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const c = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: c });
    ns.repo(`${appRepo}--r1`).forget(c);
    const res = await call<ApiError>("POST", `/systems/${systemId}/promote`, { candidates: [sub.json.candidate.id], expectedHead: imp.head, rationale: "x" }, ADMIN);
    expect(res.status).toBe(409);
    expect(seen.at(-1)!.promotionFacts).toMatchObject({ manifestExact: false, evidenceFresh: false });
    expect(res.json.error).toMatchObject({ code: "blocked", details: { blocking: [{ criterion: "C.system.promotion", verdict: "fail", execution: "completed" }] } });
  });

  it("stores a failed conflict run as an error instead of hiding it", async () => {
    const { ns, systemId, appRepo } = await imported();
    setHooks({ runner: () => ({ ...passing, async conflicts() { throw new Error("overlap exploded"); } }) });
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const c = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: c });
    const view = await call<RealizationResponse>("GET", `/systems/${systemId}/realizations/${a.realization.id}`);
    expect(view.json.conflictsError).toBe("overlap exploded");
    const all = await call<ConflictsResponse>("GET", `/systems/${systemId}/conflicts`);
    expect(all.json.errors).toEqual([{ candidate: view.json.candidateDetail!.id, error: "overlap exploded" }]);
  });

  it("start work needs the admin bearer; realization routes need that realization's secret or the admin bearer", async () => {
    const { ns, systemId, appRepo } = await imported();
    const startPath = `/systems/${systemId}/evolutions/evolution.1/realizations`;
    expect((await call<ApiError>("POST", startPath, {}, {})).status).toBe(401);
    expect((await call<ApiError>("POST", startPath, {}, { authorization: "Bearer nope" })).status).toBe(403);
    const a = (await call<StartWorkResponse>("POST", startPath, { agentLabel: "a" }, ADMIN)).json;
    const b = (await call<StartWorkResponse>("POST", startPath, { agentLabel: "b" }, ADMIN)).json;
    expect(a.secret).not.toBe(b.secret);
    const bearer = (s: string) => ({ authorization: `Bearer ${s}` });
    const commit = ns.repo(`${appRepo}--r2`).commit({ ...appFiles, "src/ui/people/b.ts": "b" }, "b");
    const rB = `/systems/${systemId}/evolutions/evolution.1/realizations/${b.realization.id}`;
    const routes: [string, string, unknown?][] = [
      ["GET", rB], ["GET", `${rB}/packet`], ["POST", `${rB}/checkpoints`, { message: "m" }],
      ["POST", `${rB}/sync`], ["POST", `${rB}/submit`, { commit }],
      ["POST", `/systems/${systemId}/realizations/${b.realization.id}/sync`],
    ];
    for (const [method, path, body] of routes) {
      const at = `${method} ${path}`;
      expect((await call<ApiError>(method, path, body, {})).status, at).toBe(401);
      expect((await call<ApiError>(method, path, body, bearer("f".repeat(64)))).status, at).toBe(403);
      // The secret of realization A is not a key to B.
      expect((await call<ApiError>(method, path, body, bearer(a.secret))).status, at).toBe(403);
      expect((await call<ApiError>(method, path, body, bearer(b.secret))).status, at).toBeLessThan(300);
      expect((await call<ApiError>(method, path, body, ADMIN)).status, at).toBeLessThan(300);
    }
    // The registry route checks the secret before it resolves: realization ids repeat across Systems in this test
    // run, yet the secret names its System, and a non-admin never sees 404 or 409 `ambiguous`.
    const viaRegistry = `/realizations/${b.realization.id}/packet`;
    expect((await call<ApiError>("GET", viaRegistry, undefined, {})).status).toBe(401);
    expect((await call<ApiError>("GET", viaRegistry, undefined, bearer("f".repeat(64)))).status).toBe(403);
    expect((await call<ApiError>("GET", viaRegistry, undefined, bearer(a.secret))).status).toBe(403);
    const own = await call<PacketResponse>("GET", viaRegistry, undefined, bearer(b.secret));
    expect([own.status, own.json.systemId]).toEqual([200, systemId]);
    expect((await call<ApiError>("GET", "/realizations/realization.9.r99/packet", undefined, bearer(b.secret))).status).toBe(403);
    // The UI's review stays open.
    expect((await call<ApiError>("GET", `${rB}/review`, undefined, {})).status).not.toBe(401);
  });

  it("rejects unknown commits and validates input", async () => {
    const { systemId } = await imported();
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const bad = await call<ApiError>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: "f".repeat(40) });
    expect(bad.status).toBe(422);
    expect(bad.json.error.code).toBe("unknown-commit");
    expect((await call<ApiError>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: "nope" })).status).toBe(400);
    expect((await call<ApiError>("GET", `/systems/${systemId}/realizations/realization.9.r9`, undefined, ADMIN)).status).toBe(404);
    expect((await call<ApiError>("POST", `/systems/${systemId}/evolutions/evolution.404/realizations`, {})).status).toBe(404);
    expect((await call<ApiError>("GET", `/systems/system.none/model`)).status).toBe(404);
    expect((await call<ApiError>("POST", `/systems/import`, { systemId: "x" })).status).toBe(401);
    expect((await call<ApiError>("POST", `/systems/import`, {}, ADMIN)).status).toBe(400);
    for (const systemId of ["system.--", "system.a/b", "system.Ünïcode", "system.a..b", "system.Kit"]) {
      const bad = await call<ApiError>("POST", `/systems/import`, { systemId }, ADMIN);
      expect([bad.status, bad.json.error.code], systemId).toEqual([400, "invalid-system-id"]);
    }
    expect((await call<ApiError>("POST", `/systems/import`, { systemId: "x", appRepo: "../a" }, ADMIN)).status).toBe(400);
    expect((await call<ApiError>("POST", `/systems/import`, { systemId: "x", genomeRepo: "a..b" }, ADMIN)).status).toBe(400);
    const missing = await call<ApiError>("POST", `/systems/import`, { systemId: "system.absent" }, ADMIN);
    expect([missing.status, missing.json.error.code]).toEqual([422, "repo-not-found"]);
    expect(missing.json.error.message).toContain("absent.genome");
  });

  it("a failed start revokes the token and frees the registry entry", async () => {
    const { ns, systemId, appRepo } = await imported();
    ns.repo(appRepo).readTree = async () => { throw new Error("boom"); };
    const res = await call<ApiError>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {});
    expect(res.status).toBe(500);
    expect(ns.repo(`${appRepo}--r1`).tokens).toMatchObject([{ revoked: true }]);
    const entry = await runInDurableObject(env.SYSTEMS.getByName(REGISTRY), (i: SystemAuthority) => i.resolveFork(`${appRepo}--r1`));
    expect(entry).toBeNull();
  });

  it("never silently re-points an imported System", async () => {
    const { ns, systemId, genomeRepo, appRepo, imp } = await imported();
    const body = { systemId, genomeRepo, appRepo };
    const same = await call<ImportSystemResponse>("POST", "/systems/import", body, ADMIN);
    expect([same.status, same.json.head]).toEqual([201, imp.head]);
    ns.repo(appRepo).commit({ ...appFiles, "README.md": "moved" }, "moved");
    const moved = await call<ApiError>("POST", "/systems/import", body, ADMIN);
    expect([moved.status, moved.json.error.code]).toEqual([409, "already-imported"]);
    const forced = await call<ImportSystemResponse>("POST", "/systems/import", { ...body, force: true }, ADMIN);
    expect(forced.status).toBe(201);
    expect(forced.json.head).not.toBe(imp.head);
  });

  it("sync submits a new fork head once", async () => {
    const { ns, systemId, appRepo } = await imported();
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const nothing = await call<{ submitted: unknown }>("POST", `/systems/${systemId}/realizations/${a.realization.id}/sync`);
    expect(nothing.json.submitted).toBeNull();
    ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    const first = await call<{ submitted: SubmitResponse | null }>("POST", `/systems/${systemId}/realizations/${a.realization.id}/sync`);
    expect(first.json.submitted?.created).toBe(true);
    const second = await call<{ submitted: unknown }>("POST", `/systems/${systemId}/realizations/${a.realization.id}/sync`);
    expect(second.json.submitted).toBeNull();
  });

  it("the Genome review carries loadError when the candidate Genome does not load", async () => {
    const { ns, systemId, genomeRepo, imp } = await imported();
    const start = await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.2/realizations`, {});
    const fork = ns.repo(`${genomeRepo}--r1`);
    const files = new Map<string, string>();
    for (const p of Object.keys(genomeFiles)) files.set(p, (await (await fork.readFile({ ref: imp.genomeCommit, path: p }))!.text()));
    files.set("thing.webapp/section.domain/entity.ContactRecord/node.yaml", "entities: [unclosed");
    const commit = fork.commit(files, "broken");
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${start.json.realization.id}/submit`, { commit });
    expect(sub.status, JSON.stringify(sub.json)).toBe(201);
    const rv = await call<GenomeCandidateReview>("GET", `/systems/${systemId}/realizations/${start.json.realization.id}/review`);
    expect(rv.status).toBe(200);
    expect(rv.json.delta.changes).toEqual([]);
    expect(rv.json.loadError).toEqual(expect.any(String));
    expect(rv.json.loadError!.length).toBeGreaterThan(0);
  });

  it("accepts a Genome realization and re-caches the model", async () => {
    const { ns, systemId, genomeRepo, imp } = await imported();
    const start = await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.2/realizations`, { agentLabel: "c" });
    expect(start.status, JSON.stringify(start.json)).toBe(201);
    expect(start.json.realization.target).toBe("genome");
    expect(start.json.packet.permittedPaths).toEqual(["thing.webapp/section.domain/entity.ContactRecord/**", "evolutions/**"]);
    const fork = ns.repo(`${genomeRepo}--r1`);
    const base = new Map<string, string>();
    for (const p of Object.keys(genomeFiles)) base.set(p, (await (await fork.readFile({ ref: imp.genomeCommit, path: p }))!.text()));
    base.set("thing.webapp/section.domain/entity.ContactRecord/node.yaml", base.get("thing.webapp/section.domain/entity.ContactRecord/node.yaml")!.replace("name: Contact record", "name: Contact record v2"));
    const commit = fork.commit(base, "rename entity");
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${start.json.realization.id}/submit`, { commit });
    expect(sub.status, JSON.stringify(sub.json)).toBe(201);
    expect(sub.json.realization.status).toBe("awaiting-admin");
    expect(sub.json.candidate.changedSubjects).toEqual(["entity.ContactRecord"]);
    const rv = await call<GenomeCandidateReview>("GET", `/systems/${systemId}/evolutions/evolution.2/realizations/${start.json.realization.id}/review`);
    expect(rv.status, JSON.stringify(rv.json)).toBe(200);
    expect(rv.json.candidate).toBe(sub.json.candidate.id);
    expect(rv.json.delta.changes.map((c) => c.id)).toEqual(["entity.ContactRecord"]);
    expect(rv.json.loadError).toBeUndefined();
    expect(rv.json.readinessBase.packs.map((p) => p.id).filter((id) => !id.startsWith("engine."))).toEqual(["facts", "metamodel"]);
    expect(rv.json.readinessCandidate).not.toBeNull();
    expect(rv.json.review.map((r) => r.id)).toEqual(["entity.ContactRecord"]);
    expect(rv.json.signals).toHaveLength(1);
    expect(rv.json.evaluations).toEqual(sub.json.evaluations);
    const notGenome = await call<ApiError>("GET", `/systems/${systemId}/realizations/realization.1.r9/review`);
    expect(notGenome.status).toBe(404);
    const body = { realizationId: start.json.realization.id, candidateId: rv.json.candidate, commit: rv.json.commit, interpretation: "ok" };
    expect((await call<ApiError>("POST", `/systems/${systemId}/evolutions/evolution.2/accept`, body)).status).toBe(401);
    const acc = await call<{ genomeCommit: string }>("POST", `/systems/${systemId}/evolutions/evolution.2/accept`, body, ADMIN);
    expect(acc.status, JSON.stringify(acc.json)).toBe(200);
    expect(acc.json.genomeCommit).toBe(commit);
    const model = await call<ModelBundle>("GET", `/systems/${systemId}/model`);
    expect(model.json.genomeCommit).toBe(commit);
    expect(modelOf(model.json).index.byId["entity.ContactRecord"].name).toBe("Contact record v2");
  });

  it("accept refuses a Genome candidate the promotion gate blocks (409 blocked)", async () => {
    setHooks({ runner: () => ({ ...passing, async runGenome(ctx) {
      const out = await passing.runGenome(ctx);
      return { ...out, evaluations: out.evaluations.map((e) => (e.criterion === "C.system.promotion" ? { ...e, verdict: "fail" as const } : e)) };
    } }) });
    const { ns, systemId, genomeRepo, imp } = await imported();
    const start = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.2/realizations`, {})).json;
    const fork = ns.repo(`${genomeRepo}--r1`);
    const files = new Map<string, string>();
    for (const p of Object.keys(genomeFiles)) files.set(p, (await (await fork.readFile({ ref: imp.genomeCommit, path: p }))!.text()));
    files.set("thing.webapp/section.domain/entity.ContactRecord/node.yaml", files.get("thing.webapp/section.domain/entity.ContactRecord/node.yaml")!.replace("name: Contact record", "name: Contact v4"));
    const commit = fork.commit(files, "rename");
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${start.realization.id}/submit`, { commit });
    const res = await call<ApiError>("POST", `/systems/${systemId}/evolutions/evolution.2/accept`, { realizationId: start.realization.id, candidateId: sub.json.candidate.id, commit, interpretation: "fine" }, ADMIN);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("blocked");
    // Only model-level criteria gate a Genome candidate; the artifact criteria gate app candidates.
    expect((res.json.error.details as { blocking: { criterion: string }[] }).blocking.map((b) => b.criterion)).toEqual(["C.system.promotion"]);
    expect((await call<ModelBundle>("GET", `/systems/${systemId}/model`)).json.genomeCommit).toBe(imp.genomeCommit);
  });

  it("rejects a Genome realization with a reason (admin)", async () => {
    const { ns, systemId, genomeRepo, imp } = await imported();
    const start = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.2/realizations`, {})).json;
    const rid = start.realization.id;
    const fork = ns.repo(`${genomeRepo}--r1`);
    const files = new Map<string, string>();
    for (const p of Object.keys(genomeFiles)) files.set(p, (await (await fork.readFile({ ref: imp.genomeCommit, path: p }))!.text()));
    files.set("thing.webapp/section.domain/entity.ContactRecord/node.yaml", files.get("thing.webapp/section.domain/entity.ContactRecord/node.yaml")!.replace("name: Contact record", "name: Contact v3"));
    const commit = fork.commit(files, "rename");
    await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${rid}/submit`, { commit });
    const path = `/systems/${systemId}/evolutions/evolution.2/realizations/${rid}/reject`;
    expect((await call<ApiError>("POST", path, { reason: "no" })).status).toBe(401);
    expect((await call<ApiError>("POST", path, { reason: " " }, ADMIN)).status).toBe(400);
    const res = await call<{ realization: { status: string; rejectionReason?: string } }>("POST", path, { reason: "renames break exports" }, ADMIN);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.realization).toMatchObject({ status: "rejected", rejectionReason: "renames break exports" });
    const cands = await call<{ candidates: { state: string }[] }>("GET", `/systems/${systemId}/evolutions/evolution.2/candidates`);
    expect(cands.json.candidates.map((c) => c.state)).toEqual(["rejected"]);
    const via = `/systems/${systemId}/realizations/${rid}/reject`;
    expect((await call<ApiError>("POST", via, { reason: "again" }, ADMIN)).status).toBe(200);
    // The fork's write token and the realization secret are revoked together.
    expect(fork.tokens).toMatchObject([{ revoked: true }]);
    const revoked = await call<ApiError>("POST", `/systems/${systemId}/realizations/${rid}/submit`, { commit }, { authorization: `Bearer ${start.secret}` });
    expect(revoked.status).toBe(403);
    // A later push is acked without a retry or a new candidate.
    files.set("evolutions/late.yaml", "id: late");
    const late = fork.commit(files, "late push");
    const acked: string[] = [], retried: string[] = [];
    const message = { id: "late", attempts: 1, ack: () => acked.push("late"), retry: () => retried.push("late"),
      body: { type: PUSHED, source: { namespace: "artyfact", repoName: `${genomeRepo}--r1` }, payload: { ref: "refs/heads/main", after: late } } };
    await queueEntry({ queue: "artyfact-events", messages: [message], ackAll() {}, retryAll() {} } as unknown as MessageBatch<unknown>, env);
    expect([acked, retried]).toEqual([["late"], []]);
    const after = await call<{ candidates: { commit: string }[] }>("GET", `/systems/${systemId}/evolutions/evolution.2/candidates`);
    expect(after.json.candidates.map((c) => c.commit)).toEqual([commit]);
  });

  it("the queue consumer submits pushes to known forks once", async () => {
    resetHooks();
    expect(hookRunner(env)).not.toBe(noopHookRunner); // the real runner from ./hooks/run is the default
    setHooks({ runner: () => passing });
    const { ns, systemId, appRepo } = await imported();
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const commit = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/q.ts": "q" });
    const acked: string[] = [];
    const msg = (id: string) => ({
      id, attempts: 1, ack: () => acked.push(id), retry: () => {},
      body: { type: PUSHED, source: { namespace: "artyfact", repoName: `${appRepo}--r1` }, payload: { ref: "refs/heads/main", after: commit } },
    });
    const batch = (id: string) => ({ queue: "artyfact-events", messages: [msg(id)], ackAll() {}, retryAll() {} }) as unknown as MessageBatch<unknown>;
    await queueEntry(batch("m1"), env);
    await queueEntry(batch("m2"), env);
    expect(acked).toEqual(["m1", "m2"]);
    const cands = await call<{ candidates: { commit: string }[] }>("GET", `/systems/${systemId}/evolutions/evolution.1/candidates`);
    expect(cands.json.candidates.map((c) => c.commit)).toEqual([commit]);
  });

  it("keeps the same realization id in two Systems apart (queue, /realizations/:rid)", async () => {
    const A = await imported(), B = await imported(A.ns);
    const startIn = (sid: string) => call<StartWorkResponse>("POST", `/systems/${sid}/evolutions/evolution.1/realizations`, {});
    const ra = (await startIn(A.systemId)).json, rb = (await startIn(B.systemId)).json;
    expect(ra.realization.id).toBe(rb.realization.id);
    // A push to A's fork lands in A even though B registered the same realization id later.
    const commit = A.ns.repo(`${A.appRepo}--r1`).commit({ ...appFiles, "src/ui/people/q.ts": "q" });
    const acked: string[] = [];
    const message = { id: "two-systems", attempts: 1, ack: () => acked.push("two-systems"), retry: () => {},
      body: { type: PUSHED, source: { namespace: "artyfact", repoName: `${A.appRepo}--r1` }, payload: { ref: "refs/heads/main", after: commit } } };
    await queueEntry({ queue: "artyfact-events", messages: [message], ackAll() {}, retryAll() {} } as unknown as MessageBatch<unknown>, env);
    expect(acked).toEqual(["two-systems"]);
    const inA = await call<{ candidates: { commit: string }[] }>("GET", `/systems/${A.systemId}/evolutions/evolution.1/candidates`);
    const inB = await call<{ candidates: { commit: string }[] }>("GET", `/systems/${B.systemId}/evolutions/evolution.1/candidates`);
    expect(inA.json.candidates.map((c) => c.commit)).toEqual([commit]);
    expect(inB.json.candidates).toEqual([]);
    // The System-less route refuses to guess for the admin; a realization secret names its own System.
    const amb = await call<ApiError>("GET", `/realizations/${ra.realization.id}`, undefined, ADMIN);
    expect(amb.status).toBe(409);
    expect(amb.json.error).toMatchObject({ code: "ambiguous", details: { systems: expect.arrayContaining([A.systemId, B.systemId]) } });
    for (const [r, sid] of [[ra, A.systemId], [rb, B.systemId]] as const) {
      const own = await call<RealizationResponse>("GET", `/realizations/${r.realization.id}`, undefined, { authorization: `Bearer ${r.secret}` });
      expect([own.status, own.json.systemId]).toEqual([200, sid]);
    }
    // The System-scoped route still works.
    expect((await call<RealizationResponse>("GET", `/systems/${B.systemId}/realizations/${rb.realization.id}`, undefined, { authorization: `Bearer ${rb.secret}` })).status).toBe(200);
  });

  it("a retry after failed hooks reports created: false and concurrent retries run the hooks once", async () => {
    let fail = true, runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    setHooks({ runner: () => ({ ...passing, async runSubmission(ctx) {
      if (fail) { fail = false; throw new Error("runner down"); }
      runs++;
      await gate;
      return passing.runSubmission(ctx);
    } }) });
    const { ns, systemId, appRepo } = await imported();
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const commit = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/r.ts": "r" });
    const path = `/systems/${systemId}/realizations/${a.realization.id}/submit`;
    expect((await call<ApiError>("POST", path, { commit })).status).toBe(500);
    const first = call<SubmitResponse>("POST", path, { commit });
    while (runs === 0) await new Promise((r) => setTimeout(r, 5));
    const second = await call<SubmitResponse>("POST", path, { commit });
    expect([second.status, second.json.created]).toEqual([200, false]);
    release();
    const done = await first;
    expect([done.status, done.json.created]).toEqual([200, false]);
    expect(runs).toBe(1);
    expect(done.json.evaluations.length).toBeGreaterThan(0);
  });

  it("the default runner factory passes the Worker env as both s1Env and previewEnv", () => {
    const calls: unknown[] = [];
    const made = defaultHookRunner(env, (deps) => { calls.push(deps); return noopHookRunner; });
    expect(made).toBe(noopHookRunner);
    expect(calls).toHaveLength(1);
    expect((calls[0] as { s1Env: unknown }).s1Env).toBe(env);
    expect((calls[0] as { previewEnv: unknown }).previewEnv).toBe(env);
    resetHooks();
    expect(hookRunner(env)).not.toBe(noopHookRunner);
  });

  it("a CLI submit after a winning queue submit stores the preview URL and re-runs the hooks", async () => {
    const withHealth: HookRunner = {
      ...passing,
      async runSubmission(ctx) {
        const out = await passing.runSubmission(ctx);
        return ctx.candidate.previewUrl ? [...out, hookEval(ctx, "C.webapp.health", "completed", "pass")] : out;
      },
    };
    setHooks({ runner: () => withHealth });
    const { ns, systemId, appRepo } = await imported();
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const rid = a.realization.id;
    const commit = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/p.ts": "p" });
    const message = { id: "q-first", attempts: 1, ack: () => {}, retry: () => {},
      body: { type: PUSHED, source: { namespace: "artyfact", repoName: `${appRepo}--r1` }, payload: { ref: "refs/heads/main", after: commit } } };
    await queueEntry({ queue: "artyfact-events", messages: [message], ackAll() {}, retryAll() {} } as unknown as MessageBatch<unknown>, env);
    expect(seen).toHaveLength(1);
    expect(seen[0].candidate.previewUrl).toBeUndefined();

    const previewUrl = "https://kit-r1.example.workers.dev";
    const cli = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${rid}/submit`, { commit, previewUrl });
    expect(cli.status).toBe(200);
    expect(cli.json.created).toBe(false);
    expect(seen).toHaveLength(2);
    expect(seen[1].candidate.previewUrl).toBe(previewUrl);
    expect(cli.json.evaluations.map((e) => e.criterion)).toContain("C.webapp.health");
    const stored = await runInDurableObject(env.SYSTEMS.getByName(systemId), (_i: SystemAuthority, state) =>
      state.storage.sql.exec("SELECT manifest_json FROM candidates WHERE id = ?", cli.json.candidate.id).one().manifest_json);
    expect(JSON.parse(String(stored)).previewUrl).toBe(previewUrl);

    // The same submit again is a no-op: the preview is already stored.
    const again = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${rid}/submit`, { commit, previewUrl });
    expect(again.json.created).toBe(false);
    expect(seen).toHaveLength(2);
  });

  it("streams SSE events", async () => {
    const { systemId } = await imported();
    const res = await exports.default.fetch(new Request(`http://example.com/api/systems/${systemId}/events`));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const first = dec.decode((await reader.read()).value);
    expect(first).toContain('"type":"ping"');
    await call("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {});
    let text = "";
    while (!text.includes("realization.created")) text += dec.decode((await reader.read()).value);
    expect(text).toMatch(/data: \{"type":"realization.created".*"at":"/);
    await reader.cancel();
  });
});

describe("routes: final review fixes", () => {
  /** A Genome realization on evolution.2 and a helper that commits an ontology rename to its fork. */
  async function genomeWork() {
    const s = await imported();
    const start = (await call<StartWorkResponse>("POST", `/systems/${s.systemId}/evolutions/evolution.2/realizations`, {})).json;
    const fork = s.ns.repo(`${s.genomeRepo}--r1`);
    const base = new Map<string, string>();
    for (const p of Object.keys(genomeFiles)) base.set(p, (await (await fork.readFile({ ref: s.imp.genomeCommit, path: p }))!.text()));
    const amend = (name: string) => {
      const files = new Map(base);
      files.set("thing.webapp/section.domain/entity.ContactRecord/node.yaml", files.get("thing.webapp/section.domain/entity.ContactRecord/node.yaml")!.replace("name: Contact record", `name: ${name}`));
      return fork.commit(files, name);
    };
    const submitGenome = (commit: string) => call<SubmitResponse>("POST", `/systems/${s.systemId}/realizations/${start.realization.id}/submit`, { commit });
    return { ...s, start, fork, base, amend, submitGenome };
  }

  it("I1: accept names the reviewed candidate; a resubmit between review and accept is 409 stale-candidate", async () => {
    const { systemId, imp, start, fork, amend, submitGenome } = await genomeWork();
    const rid = start.realization.id;
    const c1 = amend("Contact v5");
    expect((await submitGenome(c1)).status).toBe(201);
    const rv = await call<GenomeCandidateReview>("GET", `/systems/${systemId}/realizations/${rid}/review`);
    expect(rv.json).toMatchObject({ candidate: expect.stringContaining(c1.slice(0, 7)), commit: c1 });
    const reviewed = { realizationId: rid, candidateId: rv.json.candidate!, commit: rv.json.commit!, interpretation: "ok" };
    // The agent submits again before the admin presses Accept.
    const c2 = amend("Contact v6");
    expect((await submitGenome(c2)).status).toBe(201);
    const accept = (body: unknown) => call<ApiError & { genomeCommit?: string }>("POST", `/systems/${systemId}/evolutions/evolution.2/accept`, body, ADMIN);
    const stale = await accept(reviewed);
    expect([stale.status, stale.json.error?.code]).toEqual([409, "stale-candidate"]);
    expect((await call<ModelBundle>("GET", `/systems/${systemId}/model`)).json.genomeCommit).toBe(imp.genomeCommit);
    // Both fields are required; a commit that does not match the named candidate is stale too.
    expect((await accept({ realizationId: rid, interpretation: "ok" })).status).toBe(400);
    const fresh = await call<GenomeCandidateReview>("GET", `/systems/${systemId}/realizations/${rid}/review`);
    expect(fresh.json.commit).toBe(c2);
    const wrongCommit = await accept({ ...reviewed, candidateId: fresh.json.candidate, commit: c1 });
    expect([wrongCommit.status, wrongCommit.json.error?.code]).toEqual([409, "stale-candidate"]);
    // The candidate the admin now reviewed is accepted, and the agent's credentials end with it (M3).
    const ok = await accept({ ...reviewed, candidateId: fresh.json.candidate, commit: fresh.json.commit });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json.genomeCommit).toBe(c2);
    expect(fork.tokens).toMatchObject([{ revoked: true }]);
    const after = await call<ApiError>("POST", `/systems/${systemId}/realizations/${rid}/checkpoints`, { message: "late" }, { authorization: `Bearer ${start.secret}` });
    expect(after.status).toBe(403);
  });

  it("I4: /promote refuses a Genome candidate with 409 use-accept and changes nothing", async () => {
    const { systemId, imp, amend, submitGenome } = await genomeWork();
    const sub = await submitGenome(amend("Contact v7"));
    const res = await call<ApiError>("POST", `/systems/${systemId}/promote`, { candidates: [sub.json.candidate.id], expectedHead: imp.head, rationale: "r" }, ADMIN);
    expect(res.status).toBe(409);
    expect(res.json.error).toMatchObject({ code: "use-accept", message: expect.stringContaining("/accept") });
    expect((await call<{ head: string; genomeCommit: string }>("GET", `/systems/${systemId}`)).json).toMatchObject({ head: imp.head, genomeCommit: imp.genomeCommit });
    expect((await call<{ candidates: { state: string }[] }>("GET", `/systems/${systemId}/evolutions/evolution.2/candidates`)).json.candidates.map((c) => c.state)).toEqual(["evaluated"]);
  });

  it("M1: the promotion re-run tells the hooks it is the promotion trigger", async () => {
    const { ns, systemId, appRepo, imp } = await imported();
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const commit = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit });
    expect(seen.at(-1)!.trigger).toBe("submission");
    await call<PromoteResponse>("POST", `/systems/${systemId}/promote`, { candidates: [sub.json.candidate.id], expectedHead: imp.head, rationale: "r" }, ADMIN);
    expect(seen.at(-1)).toMatchObject({ trigger: "promotion", promotionFacts: expect.any(Object) });
  });

  it("M2: reads of an unknown System are 404 before its Durable Object exists; rev=<sha> must be a recorded commit", async () => {
    const unknown = `system.nobody${++seq}`;
    for (const path of ["", "/model", "/readiness", "/work", "/history", "/candidates", "/evaluations", "/conflicts", "/realizations", "/evolutions/evolution.1/candidates", "/events"]) {
      const res = await exports.default.fetch(new Request(`http://example.com/api/systems/${unknown}${path}`));
      expect([path, res.status]).toEqual([path, 404]);
      await res.body?.cancel();
    }
    // /work and /history used to answer 200 from a freshly created DO; the 404 comes from the registry check instead.

    const { ns, systemId, genomeRepo, imp } = await imported();
    const calls = ns.repo(genomeRepo).calls.length;
    const foreign = "f".repeat(40);
    const res = await call<ApiError>("GET", `/systems/${systemId}/model?rev=${foreign}`);
    expect(res.status).toBe(404);
    expect(ns.repo(genomeRepo).calls.length).toBe(calls);
    expect((await call<ModelBundle>("GET", `/systems/${systemId}/model?rev=${imp.genomeCommit}`)).status).toBe(200);
  });

  it("M3: promotion revokes the promoted and rejected realizations' secrets and write tokens", async () => {
    const { ns, systemId, appRepo, imp } = await imported();
    const start = (label: string) => call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, { agentLabel: label });
    const a = (await start("a")).json, b = (await start("b")).json;
    const ca = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    const cb = ns.repo(`${appRepo}--r2`).commit({ ...appFiles, "src/ui/people/b.ts": "b" });
    const sa = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: ca });
    await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${b.realization.id}/submit`, { commit: cb });
    const promoted = await call<PromoteResponse>("POST", `/systems/${systemId}/promote`, { candidates: [sa.json.candidate.id], expectedHead: imp.head, rationale: "A" }, ADMIN);
    expect(promoted.status, JSON.stringify(promoted.json)).toBe(200);
    expect(promoted.json).not.toHaveProperty("ended");
    for (const [r, n] of [[a, 1], [b, 2]] as const) {
      expect(ns.repo(`${appRepo}--r${n}`).tokens).toMatchObject([{ revoked: true }]);
      const res = await call<ApiError>("POST", `/systems/${systemId}/realizations/${r.realization.id}/checkpoints`, { message: "late" }, { authorization: `Bearer ${r.secret}` });
      expect(res.status).toBe(403);
    }
  });

  it("M4: a reject that lands while start work forks wins; the fresh token is revoked and start answers 409", async () => {
    const { ns, systemId, appRepo } = await imported();
    const base = ns.repo(appRepo);
    const readTree = base.readTree.bind(base);
    let rejected = false;
    base.readTree = async (hash: string) => {
      if (!rejected) {
        rejected = true;
        await runInDurableObject(env.SYSTEMS.getByName(systemId), (i: SystemAuthority) => i.rejectRealization("realization.1.r1", "changed my mind"));
      }
      return readTree(hash);
    };
    const res = await call<ApiError>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {});
    expect([res.status, res.json.error.code]).toEqual([409, "invalid-state"]);
    expect(JSON.stringify(res.json)).not.toMatch(/secret-|[0-9a-f]{64}/);
    expect(ns.repo(`${appRepo}--r1`).tokens).toMatchObject([{ revoked: true }]);
    const rec = await runInDurableObject(env.SYSTEMS.getByName(systemId), (i: SystemAuthority) => ({ r: i.realization("realization.1.r1"), hash: i.realizationSecretHash("realization.1.r1") }));
    expect(rec.r).toMatchObject({ tokenId: null, realization: { status: "rejected", rejectionReason: "changed my mind" } });
    expect(rec.hash).toBeNull();
  });

  it("M5: readiness at head counts every promoted ancestor's evidence, as the UI does", async () => {
    const { ns, systemId, appRepo, genomeRepo, imp } = await imported();
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const commit = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit });
    const p = await call<PromoteResponse>("POST", `/systems/${systemId}/promote`, { candidates: [sub.json.candidate.id], expectedHead: imp.head, rationale: "r" }, ADMIN);
    const passAt = async () => (await call<ReadinessResponse>("GET", `/systems/${systemId}/readiness`)).json.implementationConformance.pass;
    const afterApp = await passAt();
    expect(afterApp).toBeGreaterThan(1);
    // A Genome amendment whose hooks only evaluate C.system.promotion: the earlier app evidence must still count at head.
    setHooks({ runner: () => ({ ...passing, async runGenome(ctx) {
      const out = await passing.runGenome(ctx);
      return { ...out, evaluations: out.evaluations.filter((e) => e.criterion === "C.system.promotion") };
    } }) });
    const g = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.2/realizations`, {})).json;
    const fork = ns.repo(`${genomeRepo}--r2`);
    const files = new Map<string, string>();
    for (const path of Object.keys(genomeFiles)) files.set(path, (await (await fork.readFile({ ref: imp.genomeCommit, path }))!.text()));
    files.set("thing.webapp/section.domain/entity.ContactRecord/node.yaml", files.get("thing.webapp/section.domain/entity.ContactRecord/node.yaml")!.replace("name: Contact record", "name: Contact v8"));
    const gc = fork.commit(files, "rename");
    const gs = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${g.realization.id}/submit`, { commit: gc });
    const acc = await call<{ commit: { id: string; parent: string } }>("POST", `/systems/${systemId}/evolutions/evolution.2/accept`,
      { realizationId: g.realization.id, candidateId: gs.json.candidate.id, commit: gc, interpretation: "ok" }, ADMIN);
    expect(acc.status, JSON.stringify(acc.json)).toBe(200);
    expect(acc.json.commit.parent).toBe(p.json.commit.id);
    expect(await passAt()).toBeGreaterThanOrEqual(afterApp);
    const atCommit = await call<ReadinessResponse>("GET", `/systems/${systemId}/readiness?rev=${acc.json.commit.id}`);
    expect(atCommit.json.implementationConformance.pass).toBeGreaterThanOrEqual(afterApp);
  });

  it("M8: a Genome over the size limit is refused 422 genome-too-large with the limit, not a 500", async () => {
    const { systemId, start, fork, base, submitGenome } = await genomeWork();
    const files = new Map(base);
    files.set("evolutions/huge.yaml", `# ${"x".repeat(1_100_000)}\n`);
    const res = await submitGenome(fork.commit(files, "huge"));
    expect(res.status).toBe(422);
    const err = (res.json as unknown as ApiError).error;
    expect(err.code).toBe("genome-too-large");
    expect(err.message).toMatch(/limit is 1000000 bytes/);
    expect((await call<{ candidates: unknown[] }>("GET", `/systems/${systemId}/evolutions/evolution.2/candidates`)).json.candidates).toEqual([]);
    expect(start.realization.status).toBe("claimed");
  });
});

describe("routes: candidates carry the server's gate set (I3)", () => {
  it("lists each candidate's promotion gate as prepareGate computes it; a Genome candidate's leaves artifact criteria out", async () => {
    const { ns, systemId, appRepo, genomeRepo, imp } = await imported();
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" }) });
    const app = await call<CandidatesResponse>("GET", `/systems/${systemId}/evolutions/evolution.1/candidates`);
    const appGate = app.json.gates![sub.json.candidate.id]!;
    expect(appGate.filter((g) => g.blocking).map((g) => g.id).sort()).toEqual(["C.people.audit", "C.people.list", "C.system.promotion", "C.webapp.exists"]);
    // A hard acceptance criterion without a bound hook is an advisory, as the DO treats it.
    expect(appGate.find((g) => g.id === "C.people.sorted")).toMatchObject({ blocking: false });
    expect(app.json.gatesError).toBeUndefined();

    const g = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.2/realizations`, {})).json;
    const fork = ns.repo(`${genomeRepo}--r2`);
    const files = new Map<string, string>();
    for (const p of Object.keys(genomeFiles)) files.set(p, (await (await fork.readFile({ ref: imp.genomeCommit, path: p }))!.text()));
    files.set("thing.webapp/section.domain/entity.ContactRecord/node.yaml", files.get("thing.webapp/section.domain/entity.ContactRecord/node.yaml")!.replace("name: Contact record", "name: Contact v9"));
    const gs = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${g.realization.id}/submit`, { commit: fork.commit(files, "rename") });
    const genome = await call<CandidatesResponse>("GET", `/systems/${systemId}/evolutions/evolution.2/candidates`);
    expect(genome.json.gates![gs.json.candidate.id]!.filter((x) => x.blocking).map((x) => x.id)).toEqual(["C.system.promotion"]);
  });
});
