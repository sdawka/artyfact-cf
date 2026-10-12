import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ApiError, ConflictsResponse, GenomeCandidateReview, ImportSystemResponse, ModelBundle, PacketResponse, PromoteResponse, RealizationResponse,
  SerializedModel, StartWorkResponse, SubmitResponse, SystemsResponse, HistoryResponse, WorkResponse, ReadinessResponse,
} from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { clearGenomeMemo } from "../worker/artifacts/genome-source";
import { REGISTRY, type SystemAuthority } from "../worker/do/system-authority";
import type { Evaluation as HookEvaluation, HookRunner, SubmissionContext } from "../worker/hooks/contract";
import { hookRunner, noopHookRunner, queueEntry, resetHooks, setHooks } from "../worker/hooks/index";
import { PUSHED } from "../worker/hooks/queue";
import { appFiles, genomeFiles } from "./fixtures/genome";
import { FakeArtifacts } from "./helpers/fake-artifacts";

const ADMIN = { authorization: "Bearer test-admin-token" };
let seq = 0;

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: T }> {
  const res = await exports.default.fetch(new Request(`http://example.com/api${path}`, {
    method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }),
  }));
  return { status: res.status, json: (await res.json()) as T };
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
    return { ...base, review: [{ subject: "entity.ContactRecord", judgment: "reviewDelta", level: "info", verdict: "pass", signals: signals as never }] };
  },
  async conflicts(ctx) {
    return ctx.openCandidates.length
      ? [{ kind: "soft-semantic", candidates: [ctx.candidate.id, ...ctx.openCandidates.map((c) => c.id)].sort(), subjects: ["screen.people"], nodes: ["screen.people"], paths: [], message: "both touch screen.people" }]
      : [];
  },
};

beforeEach(() => { seen.length = 0; setHooks({ runner: () => passing }); });
afterEach(() => { setArtifactsOverride(undefined); resetHooks(); });

