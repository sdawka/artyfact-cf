/// <reference types="vite/client" />
/**
 * Intents end to end on Peopling (fake System One and translator): create → question → reply → accept, with the
 * accepted ops committed to a Genome realization's fork and submitted as a candidate. The Genome repo holds the example's
 * v2 node tree, which the model loader (import, start work, submit) and the tree codec both read.
 */
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeSystemOne, fakeTranslator, parseTree, scriptedSystemOne } from "@artyfact/ontology";
import { routes, type ApiError, type ImportSystemResponse, type IntentAcceptResponse, type IntentDecisionsRequest, type Proposal, type ProposalDecisions, type ProposalPlanNode, type ProposedOp } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { walkTree } from "../worker/artifacts/genome-source";
import { REGISTRY, type SystemAuthority } from "../worker/do/system-authority";
import { CLAIM_LEASE_MS, ProposalsStore } from "../worker/do/proposals-store";
import { setEditorTransport } from "../worker/editor";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { applyDecisions, effectiveDecisions, genomeGraph, intentProviders, MAX_TURNS, opsByDecision, planOf, proposedOps, setIntentProviders } from "../worker/intents";
import { loadGenome, validate } from "@artyfact/model";
import { metaTemplates } from "@artyfact/templates";
import { createRealizationPlan as createPlan, startLifecycleTask } from '../worker/lifecycle-service';
import { createEvolution, startWork, systemStub } from "../worker/service";
import { createHookRunner } from "../worker/hooks/run";
import { createSystemOne } from "@artyfact/semantic";
import { FakeArtifacts } from "./helpers/fake-artifacts";
import { fakeReceivePack } from "./helpers/fake-receive-pack";
import { ADMIN, passing } from "./helpers/flows";

const raw = (g: Record<string, string>, root: string) =>
  Object.fromEntries(Object.entries(g).map(([p, t]) => [p.slice(p.indexOf(root) + root.length), t] as const));
const genome = raw(import.meta.glob("../../../examples/peopling-system/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>, "peopling-system/");
const app = raw(import.meta.glob(["../../../examples/peopling-app/**/*", "!**/node_modules/**", "!**/.wrangler/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>, "peopling-app/");

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = ADMIN) {
  const res = await exports.default.fetch(new Request(`http://example.com${path}`, {
    method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }),
  }));
  return { status: res.status, json: (await res.json()) as T };
}

interface Sys { ns: FakeArtifacts; systemId: string; genomeCommit: string }

let n = 0;
async function importSystem(): Promise<Sys> {
  const ns = new FakeArtifacts();
  const tag = `${++n}${Math.random().toString(36).slice(2, 6)}`;
  const systemId = `system.intent${tag}`;
  const files = Object.fromEntries(Object.entries(genome).map(([p, t]) => [p, t.replaceAll("system.peopling", systemId)]));
  ns.create(`intent-genome-${tag}`).commit(files, "genome");
  ns.create(`intent-app-${tag}`).commit(app, "app");
  setArtifactsOverride(ns);
  setEditorTransport({ fetch: fakeReceivePack(ns).fetch });
  const imp = await call<ImportSystemResponse>("POST", "/api/systems/import", { systemId, genomeRepo: `intent-genome-${tag}`, appRepo: `intent-app-${tag}` });
  expect(imp.status, JSON.stringify(imp.json)).toBe(201);
  return { ns, systemId, genomeCommit: imp.json.genomeCommit };
}

const create = (s: Sys, message: string, anchor?: string) => call<Proposal>("POST", routes.intents(s.systemId), { message, ...(anchor && { anchor }) });

beforeEach(() => {
  setHooks({ runner: () => ({...passing,async runGenome(ctx){const out=await passing.runGenome(ctx);const exemplar=out.evaluations[0]!;return {...out,evaluations:[...out.evaluations,...(ctx.evolution?.acceptanceCriteria??[]).filter(c=>!out.evaluations.some(e=>e.criterion===c)).map(c=>({...exemplar,id:`${ctx.candidate.id}:${c}`,criterion:c,hook:`hook:${c}`,verdict:'pass' as const,execution:'completed' as const,targetRef:ctx.candidate.commit}))]};}}) });
  setIntentProviders({ s1: fakeSystemOne(), translator: fakeTranslator() });
});
afterEach(() => { setArtifactsOverride(undefined); setEditorTransport(undefined); resetHooks(); setIntentProviders(undefined); });

const accept = (s: Sys, p: Proposal, opIds: string[]) => call<IntentAcceptResponse & ApiError>("POST", routes.intentAccept(s.systemId, p.id), { opIds });
/** Every file of the Genome repo (or a fork) at `commit`. */
const filesAt = async (s: Sys, repo: string, commit: string) => walkTree(s.ns.repo(repo), commit);

describe("POST /intents", () => {
  it("routes, translates and validates a message on the head Genome", async () => {
    const s = await importSystem();
    const r = await create(s, "Change what the Today screen says");
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const p = r.json;
    expect(p).toMatchObject({ id: "proposal.1", systemId: s.systemId, message: "Change what the Today screen says", status: "open", questions: [], problems: [] });
    expect(p.route[0]).toEqual({ level: "shortlist", choice: "screen.today", confidence: 0.95 });
    expect(p.route.map((x) => x.level)).toContain("intent");
    expect(p.ops).toEqual([{ id: "op.1", op: "update", node: "screen.today", fields: { description: expect.stringContaining("[fake]") } }]);
    expect(p.provenance).toEqual({
      router: { provider: "fake", model: "fake", calls: expect.any(Number) }, translator: { provider: "fake", model: "fake" },
      genomeCommit: s.genomeCommit, fake: true,
    });
    expect((await call<Proposal>("GET", routes.intent(s.systemId, p.id))).json).toEqual(p);
    expect(p.evolutionId).toBeTruthy();
    expect(await systemStub(env,s.systemId).evolution(p.evolutionId!)).toMatchObject({kind:'genome-amendment'});
  });

  it("mints the id of an added node, splits its links into dependent ops and reports the findings it introduces", async () => {
    const s = await importSystem();
    const p = (await create(s, "Add a screen for quiet hours #s1:route.intent=add")).json;
    const node = "screen.fake-Add-a-screen-for-quiet-hours-s1-route.intent-add";
    expect(p.ops).toEqual([
      { id: "op.1", op: "add", node, kind: "screen", fields: { name: expect.stringContaining("[fake] Add a screen") } },
      { id: "op.2", op: "link", node, link: { rel: "contains", to: "J.connect/s1" }, dependsOn: ["op.1"] },
    ]);
    expect(p.problems).toContainEqual({ opId: "op.1", severity: "missing", message: `Screen ${node} enumerates no components.` });
    expect(p.problems.every((x) => x.severity !== "error")).toBe(true);
  });

  it("routes from the anchor, and refuses an unknown anchor or an empty message", async () => {
    const s = await importSystem();
    const r = await create(s, "Make it calmer", "screen.today");
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.anchor).toBe("screen.today");
    expect(r.json.ops[0]).toMatchObject({ op: "update", node: "screen.today" });
    expect((await create(s, "Make it calmer", "screen.nope")).status).toBe(400);
    expect((await create(s, "  ")).status).toBe(400);
  });

  it("asks the router's question when no provider is configured, and never calls one", async () => {
    setIntentProviders(undefined); // the test env: FAKE_S1 and every key empty
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    expect(p.ops).toEqual([]);
    expect(p.questions).toEqual([{ id: "q.1", text: expect.stringMatching(/\?$/) }]);
    expect(p.provenance).toMatchObject({ router: { provider: "off", model: "off" }, translator: { provider: "off", model: "off" }, fake: false });
  });
});

describe("POST /intents/:pid/reply", () => {
  it("revises a proposal that asked a question with the answer appended", async () => {
    // The router reads the intent as "too vague" until the conversation carries an answer.
    setIntentProviders({
      s1: scriptedSystemOne({ "route.intent": (state) => (JSON.stringify(state).includes("A: ") ? "update" : "question") }),
      translator: fakeTranslator(),
    });
    const s = await importSystem();
    const asked = (await create(s, "Change what the Today screen says")).json;
    expect(asked.ops).toEqual([]);
    expect(asked.questions).toEqual([{ id: "q.1", text: expect.stringContaining("[fake] Which part should change") }]);
    expect(asked.route.find((x) => x.level === "intent")?.choice).toBe("question");

    const r = await call<Proposal>("POST", routes.intentReply(s.systemId, asked.id), { answer: "The Today screen's summary line", questionId: "q.1" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ id: asked.id, status: "open", message: asked.message, questions: [] });
    expect(r.json.route.find((x) => x.level === "intent")?.choice).toBe("update");
    expect(r.json.ops).toEqual([{ id: "op.1", op: "update", node: "screen.today", fields: { description: expect.stringContaining("A: The Today screen's summary line") } }]);
    expect((await call<Proposal>("GET", routes.intent(s.systemId, asked.id))).json).toEqual(r.json);

    expect((await call<ApiError>("POST", routes.intentReply(s.systemId, asked.id), { answer: "x", questionId: "q.9" })).status).toBe(400);
    expect((await call<ApiError>("POST", routes.intentReply(s.systemId, "proposal.9"), { answer: "x" })).status).toBe(404);
  });
});

describe("POST /intents/:pid/reply, turn cap", () => {
  const setTurns = (s: Sys, pid: string, k: number) => runInDurableObject(env.SYSTEMS.getByName(s.systemId), async (_i: SystemAuthority, st) => {
    st.storage.sql.exec("UPDATE proposals SET turns_json = ? WHERE id = ?", JSON.stringify(Array.from({ length: k }, (_, i) => ({ answer: `a${i}` }))), pid);
  });
  const reply = (s: Sys, pid: string, answer: string) => call<Proposal & ApiError>("POST", routes.intentReply(s.systemId, pid), { answer });

  it(`refuses a reply beyond ${MAX_TURNS} turns with a 422`, async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    await setTurns(s, p.id, MAX_TURNS - 1);
    expect((await reply(s, p.id, "the last one")).status).toBe(200);
    expect((await systemStub(env, s.systemId).proposal(p.id))?.turns).toHaveLength(MAX_TURNS);
    const r = await reply(s, p.id, "one more");
    expect(r.status).toBe(422);
    expect(r.json.error).toMatchObject({ code: "too-many-turns", message: `proposal ${p.id} already has ${MAX_TURNS} replies; describe the change again as a new intent` });
  });

  it("lets only one of two concurrent replies at the cap's last turn append", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    await setTurns(s, p.id, MAX_TURNS - 1);
    const both = await Promise.all([reply(s, p.id, "first"), reply(s, p.id, "second")]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(both.find((r) => r.status === 422)!.json.error.code).toBe("too-many-turns");
    const turns = (await systemStub(env, s.systemId).proposal(p.id))!.turns;
    expect(turns).toHaveLength(MAX_TURNS);
    expect(["first", "second"]).toContain(turns.at(-1)!.answer);
  });

  it("refuses a reply that would overwrite one that landed meanwhile", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    const stub = systemStub(env, s.systemId);
    expect(await stub.reviseProposal(p, [{ answer: "a" }])).toEqual({ revised: p });
    expect(await stub.reviseProposal(p, [{ answer: "b" }])).toEqual({ refused: "changed" });
    expect((await stub.proposal(p.id))!.turns).toEqual([{ answer: "a" }]);
  });
});

