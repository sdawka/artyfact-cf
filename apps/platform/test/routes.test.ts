import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ApiError, Evaluation, ImportSystemResponse, ModelBundle, PacketResponse, PromoteResponse, RealizationResponse,
  StartWorkResponse, SubmitResponse, SystemsResponse, HistoryResponse, WorkResponse, ReadinessResponse,
} from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import type { HookRunner, SubmissionContext } from "../worker/hooks/contract";
import { resetHooks, setHooks } from "../worker/hooks/index";
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
function setup() {
  const ns = new FakeArtifacts();
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
const passing: HookRunner = {
  async runSubmission(ctx) {
    seen.push(ctx);
    return ctx.requiredCriteria.map((criterion): Evaluation => ({
      id: "", candidate: ctx.candidate.id, criterion, hook: `hook:${criterion}`, execution: "completed", verdict: "pass",
      observations: { trigger: ctx.trigger }, verifier: "artyfact-platform", at: new Date().toISOString(),
    }));
  },
  async runGenome() { return { readiness: null, review: [], evaluations: [] }; },
  async conflicts(ctx) {
    return ctx.candidate && ctx.openCandidates.length > 1
      ? [{ kind: "soft-semantic", candidates: ctx.openCandidates.map((c) => c.id), subjects: ["screen.people"], message: "both touch screen.people" }]
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

async function imported() {
  const s = setup();
  const systemId = uniqueSystem(s.ns, s.genomeRepo);
  const res = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, genomeRepo: s.genomeRepo, appRepo: s.appRepo });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return { ...s, systemId, imp: res.json };
}

describe("routes: import → model → start → submit → promote", () => {
  it("runs the happy path", async () => {
    const { ns, systemId, appRepo, imp } = await imported();
    expect(imp.evolutions).toEqual(["evolution.1", "evolution.2"]);

    const list = await call<SystemsResponse>("GET", "/systems");
    expect(list.json.systems.some((s) => s.systemId === systemId)).toBe(true);

    const model = await call<ModelBundle>("GET", `/systems/${systemId}/model`);
    expect(model.status).toBe(200);
    expect(model.json.genomeCommit).toBe(imp.genomeCommit);
    expect(model.json.model.index.byId["screen.people"]).toEqual({ id: "screen.people", type: "node", kind: "screen", name: "People" });
    expect(model.json.model.index.paths["screen.people"]).toEqual([systemId, "thing.webapp", "section.ui", "screen.people"]);
    expect(model.json.readiness.modelReadiness).toBeDefined();
    const rd = await call<ReadinessResponse>("GET", `/systems/${systemId}/readiness?rev=${imp.head}`);
    expect(rd.json.rules.packs.map((p) => p.id)).toEqual(["metamodel"]);

    const start = await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, { agentLabel: "claude" });
    expect(start.status, JSON.stringify(start.json)).toBe(201);
    const rid = start.json.realization.id;
    expect(rid).toBe("realization.1.r1");
    expect(start.json.realization.workspace.fork).toBe(`${appRepo}--r1`);
    expect(start.json.remote).toBe(`https://test-account.artifacts.cloudflare.net/git/artyfact/${appRepo}--r1.git`);
    expect(start.json.token.value).toMatch(/^secret-/);
    expect(start.json.packet.permittedPaths.sort()).toEqual(["src/ui/**", "src/ui/people/**"]);
    expect(start.json.packet.commands).toEqual(["npm install", "npm run dev", "npm test"]);
    expect(ns.repo(`${appRepo}--r1`).tokens).toEqual([{ id: expect.any(String), scope: "write", ttl: 21600 }]);

    // The packet route never re-issues the token.
    const pk = await call<PacketResponse>("GET", `/systems/${systemId}/evolutions/evolution.1/realizations/${rid}/packet`);
    expect(pk.json.packet.hash).toBe(start.json.packet.hash);
    expect(JSON.stringify(pk.json)).not.toContain(start.json.token.value);
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
    expect(sub.json.evaluations.map((e) => e.criterion).sort()).toEqual(["C.people.list", "C.system.promotion", "C.webapp.exists"]);
    expect(sub.json.realization.status).toBe("evaluated");
    expect(seen[0].acceptanceCriteria.map((c) => c.id)).toEqual(["C.people.list", "C.people.later"]);
    expect(await seen[0].listFiles()).toContain("src/ui/people/list.ts");
    expect(await seen[0].fileSize("src/ui/people/list.ts")).toBe(22);

    // Same commit again: one candidate.
    const again = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${rid}/submit`, { commit });
    expect(again.status).toBe(200);
    expect(again.json.created).toBe(false);
    expect(again.json.candidate.id).toBe(sub.json.candidate.id);

    const view = await call<RealizationResponse>("GET", `/systems/${systemId}/evolutions/evolution.1/realizations/${rid}`);
    expect(view.json.realization.checkpoints).toHaveLength(1);
    expect(view.json.evaluations).toHaveLength(3);

    // Promotion requires the admin token.
    const body = { candidateIds: [sub.json.candidate.id], expectedHead: imp.head, rationale: "looks right" };
    expect((await call<ApiError>("POST", `/systems/${systemId}/promote`, body)).status).toBe(401);
    const promoted = await call<PromoteResponse>("POST", `/systems/${systemId}/promote`, body, ADMIN);
    expect(promoted.status, JSON.stringify(promoted.json)).toBe(200);
    expect(promoted.json.commit.parent).toBe(imp.head);
    expect(promoted.json.commit.manifest.artifacts["artifact.webapp"]).toEqual({ repo: `${appRepo}--r1`, commit });
    expect(seen.some((c) => c.trigger === "promotion")).toBe(true);

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
    const conflicts = await call<{ conflicts: unknown[] }>("GET", `/systems/${systemId}/conflicts`);
    expect(conflicts.status).toBe(200);
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

  it("blocks promotion when required criteria are not pass+completed", async () => {
    const { ns, systemId, appRepo, imp } = await imported();
    setHooks({ runner: () => ({ ...passing, async runSubmission(ctx) {
      return [{ id: "", candidate: ctx.candidate.id, criterion: "C.people.list", hook: "hook.people.list", execution: "not-run", verdict: "unknown", observations: null, verifier: "artyfact-platform", at: new Date().toISOString() }];
    } }) });
    const a = (await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, {})).json;
    const c = ns.repo(`${appRepo}--r1`).commit({ ...appFiles, "src/ui/people/a.ts": "a" });
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${a.realization.id}/submit`, { commit: c });
    const res = await call<ApiError>("POST", `/systems/${systemId}/promote`, { candidates: [sub.json.candidate.id], expectedHead: imp.head, rationale: "" }, ADMIN);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("blocked");
    const crits = (res.json.error.details as { blocking: { criterion: string }[] }).blocking.map((b) => b.criterion).sort();
    expect(crits).toEqual(["C.people.list", "C.system.promotion", "C.webapp.exists"]);
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
    expect((await call<ApiError>("POST", `/systems/import`, { systemId: "x" })).status).toBe(400);
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
    const body = { realizationId: start.json.realization.id, interpretation: "ok" };
    expect((await call<ApiError>("POST", `/systems/${systemId}/evolutions/evolution.2/accept`, body)).status).toBe(401);
    const acc = await call<{ genomeCommit: string }>("POST", `/systems/${systemId}/evolutions/evolution.2/accept`, body, ADMIN);
    expect(acc.status, JSON.stringify(acc.json)).toBe(200);
    expect(acc.json.genomeCommit).toBe(commit);
    const model = await call<ModelBundle>("GET", `/systems/${systemId}/model`);
    expect(model.json.genomeCommit).toBe(commit);
    expect(model.json.model.index.byId["entity.ContactRecord"].name).toBe("Contact record v2");
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