/** System ids are global DO names; give each test a unique one by rewriting system.yaml. */
function uniqueSystem(ns: FakeArtifacts, genomeRepo: string): string {
  const id = `system.kit${seq}`;
  const files = { ...genomeFiles, "system.yaml": genomeFiles["system.yaml"].replace("system.kit", id), "criteria.yaml": genomeFiles["criteria.yaml"].replaceAll("system.kit", id) };
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
    expect(rd.json.packs.map((p) => p.id)).toEqual(["metamodel"]);
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
    expect(start.json.startCommand).toBe(
      `ARTYFACT_TOKEN=${start.json.token.value} npx artyfact start ${rid} --system ${systemId} --evolution evolution.1 --dir ./${rid}`,
    );
    expect(start.json.packet.startCommand).toContain("ARTYFACT_TOKEN=<token> npx artyfact start");
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
    const stored = await runInDurableObject(env.SYSTEMS.getByName(systemId), (i: SystemAuthority) => i.realization(rid));
    expect(JSON.stringify(stored)).not.toContain(start.json.token.value);
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
    expect(seen[0].genomeFiles["system.yaml"]).toContain(systemId);
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

  it("rejects unknown commits and validates input", async () => {
    const { systemId } = await imported();
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const bad = await call<ApiError>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: "f".repeat(40) });
    expect(bad.status).toBe(422);
    expect(bad.json.error.code).toBe("unknown-commit");
    expect((await call<ApiError>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: "nope" })).status).toBe(400);
    expect((await call<ApiError>("GET", `/systems/${systemId}/realizations/realization.9.r9`)).status).toBe(404);
    expect((await call<ApiError>("POST", `/systems/${systemId}/evolutions/evolution.404/realizations`, {})).status).toBe(404);
    expect((await call<ApiError>("GET", `/systems/system.none/model`)).status).toBe(404);
    expect((await call<ApiError>("POST", `/systems/import`, { systemId: "x" })).status).toBe(401);
    expect((await call<ApiError>("POST", `/systems/import`, { systemId: "x" }, ADMIN)).status).toBe(400);
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

  it("accepts a Genome realization and re-caches the model", async () => {
    const { ns, systemId, genomeRepo, imp } = await imported();
    const start = await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.2/realizations`, { agentLabel: "c" });
    expect(start.status, JSON.stringify(start.json)).toBe(201);
    expect(start.json.realization.target).toBe("genome");
    expect(start.json.packet.permittedPaths).toEqual(["things/webapp/ontology.yaml", "evolutions/**"]);
    const fork = ns.repo(`${genomeRepo}--r1`);
    const base = new Map<string, string>();
    for (const p of Object.keys(genomeFiles)) base.set(p, (await (await fork.readFile({ ref: imp.genomeCommit, path: p }))!.text()));
    base.set("things/webapp/ontology.yaml", base.get("things/webapp/ontology.yaml")!.replace("name: Contact record", "name: Contact record v2"));
    const commit = fork.commit(base, "rename entity");
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${start.json.realization.id}/submit`, { commit });
    expect(sub.status, JSON.stringify(sub.json)).toBe(201);
    expect(sub.json.realization.status).toBe("awaiting-admin");
    expect(sub.json.candidate.changedSubjects).toEqual(["entity.ContactRecord"]);
    const rv = await call<GenomeCandidateReview>("GET", `/systems/${systemId}/evolutions/evolution.2/realizations/${start.json.realization.id}/review`);
    expect(rv.status, JSON.stringify(rv.json)).toBe(200);
    expect(rv.json.candidate).toBe(sub.json.candidate.id);
    expect(rv.json.delta.changes.map((c) => c.id)).toEqual(["entity.ContactRecord"]);
    expect(rv.json.readinessBase.packs.map((p) => p.id)).toEqual(["metamodel"]);
    expect(rv.json.readinessCandidate).not.toBeNull();
    expect(rv.json.review.map((r) => r.id)).toEqual(["entity.ContactRecord"]);
    expect(rv.json.signals).toHaveLength(1);
    expect(rv.json.evaluations).toEqual(sub.json.evaluations);
    const notGenome = await call<ApiError>("GET", `/systems/${systemId}/realizations/realization.1.r9/review`);
    expect(notGenome.status).toBe(404);
    const body = { realizationId: start.json.realization.id, interpretation: "ok" };
    expect((await call<ApiError>("POST", `/systems/${systemId}/evolutions/evolution.2/accept`, body)).status).toBe(401);
    const acc = await call<{ genomeCommit: string }>("POST", `/systems/${systemId}/evolutions/evolution.2/accept`, body, ADMIN);
    expect(acc.status, JSON.stringify(acc.json)).toBe(200);
    expect(acc.json.genomeCommit).toBe(commit);
    const model = await call<ModelBundle>("GET", `/systems/${systemId}/model`);
    expect(model.json.genomeCommit).toBe(commit);
    expect(modelOf(model.json).index.byId["entity.ContactRecord"].name).toBe("Contact record v2");
  });

  it("rejects a Genome realization with a reason (admin)", async () => {
    const { ns, systemId, genomeRepo, imp } = await imported();
    const start = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.2/realizations`, {})).json;
    const rid = start.realization.id;
    const fork = ns.repo(`${genomeRepo}--r1`);
    const files = new Map<string, string>();
    for (const p of Object.keys(genomeFiles)) files.set(p, (await (await fork.readFile({ ref: imp.genomeCommit, path: p }))!.text()));
    files.set("things/webapp/ontology.yaml", files.get("things/webapp/ontology.yaml")!.replace("name: Contact record", "name: Contact v3"));
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
    // The System-less route refuses to guess.
    const amb = await call<ApiError>("GET", `/realizations/${ra.realization.id}`);
    expect(amb.status).toBe(409);
    expect(amb.json.error).toMatchObject({ code: "ambiguous", details: { systems: expect.arrayContaining([A.systemId, B.systemId]) } });
    // The System-scoped route still works.
    expect((await call<RealizationResponse>("GET", `/systems/${B.systemId}/realizations/${rb.realization.id}`)).status).toBe(200);
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