describe("POST /intents/:pid/accept", () => {
  it("commits the chosen ops to a Genome realization and submits the candidate on a new Evolution", async () => {
    const s = await importSystem();
    const p = (await create(s, "Add a screen for quiet hours #s1:route.intent=add")).json;
    const node = p.ops[0]!.node;

    const missing = await accept(s, p, ["op.2"]);
    expect(missing.status).toBe(422);
    expect(missing.json.error).toMatchObject({ code: "missing-dependency", message: expect.stringContaining("op.2 needs op.1") });
    expect((await accept(s, p, ["op.7"])).status).toBe(400);

    const r = await accept(s, p, ["op.1", "op.2"]);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const { evolution, realization, candidate, commit } = r.json;
    expect((await systemStub(env,s.systemId).state())!.genomeCommit).toBe(commit);
    expect(r.json.systemCommit?.genomeCommit).toBe(commit);
    expect(evolution).toMatchObject({
      title: p.message, intent: p.message, kind: "genome-amendment", affectedNodes: [node], realizations: [realization.id],
      acceptanceCriteria: expect.arrayContaining(["C.system.structure"]),
    });
    expect(realization).toMatchObject({ evolution: evolution.id, target: "genome", origin: "editor", agent: { id: "human:intent" }, candidate: candidate.id });
    expect(candidate).toMatchObject({ evolution: evolution.id, commit, changedPaths: [`${node}/node.yaml`], genomeChanges: [`${node}/node.yaml`] });

    const before = await filesAt(s, realization.workspace.repo, s.genomeCommit);
    const after = await filesAt(s, realization.workspace.fork, commit);
    expect([...after.keys()].filter((k) => !before.has(k))).toEqual([`${node}/node.yaml`]);
    expect(after.get(`${node}/node.yaml`)).toBe(`id: ${node}\nkind: screen\nfields:\n  name: "${p.ops[0]!.fields!.name}"\nlinks:\n  - { rel: contains, to: J.connect/s1 }\n`);
    for (const [k, v] of before) if (k !== `${node}/node.yaml`) expect(after.get(k), k).toBe(v);

    expect((await call<Proposal>("GET", routes.intent(s.systemId, p.id))).json.status).toBe("accepted");
    const again = await accept(s, p, ["op.1", "op.2"]);
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("invalid-state");
    expect((await call<ApiError>("POST", routes.intentReply(s.systemId, p.id), { answer: "x" })).status).toBe(409);
  });

  it("permits an added node's directory, so the submission hooks pass the System's scope gate", async () => {
    setHooks({ runner: () => createHookRunner({ s1: createSystemOne({}), fetch: (async () => { throw new Error("no fetch expected"); }) as unknown as typeof fetch, previewEnv: {} }) });
    const s = await importSystem();
    const p = (await create(s, "Add a screen for quiet hours #s1:route.intent=add")).json;
    const node = p.ops[0]!.node!;
    const r = await accept(s, p, ["op.1", "op.2"]);
    expect(r.status,JSON.stringify(r.json)).toBe(409);
    const staged=(await systemStub(env,s.systemId).proposal(p.id))!.proposal.stagedApproval!;
    expect(staged).toBeTruthy();
    const rec = await systemStub(env, s.systemId).realization(staged.realizationId);
    expect(rec?.packet?.permittedPaths).toContain(`${node}/**`);
    const evs = await systemStub(env, s.systemId).evaluations(staged.candidateId);
    const gate = evs.filter((e) => e.criterion === "C.system.promotion");
    expect(gate.length, JSON.stringify(evs.map((e) => [e.criterion, e.hook, e.verdict]))).toBeGreaterThan(0);
    for (const e of gate) expect(e.verdict, `${e.hook}: ${JSON.stringify(e)}`).not.toBe("fail");
    expect(gate).toEqual([expect.objectContaining({ hook: "hook.system.promotion", execution: "completed", interpretation: expect.stringContaining("scope-authorized: pass") })]);
  });

  it("updates a node in place, keeping the rest of its file", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    const r = await accept(s, p, ["op.1"]);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.evolution.affectedNodes).toEqual(["screen.today"]);
    const path = r.json.candidate.changedPaths[0]!;
    expect(path).toMatch(/(^|\/)screen\.today\/node\.yaml$/);
    const before = (await filesAt(s, r.json.realization.workspace.repo, s.genomeCommit)).get(path)!;
    const after = (await filesAt(s, r.json.realization.workspace.fork, r.json.commit)).get(path)!;
    expect(after).toContain(`description: "${p.ops[0]!.fields!.description}"`);
    expect(after.split("\n").filter((l) => !l.includes("description:"))).toEqual(before.split("\n").filter((l) => !l.includes("description:")));
  });

  it("records the touched nodes as the candidate's changed subjects", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    const r = await accept(s, p, ["op.1"]);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.candidate.changedSubjects).toEqual(["screen.today"]);
  });

  it("plans implementation of the accepted Genome with touched nodes source scope",async()=>{
    const s=await importSystem(),p=(await create(s,'Change what the People screen says')).json,r=await accept(s,p,['op.1']);expect(r.status,JSON.stringify(r.json)).toBe(201);
    const plan=await createPlan(env,s.systemId,{title:'Implement People',tasks:[{id:'people',title:'People',artifactId:'artifact.webapp',steps:['Implement'],dependsOn:[],readNodes:[],writeNodes:['screen.people'],checks:[]}]});
    const started=await startLifecycleTask(env,s.systemId,plan.id,'people',{},'http://x');
    expect(started.packet.permittedGlobs.sort()).toEqual(['public/people/**','public/people/add-contact-dialog.js','src/ui/**']);
    expect(started.plan.genome.commit).toBe(r.json.commit);
  });

  it("lets only one of two concurrent accepts push", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    const both = await Promise.all([accept(s, p, ["op.1"]), accept(s, p, ["op.1"])]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(both.find((r) => r.status === 409)!.json.error.code).toBe("invalid-state");
    expect((await systemStub(env, s.systemId).work()).evolutions.filter((e) => e.kind === "genome-amendment" && e.title === p.message)).toHaveLength(1);
    expect((await call<Proposal>("GET", routes.intent(s.systemId, p.id))).json.status).toBe("accepted");
  });

  it("returns the proposal to open with the error recorded when the push fails", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    setEditorTransport({ fetch: (async () => new Response("down", { status: 503 })) as unknown as typeof fetch });
    const failed = await accept(s, p, ["op.1"]);
    expect(failed.status).toBeGreaterThanOrEqual(500);
    const stored = await systemStub(env, s.systemId).proposal(p.id);
    expect(stored).toMatchObject({ proposal: { status: "open" }, accepting: false, acceptError: expect.any(String) });
    // The failed attempt leaves no Evolution and no realization behind.
    const work = await systemStub(env, s.systemId).work();
    expect(work.evolutions.filter((e) => e.title === p.message)).toHaveLength(1);
    expect(work.realizations.filter((r) => r.agent.id === "human:intent")).toEqual([expect.objectContaining({status:"rejected"})]);

    setEditorTransport({ fetch: fakeReceivePack(s.ns).fetch });
    expect((await accept(s, p, ["op.1"])).status).toBe(201);
    expect((await systemStub(env, s.systemId).proposal(p.id))?.proposal.status).toBe("accepted");
    const after = await systemStub(env, s.systemId).work();
    expect(after.evolutions.filter((e) => e.title === p.message).map((e) => e.state)).toEqual(["promoted"]);
    expect(after.realizations.filter((r) => r.agent.id === "human:intent")).toHaveLength(2);
  });

  /** Runs `around` in place of the DO method `name` (on the prototype, which RPC dispatches through) until `restore()`. */
  async function patchDo(s: Sys, name: "claimProposal" | "finishProposal", around: (orig: (...a: unknown[]) => unknown, self: SystemAuthority, ...a: unknown[]) => unknown) {
    let restore = () => {};
    await runInDurableObject(env.SYSTEMS.getByName(s.systemId), async (i: SystemAuthority) => {
      const proto = Object.getPrototypeOf(i) as Record<string, unknown>;
      const orig = proto[name] as (...a: unknown[]) => unknown;
      proto[name] = function (this: SystemAuthority, ...a: unknown[]) { return around((...b) => orig.apply(this, b), this, ...a); };
      restore = () => { proto[name] = orig; };
    });
    return () => restore();
  }

  it("applies the ops of the revision it claimed when a reply lands between the read and the claim", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    expect(p.ops).toEqual([expect.objectContaining({ id: "op.1", node: "screen.today" })]);
    // A reply revises the proposal just before the claim: op.1 now updates screen.people, and op.2 no longer exists.
    const revised: Proposal = { ...p, ops: [{ id: "op.1", op: "update", node: "screen.people", fields: { description: "Revised by the reply" } }] };
    const restore = await patchDo(s, "claimProposal", (orig, self, ...a) => {
      (self as unknown as { reviseProposal(p: Proposal, t: unknown[]): unknown }).reviseProposal(revised, [{ answer: "the People screen" }]);
      return orig(...a);
    });
    try {
      const gone = await accept(s, p, ["op.2"]);
      expect(gone.status).toBe(400);
      expect(await systemStub(env, s.systemId).proposal(p.id)).toMatchObject({ proposal: { status: "open" }, accepting: false });
      expect((await systemStub(env, s.systemId).proposal(p.id))?.acceptError).toBeUndefined();

      const r = await accept(s, p, ["op.1"]);
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(r.json.evolution.affectedNodes).toEqual(["screen.people"]);
      const path = r.json.candidate.changedPaths[0]!;
      expect(path).toMatch(/(^|\/)screen\.people\/node\.yaml$/);
      expect((await filesAt(s, r.json.realization.workspace.fork, r.json.commit)).get(path)).toContain("description: Revised by the reply");
      expect((await systemStub(env, s.systemId).proposal(p.id))?.proposal).toMatchObject({ status: "accepted", ops: revised.ops });
    } finally {
      restore();
    }
  });

  it("marks the proposal accepted with the error when recording fails after the push, so a retry cannot push twice", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    let calls = 0;
    const restore = await patchDo(s, "finishProposal", (orig, _self, ...a) => {
      if (++calls === 1) throw new Error("DO hiccup");
      return orig(...a);
    });
    try {
      const r = await accept(s, p, ["op.1"]);
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(calls).toBe(2);
      expect(await systemStub(env, s.systemId).proposal(p.id)).toMatchObject({
        proposal: { status: "accepted" }, accepting: false, acceptError: expect.stringContaining(`after ${r.json.commit} was pushed: `),
      });
      const again = await accept(s, p, ["op.1"]);
      expect(again.status).toBe(409);
      expect(again.json.error.code).toBe("invalid-state");
      expect((await systemStub(env, s.systemId).work()).evolutions.filter((e) => e.title === p.message)).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("never lets an accept whose claim was taken over reopen or finish the row", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    await runInDurableObject(env.SYSTEMS.getByName(s.systemId), async (_i: SystemAuthority, st) => {
      const store = new ProposalsStore(st.storage.sql);
      const t0 = Date.parse("2026-10-13T10:00:00Z");
      const original = store.claim(p.id, s.genomeCommit, t0);
      const taker = store.claim(p.id, s.genomeCommit, t0 + CLAIM_LEASE_MS + 1);
      if (!("claimed" in original) || !("claimed" in taker)) throw new Error("both claims should win in turn");
      expect(taker.claimedAt).not.toBe(original.claimedAt);
      const ids = { evolution: "evolution.9", realization: "realization.9.r1", candidate: "cand.9", commit: "c".repeat(40) };
      expect(store.release(p.id, original.claimedAt, "the original failed late")).toBe(false);
      expect(store.get(p.id)).toMatchObject({ accepting: true });
      expect(store.get(p.id)?.acceptError).toBeUndefined();
      expect(store.finish(p.id, original.claimedAt, ids)).toBeNull();
      expect(store.get(p.id)).toMatchObject({ accepting: true, proposal: { status: "open" } });
      expect(store.finish(p.id, taker.claimedAt, ids)).toMatchObject({ id: p.id, status: "accepted" });
      expect(store.get(p.id)).toMatchObject({ accepting: false, proposal: { status: "accepted" } });
      expect(store.release(p.id, taker.claimedAt, "too late")).toBe(false);
    });
  });

  it("lets exactly one of two concurrent claims win, on an open row and on a lapsed one", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    const stub = systemStub(env, s.systemId);
    const both = await Promise.all([stub.claimProposal(p.id), stub.claimProposal(p.id)]);
    expect(both.filter((c) => "claimed" in c)).toHaveLength(1);
    expect(both.find((c) => "refused" in c)).toEqual({ refused: "invalid-state", status: "accepting" });
    await runInDurableObject(env.SYSTEMS.getByName(s.systemId), async (_i: SystemAuthority, st) => {
      st.storage.sql.exec("UPDATE proposals SET claimed_at = ? WHERE id = ?", new Date(Date.now() - CLAIM_LEASE_MS - 1000).toISOString(), p.id);
    });
    const again = await Promise.all([stub.claimProposal(p.id), stub.claimProposal(p.id)]);
    expect(again.filter((c) => "claimed" in c)).toHaveLength(1);
    expect(again.find((c) => "refused" in c)).toEqual({ refused: "invalid-state", status: "accepting" });
  });

  it("lets a new accept take over a claim older than the lease, never a fresh one", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    await runInDurableObject(env.SYSTEMS.getByName(s.systemId), async (_i: SystemAuthority, st) => {
      const store = new ProposalsStore(st.storage.sql);
      const t0 = Date.parse("2026-10-13T10:00:00Z");
      expect(store.claim(p.id, s.genomeCommit, t0)).toMatchObject({ claimed: { id: p.id } });
      expect(store.claim(p.id, s.genomeCommit, t0 + CLAIM_LEASE_MS)).toEqual({ refused: "invalid-state", status: "accepting" });
      // Lapsed but the head moved: the claim is released, and the accept is stale.
      expect(store.claim(p.id, "f".repeat(40), t0 + CLAIM_LEASE_MS + 1)).toEqual({ refused: "stale-base", currentHead: "f".repeat(40) });
      expect(store.get(p.id)).toMatchObject({ accepting: false, acceptError: expect.stringContaining("stopped") });
      expect(store.claim(p.id, s.genomeCommit, t0)).toMatchObject({ claimed: { id: p.id } });
      expect(store.claim(p.id, s.genomeCommit, t0 + CLAIM_LEASE_MS + 1)).toMatchObject({ claimed: { id: p.id } });
      // Back-date the claim as if its isolate died long ago.
      st.storage.sql.exec("UPDATE proposals SET claimed_at = ? WHERE id = ?", new Date(Date.now() - CLAIM_LEASE_MS - 1000).toISOString(), p.id);
    });
    const r = await accept(s, p, ["op.1"]);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect((await systemStub(env, s.systemId).proposal(p.id))?.proposal.status).toBe("accepted");
  });

  it("never discards an Evolution that is part of the System's history", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    const { evolution, realization, candidate } = (await accept(s, p, ["op.1"])).json;
    const sql = (q: string, ...args: string[]) => runInDurableObject(env.SYSTEMS.getByName(s.systemId), async (_i: SystemAuthority, st) => { st.storage.sql.exec(q, ...args); });
    const refused = async () => {
      await runInDurableObject(env.SYSTEMS.getByName(s.systemId), async (i: SystemAuthority) => {
        expect(() => i.discardEvolution(evolution.id)).toThrow(/^\[invalid-state\]/);
      });
      expect(await systemStub(env, s.systemId).evolution(evolution.id)).not.toBeNull();
      expect(await systemStub(env, s.systemId).candidate(candidate.id)).not.toBeNull();
    };
    await sql("UPDATE realizations SET status = 'promoted' WHERE id = ?", realization.id);
    await refused();
    await sql("UPDATE realizations SET status = 'evaluated' WHERE id = ?", realization.id);
    await sql("UPDATE candidates SET state = 'promoted' WHERE id = ?", candidate.id);
    await refused();
    await sql("UPDATE candidates SET state = 'evaluated' WHERE id = ?", candidate.id);
    await sql("INSERT INTO system_commits (id, parent, manifest_json, manifest_hash, evolution_ids, decision_json, created_at) VALUES ('sc-x', NULL, '{}', 'h', ?, '{}', 'now')",
      JSON.stringify([evolution.id]));
    await refused();
  });

  it("is a 409 stale-base once the head Genome moved", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    await runInDurableObject(env.SYSTEMS.getByName(s.systemId), async (_i: SystemAuthority, state) => {
      state.storage.sql.exec("UPDATE head SET v = ? WHERE k = 'genome_commit'", "f".repeat(40));
    });
    const before = await systemStub(env, s.systemId).work();
    const r = await accept(s, p, ["op.1"]);
    expect(r.status).toBe(409);
    expect(r.json.error).toMatchObject({ code: "stale-base", details: { currentHead: "f".repeat(40) } });
    expect(await systemStub(env, s.systemId).work()).toEqual(before);
    expect((await systemStub(env, s.systemId).proposal(p.id))?.proposal.status).toBe("open");
  });

  it("refuses a fork once the head moved after the claim, and discards the Evolution", async () => {
    const s = await importSystem();
    const stub = systemStub(env, s.systemId);
    const { evolution } = await createEvolution(env, s.systemId, { title: "t", intent: "i", kind: "genome-amendment" });
    await runInDurableObject(env.SYSTEMS.getByName(s.systemId), async (i: SystemAuthority) => {
      const seq = (i as unknown as { kv(k: string): string | null }).kv("realization_seq");
      expect(() => i.reserveRealization({ evolutionId: evolution.id, target: "genome", expectedBase: "f".repeat(40) })).toThrow(/^\[stale-base\]/);
      expect((i as unknown as { kv(k: string): string | null }).kv("realization_seq")).toBe(seq);
      expect(i.realizations(evolution.id)).toEqual([]);
    });
    const started = await startWork(env, s.systemId, evolution.id, { target: "genome" }, "http://x", { expectedBase: "f".repeat(40) }).catch((e: unknown) => e);
    expect(started).toMatchObject({ status: 409, code: "stale-base" });
    expect(await stub.discardEvolution(evolution.id)).toEqual([]);
    expect(await stub.evolution(evolution.id)).toBeNull();
  });
});

