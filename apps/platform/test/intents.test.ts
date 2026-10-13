/// <reference types="vite/client" />
/**
 * Intents end to end on Keep in Touch (fake System One and translator): create → question → reply → accept, with the
 * accepted ops committed to a Genome realization's fork and submitted as a candidate. The Genome repo holds the v1
 * example beside its v2 conversion, so today's model loader (import, start work, submit) and the tree codec both read it.
 */
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeSystemOne, fakeTranslator, scriptedSystemOne } from "@artyfact/ontology";
import { routes, type ApiError, type ImportSystemResponse, type IntentAcceptResponse, type Proposal } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { walkTree } from "../worker/artifacts/genome-source";
import { REGISTRY, type SystemAuthority } from "../worker/do/system-authority";
import { setEditorTransport } from "../worker/editor";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { intentProviders, proposedOps, setIntentProviders } from "../worker/intents";
import { createEvolution, startWork, systemStub } from "../worker/service";
import { FakeArtifacts } from "./helpers/fake-artifacts";
import { fakeReceivePack } from "./helpers/fake-receive-pack";
import { ADMIN, passing } from "./helpers/flows";

const raw = (g: Record<string, string>, root: string) =>
  Object.fromEntries(Object.entries(g).map(([p, t]) => [p.slice(p.indexOf(root) + root.length), t] as const));
const v1 = raw(import.meta.glob("../../../examples/keep-in-touch-system/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>, "keep-in-touch-system/");
const v2 = raw(import.meta.glob("../../../packages/ontology/test/fixtures/genome-v2/keep-in-touch/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>, "keep-in-touch/");
const app = raw(import.meta.glob(["../../../examples/keep-in-touch-app/**/*", "!**/node_modules/**", "!**/.wrangler/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>, "keep-in-touch-app/");

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
  const files = Object.fromEntries(Object.entries({ ...v1, ...v2 }).map(([p, t]) => [p, t.replaceAll("system.keep-in-touch", systemId)]));
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
  setHooks({ runner: () => passing });
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

  // submit derives a Genome candidate's changedNodes from the model diff, and today's loader reads the v1 half of this
  // fixture, so the candidate shows no changed subjects yet. W4's v2 loader makes them the touched nodes.
  it.todo("records the touched nodes as the candidate's changed subjects (needs the v2 model loader, W4)");

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
    expect(work.evolutions.filter((e) => e.title === p.message)).toEqual([]);
    expect(work.realizations.filter((r) => r.agent.id === "human:intent")).toEqual([]);

    setEditorTransport({ fetch: fakeReceivePack(s.ns).fetch });
    expect((await accept(s, p, ["op.1"])).status).toBe(201);
    expect((await systemStub(env, s.systemId).proposal(p.id))?.proposal.status).toBe("accepted");
    const after = await systemStub(env, s.systemId).work();
    expect(after.evolutions.filter((e) => e.title === p.message).map((e) => e.state)).toEqual(["evaluated"]);
    expect(after.realizations.filter((r) => r.agent.id === "human:intent")).toHaveLength(1);
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
  ];
  it.each(cases)("%s %s is admin only", async (method, path, body) => {
    expect((await call<ApiError>(method, path, body, {})).status).toBe(401);
    expect((await call<ApiError>(method, path, body, { authorization: "Bearer nope" })).status).toBe(403);
  });
  it.each(cases)("%s %s is 404 for a System that is not imported", async (method, path, body) => {
    expect((await call<ApiError>(method, path, body)).status).toBe(404);
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