describe("intent routes", () => {
  const S = "system.intents-auth";
  beforeAll(async () => {
    // Registered (reads of unknown ids stop before the DO) but never imported.
    await runInDurableObject(env.SYSTEMS.getByName(REGISTRY), async (i: SystemAuthority) => {
      i.registerSystem({ systemId: S, title: "intents", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "0".repeat(40), evolutionCounts: {}, updatedAt: "" });
    });
  });
  const cases: [string, string, unknown][] = [
    ["POST", routes.intents(S), { message: "m" }],
    ["GET", routes.intent(S, "proposal.1"), undefined],
    ["POST", routes.intentReply(S, "proposal.1"), { answer: "a" }],
    ["POST", routes.intentAccept(S, "proposal.1"), { opIds: ["op.1"] }],
    ["PUT", routes.intentDecisions(S, "proposal.1"), { decisions: [{ nodeId: "thing.webapp", decision: "agree" }] }],
  ];
  it.each(cases)("%s %s is admin only", async (method, path, body) => {
    expect((await call<ApiError>(method, path, body, {})).status).toBe(401);
    expect((await call<ApiError>(method, path, body, { authorization: "Bearer nope" })).status).toBe(403);
  });
  it.each(cases)("%s %s is 404 for a System that is not imported", async (method, path, body) => {
    expect((await call<ApiError>(method, path, body)).status).toBe(404);
  });
});

describe("the head Genome intents judge against", () => {
  it("is platform readiness: the same loader, composed template and pinned packs, so the same findings", () => {
    const files = new Map(Object.entries(genome));
    const key = (f: { rule: string; subject?: string; level: string }) => `${f.level} ${f.rule} ${f.subject ?? ""}`;
    const ours = genomeGraph(files).readiness.findings.map(key).sort();
    expect(ours).toEqual(validate(loadGenome(files, { templates: metaTemplates })).findings.map(key).sort());
    expect(ours.length).toBeGreaterThan(0);
  });
});

describe("intent providers and ops", () => {
  it("come from the env: fakes under FAKE_S1=1, off without keys", () => {
    setIntentProviders(undefined);
    const fake = intentProviders({ FAKE_S1: "1" } as unknown as Env);
    expect([fake.s1.mode, fake.translator.mode]).toEqual(["fake", "fake"]);
    const off = intentProviders({ FAKE_S1: "" } as unknown as Env);
    expect([off.s1.mode, off.translator.mode]).toEqual(["off", "off"]);
  });

  it("map an add's `from` link to a link op on the other end, and number every op", () => {
    const graph = { template: "t", declarations: [], evidence: [], nodes: [{ id: "a", kind: "screen", fields: {} }], links: [] };
    const template = { kinds: { screen: { fields: [{ name: "title" }] } } } as unknown as Parameters<typeof proposedOps>[2];
    const { ops, first } = proposedOps([
      { op: "remove", id: "a" },
      { op: "add", kind: "screen", title: "A", description: "d", fields: { route: "/a" }, links: [{ rel: "navigatesTo", from: "a" }] },
      { op: "unlink", from: "a", rel: "r", to: "b" },
    ], graph, template);
    expect(ops).toEqual([
      { id: "op.1", op: "remove", node: "a" },
      { id: "op.2", op: "add", node: "screen.A", kind: "screen", fields: { route: "/a", title: "A", description: "d" } },
      { id: "op.3", op: "link", node: "a", link: { rel: "navigatesTo", to: "screen.A" }, dependsOn: ["op.2"] },
      { id: "op.4", op: "unlink", node: "a", link: { rel: "r", to: "b" } },
    ]);
    expect(first).toEqual(["op.1", "op.2", "op.4"]);
  });
});

// ------------------------------------------------------------------ plan, decisions and deferral

const peopling = (systemId = "system.peopling") => new Map(Object.entries(genome).map(([k, v]) => [k, v.replaceAll("system.peopling", systemId)] as const));
const tree = (systemId?: string) => parseTree(peopling(systemId));
const strip = (plan: ProposalPlanNode[]): unknown[] => plan.map((n) => ({ id: n.id, opIds: n.opIds, summary: n.summary, children: strip(n.children) }));
const decide = (s: Sys, p: Proposal, decisions: IntentDecisionsRequest["decisions"]) =>
  call<Proposal & ApiError>("PUT", routes.intentDecisions(s.systemId, p.id), { decisions });
const ADD = "Add a screen for quiet hours #s1:route.intent=add";
const TWO_OPS = (first: Proposal): ProposedOp[] => [first.ops[0]!, { id: "op.2", op: "update", node: "screen.people", fields: { description: "[fake] calmer" } }];

/** A proposal on the System's base holding `ops` (and its plan), linked to `first`'s Evolution, as the DO stores one. */
async function storeProposal(s: Sys, first: Proposal, ops: ProposedOp[], extra: Partial<Proposal> = {}): Promise<Proposal> {
  const { id: _id, plan: _plan, ...rest } = first;
  return systemStub(env, s.systemId).createProposal({ ...rest, ops, plan: planOf(ops, tree(s.systemId)), ...extra });
}
const sqlOn = (s: Sys, q: string, ...args: string[]) =>
  runInDurableObject(env.SYSTEMS.getByName(s.systemId), async (_i: SystemAuthority, st) => { st.storage.sql.exec(q, ...args); });

describe("proposal plan", () => {
  it("roots an update at its Thing, with inclusive containment paths from the head tree", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    expect(p.plan).toEqual([{
      id: "thing.webapp", kind: "thing", title: "Peopling web app", path: [s.systemId, "thing.webapp"], summary: "1 update", opIds: [],
      children: [{
        id: "section.ui", kind: "section", title: expect.any(String), path: [s.systemId, "thing.webapp", "section.ui"], summary: "1 update", opIds: [],
        children: [{ id: "screen.today", kind: "screen", title: "Today", path: [s.systemId, "thing.webapp", "section.ui", "screen.today"], summary: "1 update", opIds: ["op.1"], children: [] }],
      }],
    }]);
    expect((await call<Proposal>("GET", routes.intent(s.systemId, p.id))).json.plan).toEqual(p.plan);
  });

  it("places an add without a parent under the System root, with its proposed title and kind and its links on it", async () => {
    const s = await importSystem();
    const p = (await create(s, ADD)).json;
    const node = p.ops[0]!.node;
    expect(p.ops.map((o) => o.op)).toEqual(["add", "link"]);
    expect(p.plan).toEqual([{
      id: s.systemId, kind: "system", title: expect.any(String), path: [s.systemId], summary: "1 add · 1 link", opIds: [],
      children: [{ id: node, kind: "screen", title: p.ops[0]!.fields!.name, path: [s.systemId, node], summary: "1 add · 1 link", opIds: ["op.1", "op.2"], children: [] }],
    }]);
  });

  it("puts a remove on its node, a link on its from node, an add under its parent and unknown nodes under Other changes", () => {
    const ops: ProposedOp[] = [
      { id: "op.1", op: "remove", node: "component.TodayHeading" },
      { id: "op.2", op: "link", node: "screen.people", link: { rel: "uses", to: "GD.contacts" } },
      { id: "op.3", op: "add", node: "component.New", kind: "component", parent: "screen.people", fields: { name: "New" } },
      { id: "op.4", op: "link", node: "component.New", link: { rel: "uses", to: "GD.contacts" }, dependsOn: ["op.3"] },
      { id: "op.5", op: "update", node: "screen.gone" },
      { id: "op.6", op: "update", node: "GD.goals" },
    ];
    const plan = planOf(ops, tree());
    expect(strip(plan)).toEqual([
      { id: "thing.webapp", opIds: [], summary: "1 add · 1 remove · 2 link", children: [{ id: "section.ui", opIds: [], summary: "1 add · 1 remove · 2 link", children: [
        { id: "screen.today", opIds: [], summary: "1 remove", children: [{ id: "component.TodayHeading", opIds: ["op.1"], summary: "1 remove", children: [] }] },
        { id: "screen.people", opIds: ["op.2"], summary: "1 add · 2 link", children: [{ id: "component.New", opIds: ["op.3", "op.4"], summary: "1 add · 1 link", children: [] }] },
      ] }] },
      { id: "system.peopling", opIds: [], summary: "1 update", children: [{ id: "GD.goals", opIds: ["op.6"], summary: "1 update", children: [] }] },
      { id: "other", opIds: ["op.5"], summary: "1 update", children: [] },
    ]);
    expect(plan[1]).toMatchObject({ path: ["system.peopling"] });
    expect(plan[2]).toMatchObject({ kind: "other", title: "Other changes", path: [] });
    expect(plan[0]!.children[0]!.children[1]!.children[0]).toMatchObject({ kind: "component", title: "New", path: ["system.peopling", "thing.webapp", "section.ui", "screen.people", "component.New"] });
    const all = (n: ProposalPlanNode[]): string[] => n.flatMap((x) => [...x.opIds, ...all(x.children)]);
    expect(all(plan).sort()).toEqual(ops.map((o) => o.id).sort());
  });

  it("is rebuilt on reply", async () => {
    setIntentProviders({
      s1: scriptedSystemOne({ "route.intent": (state) => (JSON.stringify(state).includes("A: ") ? "update" : "question") }),
      translator: fakeTranslator(),
    });
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    expect(p.plan).toEqual([]);
    const r = await call<Proposal>("POST", routes.intentReply(s.systemId, p.id), { answer: "The Today screen", questionId: "q.1" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.plan.map((n) => n.id)).toEqual(["thing.webapp"]);
    expect((await systemStub(env, s.systemId).proposalPlan(p.id))?.plan).toEqual(r.json.plan);
  });

  it("reads a proposal stored before plans as an empty plan, and accepts any op ids as before", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    const legacy = await runInDurableObject(env.SYSTEMS.getByName(s.systemId), async (_i: SystemAuthority, state): Promise<Proposal> => {
      const { id: _id, plan: _plan, ...rest } = p;
      return new ProposalsStore(state.storage.sql).create(rest as Omit<Proposal, "id">);
    });
    expect("plan" in legacy).toBe(false);
    const got = await call<Proposal>("GET", routes.intent(s.systemId, legacy.id));
    expect(got.status).toBe(200);
    expect(got.json.plan).toEqual([]);
    const r = await accept(s, got.json, ["op.1"]);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.deferred).toBeUndefined();
  });
});

describe("decision rules", () => {
  const plan = planOf([
    { id: "op.1", op: "update", node: "screen.today" },
    { id: "op.2", op: "update", node: "component.TodayHeading" },
    { id: "op.3", op: "update", node: "screen.people" },
  ], tree());
  it("a parent decision clears its descendants' explicit decisions; null clears the node's own; an unknown node is a 404", () => {
    let d = applyDecisions(plan, {}, [{ nodeId: "screen.today", decision: "reject" }, { nodeId: "component.TodayHeading", decision: "defer" }]);
    expect(d).toEqual({ "screen.today": "reject", "component.TodayHeading": "defer" });
    d = applyDecisions(plan, d, [{ nodeId: "thing.webapp", decision: "agree" }]);
    expect(d).toEqual({ "thing.webapp": "agree" });
    expect(applyDecisions(plan, d, [{ nodeId: "thing.webapp", decision: null }])).toEqual({});
    expect(() => applyDecisions(plan, d, [{ nodeId: "screen.nope", decision: "agree" }])).toThrow(/no node screen.nope/);
  });
  it("an explicit child decision overrides the inherited one; others inherit the nearest decided ancestor's", () => {
    const decisions: ProposalDecisions = { "thing.webapp": "agree", "screen.today": "defer", "component.TodayHeading": "reject" };
    const eff = effectiveDecisions(plan, decisions);
    expect([eff.get("section.ui"), eff.get("screen.people"), eff.get("screen.today"), eff.get("component.TodayHeading")]).toEqual(["agree", "agree", "defer", "reject"]);
    const by = opsByDecision(plan, decisions);
    expect([...by.agreed]).toEqual(["op.3"]);
    expect([...by.deferred]).toEqual(["op.1"]);
    expect([...by.rejected]).toEqual(["op.2"]);
    expect(by.deferredNodes).toEqual(["screen.today"]);
    expect(opsByDecision(plan, {}).agreed.size).toBe(0);
  });
});

describe("PUT /intents/:pid/decisions", () => {
  it("stores decisions, clearing descendants on a parent decision and the node's own on null", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    let r = await decide(s, p, [{ nodeId: "screen.today", decision: "reject" }]);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.plan[0]!.children[0]!.children[0]!.decision).toBe("reject");
    r = await decide(s, p, [{ nodeId: "thing.webapp", decision: "agree" }]);
    expect(r.json.plan[0]!.decision).toBe("agree");
    expect(r.json.plan[0]!.children[0]!.children[0]!.decision).toBeUndefined();
    expect((await call<Proposal>("GET", routes.intent(s.systemId, p.id))).json.plan[0]!.decision).toBe("agree");
    expect((await systemStub(env, s.systemId).proposalPlan(p.id))?.decisions).toEqual({ "thing.webapp": "agree" });
    r = await decide(s, p, [{ nodeId: "thing.webapp", decision: null }]);
    expect(r.json.plan[0]!.decision).toBeUndefined();
    expect((await systemStub(env, s.systemId).proposalPlan(p.id))?.decisions).toEqual({});
  });

  it("is 404 for a node the plan lacks, 400 for a malformed body, 409 once the proposal is not open", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    expect((await decide(s, p, [{ nodeId: "screen.nope", decision: "agree" }])).status).toBe(404);
    expect((await decide(s, p, [{ nodeId: "thing.webapp", decision: "maybe" as never }])).status).toBe(400);
    expect((await decide(s, p, [])).status).toBe(400);
    expect((await accept(s, p, ["op.1"])).status).toBe(201);
    const late = await decide(s, p, [{ nodeId: "thing.webapp", decision: "agree" }]);
    expect(late.status).toBe(409);
    expect(late.json.error.code).toBe("invalid-state");
  });

  it("restores the tree of a reply that lands between its read and its write", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    // The reply moves op.1 to screen.people and drops screen.today from the tree.
    const ops: ProposedOp[] = [{ id: "op.1", op: "update", node: "screen.people", fields: { description: "Revised by the reply" } }];
    const revised: Proposal = { ...p, ops, plan: planOf(ops, tree(s.systemId)) };
    let fired = false;
    let restore = () => {};
    await runInDurableObject(env.SYSTEMS.getByName(s.systemId), async (i: SystemAuthority) => {
      const proto = Object.getPrototypeOf(i) as Record<string, unknown>;
      const orig = proto.setProposalPlan as (...a: unknown[]) => unknown;
      proto.setProposalPlan = function (this: SystemAuthority, ...a: unknown[]) {
        if (!fired) { fired = true; this.reviseProposal(revised, [{ answer: "the People screen" }]); }
        return orig.apply(this, a);
      };
      restore = () => { proto.setProposalPlan = orig; };
    });
    try {
      const r = await decide(s, p, [{ nodeId: "thing.webapp", decision: "agree" }, { nodeId: "screen.today", decision: "defer" }]);
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.ops).toEqual(ops);
      expect(strip(r.json.plan)).toEqual(strip(revised.plan));
      expect(r.json.plan[0]!.decision).toBe("agree");
      const stored = await systemStub(env, s.systemId).proposalPlan(p.id);
      expect(strip(stored!.plan)).toEqual(strip(revised.plan));
      expect(stored!.decisions).toEqual({ "thing.webapp": "agree" });
    } finally {
      restore();
    }
  });
});

describe("decisions compare-and-set", () => {
  it("keeps both of two PUTs that interleave between read and write", async () => {
    const s = await importSystem();
    const first = (await create(s, "Change what the Today screen says")).json;
    const both = await storeProposal(s, first, TWO_OPS(first));
    let fired = false;
    let restore = () => {};
    await runInDurableObject(env.SYSTEMS.getByName(s.systemId), async (i: SystemAuthority) => {
      const proto = Object.getPrototypeOf(i) as Record<string, unknown>;
      const orig = proto.setProposalPlan as (...a: unknown[]) => unknown;
      proto.setProposalPlan = function (this: SystemAuthority, ...a: unknown[]) {
        // Another PUT's write lands after this PUT read the decisions.
        if (!fired) { fired = true; orig.call(this, a[0], a[1], { "screen.people": "defer" }); }
        return orig.apply(this, a);
      };
      restore = () => { proto.setProposalPlan = orig; };
    });
    try {
      const r = await decide(s, both, [{ nodeId: "screen.today", decision: "agree" }]);
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect((await systemStub(env, s.systemId).proposalPlan(both.id))?.decisions).toEqual({ "screen.people": "defer", "screen.today": "agree" });
    } finally {
      restore();
    }
  });

  it("keeps both of two concurrent PUTs on different nodes", async () => {
    const s = await importSystem();
    const first = (await create(s, "Change what the Today screen says")).json;
    const both = await storeProposal(s, first, TWO_OPS(first));
    const rs = await Promise.all([decide(s, both, [{ nodeId: "screen.today", decision: "agree" }]), decide(s, both, [{ nodeId: "screen.people", decision: "defer" }])]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect((await systemStub(env, s.systemId).proposalPlan(both.id))?.decisions).toEqual({ "screen.today": "agree", "screen.people": "defer" });
  });

  it("refuses a store write whose expected decisions are stale", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    const stub = systemStub(env, s.systemId);
    expect(await stub.setProposalPlan(p.id, p.plan, { "thing.webapp": "agree" }, undefined, {})).toBe(true);
    expect(await stub.setProposalPlan(p.id, p.plan, { "thing.webapp": "reject" }, undefined, {})).toBe(false);
    expect((await stub.proposalPlan(p.id))?.decisions).toEqual({ "thing.webapp": "agree" });
  });
});

describe("a reply racing a staged accept", () => {
  it("never erases the staged approval", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    const approval = { evolutionId: "evolution.x", realizationId: "r.x", candidateId: "c.x", commit: "c".repeat(40), opIds: ["op.1"] };
    await sqlOn(s, "UPDATE proposals SET json = json_set(json, '$.stagedApproval', json(?)) WHERE id = ?", JSON.stringify(approval), p.id);
    const stub = systemStub(env, s.systemId);
    // The reply read the row before the staging: its revision carries no stagedApproval.
    expect(await stub.reviseProposal(p, [{ answer: "a" }])).toEqual({ refused: "staged" });
    expect((await stub.proposal(p.id))?.proposal.stagedApproval).toEqual(approval);
  });
});

describe("POST /intents/:pid/reply with decisions", () => {
  it("keeps decisions only on nodes the rebuilt plan still has", async () => {
    const s = await importSystem();
    const p = (await create(s, "Change what the Today screen says")).json;
    const stub = systemStub(env, s.systemId);
    expect(await stub.setProposalPlan(p.id, p.plan, { "thing.webapp": "agree", "screen.gone": "agree" })).toBe(true);
    const r = await call<Proposal>("POST", routes.intentReply(s.systemId, p.id), { answer: "Yes, the Today screen" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.plan[0]).toMatchObject({ id: "thing.webapp", decision: "agree" });
    expect((await stub.proposalPlan(p.id))?.decisions).toEqual({ "thing.webapp": "agree" });
  });
});

describe("POST /intents/:pid/accept with decisions", () => {
  it("accepts only ops under agreed nodes once any decision exists (422 invalid-ops)", async () => {
    const s = await importSystem();
    const first = (await create(s, "Change what the Today screen says")).json;
    const both = await storeProposal(s, first, TWO_OPS(first));
    await decide(s, both, [{ nodeId: "thing.webapp", decision: "agree" }, { nodeId: "screen.people", decision: "reject" }]);
    const r = await accept(s, both, ["op.1", "op.2"]);
    expect(r.status).toBe(422);
    expect(r.json.error).toMatchObject({ code: "invalid-ops", details: { offenders: ["op.2"] } });
    expect(await systemStub(env, s.systemId).proposal(both.id)).toMatchObject({ proposal: { status: "open" }, accepting: false });
    expect((await systemStub(env, s.systemId).proposal(both.id))?.acceptError).toBeUndefined();
    const ok = await accept(s, both, ["op.1"]);
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    expect(ok.json.evolution.affectedNodes).toEqual(["screen.today"]);
    expect(ok.json.deferred).toBeUndefined();
  });

  it("keeps the dependency rule under agreed nodes", async () => {
    const s = await importSystem();
    const p = (await create(s, ADD)).json;
    await decide(s, p, [{ nodeId: s.systemId, decision: "agree" }]);
    const r = await accept(s, p, ["op.2"]);
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("missing-dependency");
  });

  it("moves deferred ops to a new proposal with its own Evolution, accepted on the moved head", async () => {
    const s = await importSystem();
    const first = (await create(s, "Change what the Today screen says")).json;
    const both = await storeProposal(s, first, TWO_OPS(first));
    await decide(s, both, [{ nodeId: "thing.webapp", decision: "agree" }, { nodeId: "screen.people", decision: "defer" }]);
    const r = await accept(s, both, ["op.1"]);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.evolution.id).toBe(first.evolutionId);
    expect(r.json.evolution.affectedNodes).toEqual(["screen.today"]);
    expect(r.json.deferred).toEqual({ proposal: expect.stringMatching(/^proposal\.\d+$/), nodeIds: ["screen.people"] });
    const head = (await systemStub(env, s.systemId).state())!.genomeCommit;
    expect(head).toBe(r.json.commit);

    const next = (await call<Proposal>("GET", routes.intent(s.systemId, r.json.deferred!.proposal))).json;
    expect(next).toMatchObject({ status: "open", message: both.message, deferredFrom: both.id, ops: [TWO_OPS(first)[1]], questions: [] });
    expect(next.stagedApproval).toBeUndefined();
    expect(next.provenance.genomeCommit).toBe(s.genomeCommit);
    expect(strip(next.plan)).toEqual([{ id: "thing.webapp", opIds: [], summary: "1 update", children: [{ id: "section.ui", opIds: [], summary: "1 update",
      children: [{ id: "screen.people", opIds: ["op.2"], summary: "1 update", children: [] }] }] }]);
    expect(next.plan[0]!.decision).toBeUndefined();
    expect((await systemStub(env, s.systemId).proposalPlan(next.id))?.deferredFrom).toBe(both.id);
    expect(next.evolutionId).toBeTruthy();
    expect(next.evolutionId).not.toBe(first.evolutionId);
    expect(await systemStub(env, s.systemId).evolution(next.evolutionId!)).toMatchObject({ kind: "genome-amendment", title: both.message });
    expect((await call<Proposal>("GET", routes.intent(s.systemId, both.id))).json.status).toBe("accepted");

    // The approval moved the head past the deferred proposal's base: its ops still apply there, so it is rebased.
    const d = await accept(s, next, ["op.2"]);
    expect(d.status, JSON.stringify(d.json)).toBe(201);
    expect(d.json.evolution.id).toBe(next.evolutionId);
    expect(d.json.evolution.affectedNodes).toEqual(["screen.people"]);
    expect((await call<Proposal>("GET", routes.intent(s.systemId, next.id))).json).toMatchObject({ status: "accepted", provenance: { genomeCommit: head } });
    expect((await systemStub(env, s.systemId).state())!.genomeCommit).toBe(d.json.commit);
  });

  it("is a 409 stale-base when deferred ops no longer apply on the moved head, and leaves the proposal on its base", async () => {
    const s = await importSystem();
    const first = (await create(s, "Change what the Today screen says")).json;
    const ops: ProposedOp[] = [first.ops[0]!, { id: "op.2", op: "update", node: "component.TodayHeading", fields: { description: "[fake] bolder" } }];
    const both = await storeProposal(s, first, ops);
    await decide(s, both, [{ nodeId: "thing.webapp", decision: "agree" }, { nodeId: "component.TodayHeading", decision: "defer" }]);
    const r = await accept(s, both, ["op.1"]);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const next = (await call<Proposal>("GET", routes.intent(s.systemId, r.json.deferred!.proposal))).json;
    // A second proposal removes the node the deferred op updates, and lands first.
    const rm = await storeProposal(s, (await create(s, "Change what the Today screen says")).json, [{ id: "op.1", op: "remove", node: "component.TodayHeading" }],
      { provenance: { ...first.provenance, genomeCommit: r.json.commit } });
    const removed = await accept(s, rm, ["op.1"]);
    expect(removed.status, JSON.stringify(removed.json)).toBe(201);
    const head = removed.json.commit;

    const g = await accept(s, next, ["op.2"]);
    expect(g.status, JSON.stringify(g.json)).toBe(409);
    expect(g.json.error).toMatchObject({ code: "stale-base", details: { currentHead: head } });
    expect(await systemStub(env, s.systemId).proposal(next.id)).toMatchObject({ accepting: false, proposal: { status: "open", provenance: { genomeCommit: s.genomeCommit } } });
  });
});

describe("POST /intents/:pid/accept with blocked agreed ops", () => {
  // op.1 updates screen.today; op.2 adds a component under screen.people; op.3 links screen.today to it (needs op.2),
  // so op.3 sits under the agreed screen.today while its dependency sits under screen.people.
  const BLOCKED = (first: Proposal): ProposedOp[] => [
    first.ops[0]!,
    { id: "op.2", op: "add", node: "component.QuietHours", kind: "component", parent: "screen.people", fields: { name: "Quiet hours" } },
    { id: "op.3", op: "link", node: "screen.today", link: { rel: "contains", to: "component.QuietHours" }, dependsOn: ["op.2"] },
  ];

  it("moves an agreed op whose dependency is deferred to the deferred proposal, with that dependency", async () => {
    const s = await importSystem();
    const first = (await create(s, "Change what the Today screen says")).json;
    const both = await storeProposal(s, first, BLOCKED(first));
    await decide(s, both, [{ nodeId: "thing.webapp", decision: "agree" }, { nodeId: "screen.people", decision: "defer" }]);
    expect((await accept(s, both, ["op.1", "op.3"])).json.error).toMatchObject({ code: "missing-dependency" });
    const r = await accept(s, both, ["op.1"]);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.deferred).toEqual({ proposal: expect.any(String), nodeIds: ["screen.people"] });
    const next = (await call<Proposal>("GET", routes.intent(s.systemId, r.json.deferred!.proposal))).json;
    expect(next.ops).toEqual([BLOCKED(first)[1], BLOCKED(first)[2]]);
    const all = (n: ProposalPlanNode[]): string[] => n.flatMap((x) => [...x.opIds, ...all(x.children)]);
    expect(all(next.plan).sort()).toEqual(["op.2", "op.3"]);
  });

  it("drops an agreed op whose dependency is rejected, deferring nothing", async () => {
    const s = await importSystem();
    const first = (await create(s, "Change what the Today screen says")).json;
    const both = await storeProposal(s, first, BLOCKED(first));
    await decide(s, both, [{ nodeId: "thing.webapp", decision: "agree" }, { nodeId: "screen.people", decision: "reject" }]);
    const r = await accept(s, both, ["op.1"]);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.deferred).toBeUndefined();
    expect(r.json.evolution.affectedNodes).toEqual(["screen.today"]);
  });
});

describe("POST /intents/:pid/accept with a staged approval", () => {
  /** Stages a candidate the approval then refuses: the real runner fails the Genome gates for this add. */
  async function stagedAdd() {
    setHooks({ runner: () => createHookRunner({ s1: createSystemOne({}), fetch: (async () => { throw new Error("no fetch expected"); }) as unknown as typeof fetch, previewEnv: {} }) });
    const s = await importSystem();
    const p = (await create(s, ADD)).json;
    await decide(s, p, [{ nodeId: s.systemId, decision: "agree" }]);
    const r = await accept(s, p, ["op.1", "op.2"]);
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    const staged = (await systemStub(env, s.systemId).proposal(p.id))!.proposal.stagedApproval as NonNullable<Proposal["stagedApproval"]> & { decisions?: ProposalDecisions };
    expect(staged).toMatchObject({ opIds: ["op.1", "op.2"], decisions: { [s.systemId]: "agree" } });
    return { s, p, staged };
  }

  it("refuses a decisions PUT while a candidate is staged", async () => {
    const { s, p } = await stagedAdd();
    const r = await decide(s, p, [{ nodeId: s.systemId, decision: "reject" }]);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("invalid-state");
    expect((await systemStub(env, s.systemId).proposalPlan(p.id))?.decisions).toEqual({ [s.systemId]: "agree" });
  });

  it("refuses the accept when the decisions changed since staging, and takes it again once they match", async () => {
    const { s, p, staged } = await stagedAdd();
    const stub = systemStub(env, s.systemId);
    const node = p.ops[0]!.node;
    // A decisions write that raced the staging.
    expect(await stub.setProposalPlan(p.id, p.plan, { [s.systemId]: "agree", [node]: "agree" })).toBe(true);
    const r = await accept(s, p, ["op.1", "op.2"]);
    expect(r.status).toBe(409);
    expect(r.json.error).toMatchObject({ code: "invalid-state", message: expect.stringContaining("decisions changed") });
    expect(await stub.proposal(p.id)).toMatchObject({ accepting: false, proposal: { status: "open", stagedApproval: { candidateId: staged.candidateId } } });

    expect(await stub.setProposalPlan(p.id, p.plan, { [s.systemId]: "agree" })).toBe(true);
    const again = await accept(s, p, ["op.1", "op.2"]);
    // Past the decisions check: the approval itself is what the real runner refuses again.
    expect(again.json.error?.message ?? "").not.toContain("decisions changed");
  });

  it("is a 409 stale-base for a deferred proposal with a staged candidate once the head moved", async () => {
    const s = await importSystem();
    const first = (await create(s, "Change what the Today screen says")).json;
    const both = await storeProposal(s, first, TWO_OPS(first));
    await decide(s, both, [{ nodeId: "thing.webapp", decision: "agree" }, { nodeId: "screen.people", decision: "defer" }]);
    const r = await accept(s, both, ["op.1"]);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const next = r.json.deferred!.proposal;
    await sqlOn(s, "UPDATE proposals SET json = json_set(json, '$.stagedApproval', json(?)) WHERE id = ?",
      JSON.stringify({ evolutionId: "evolution.x", realizationId: "r.x", candidateId: "c.x", commit: "c".repeat(40), opIds: ["op.2"], decisions: {} }), next);
    const g = await accept(s, (await call<Proposal>("GET", routes.intent(s.systemId, next))).json, ["op.2"]);
    expect(g.status, JSON.stringify(g.json)).toBe(409);
    expect(g.json.error).toMatchObject({ code: "stale-base", message: expect.stringContaining("candidate was staged"), details: { currentHead: r.json.commit } });
    expect((await systemStub(env, s.systemId).proposal(next))?.proposal.provenance.genomeCommit).toBe(s.genomeCommit);
  });
});
