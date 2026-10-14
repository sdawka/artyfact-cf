/**
 * System import review (backend.md B.10, lifecycle.md contract addendum): pending by default, the 409 guard on every
 * route that creates or starts work, accept by compare-and-set, and rejected nodes removed by an amendment that the
 * intents accept commits and approves at once.
 */
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ApiError, GenomeCandidateReview, ImportSystemResponse, ModelBundle, ProposalPlanNode, StartWorkResponse,
  SystemImportReview, SystemImportReviewAcceptResponse, SystemsResponse, WorkResponse,
} from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { walkTree } from "../worker/artifacts/genome-source";
import type { SystemAuthority } from "../worker/do/system-authority";
import { setEditorTransport } from "../worker/editor";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { systemStub } from "../worker/service";
import { appFiles, genomeFor } from "./fixtures/genome";
import { FakeArtifacts } from "./helpers/fake-artifacts";
import { fakeReceivePack } from "./helpers/fake-receive-pack";
import { ADMIN, call, passing } from "./helpers/flows";

let seq = 0;

beforeEach(() => {
  // Genome candidates pass every criterion the gate asks for, including the amendment's own acceptance criteria.
  setHooks({
    runner: () => ({
      ...passing,
      async runGenome(ctx) {
        const out = await passing.runGenome(ctx);
        const exemplar = out.evaluations[0]!;
        const extra = (ctx.evolution?.acceptanceCriteria ?? []).filter((c) => !out.evaluations.some((e) => e.criterion === c))
          .map((c) => ({ ...exemplar, id: `${ctx.candidate.id}:${c}`, criterion: c, hook: `hook:${c}`, verdict: "pass" as const, execution: "completed" as const, targetRef: ctx.candidate.commit }));
        return { ...out, evaluations: [...out.evaluations, ...extra] };
      },
    }),
  });
});
afterEach(() => { setArtifactsOverride(undefined); setEditorTransport(undefined); resetHooks(); });

/** An import that leaves its review pending (the default) unless `review` says otherwise. */
async function pending(review?: boolean, extra: Record<string, string> = {}) {
  const ns = new FakeArtifacts();
  const n = ++seq;
  const systemId = `system.importreview${n}`;
  const genomeRepo = `ir-genome-${n}`, appRepo = `ir-app-${n}`;
  // A surviving component links to one the review may reject: the amendment must drop that link.
  const dialog = "thing.webapp/section.ui/screen.people/component.AddContactDialog/node.yaml";
  const g = genomeFor(systemId);
  ns.create(genomeRepo).commit({ ...g, [dialog]: `${g[dialog]}links:\n  - { rel: shows, to: component.ErrorSummary }\n`, ...extra }, "genome");
  // Two app paths no node's files map; the platform's own directory never counts.
  ns.create(appRepo).commit({ ...appFiles, "docs/notes.md": "notes", "src/legacy/old.ts": "old", ".artyfact/init.json": "{}" }, "app");
  setArtifactsOverride(ns);
  setEditorTransport({ fetch: fakeReceivePack(ns).fetch });
  const res = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, genomeRepo, appRepo, ...(review !== undefined && { review }) }, ADMIN);
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return { ns, systemId, genomeRepo, appRepo, imp: res.json };
}

const ids = (ns: ProposalPlanNode[]): string[] => ns.flatMap((n) => [n.id, ...ids(n.children ?? [])]);
const accept = (systemId: string, body: unknown, headers: Record<string, string> = ADMIN) =>
  call<SystemImportReviewAcceptResponse & ApiError>("POST", `/systems/${systemId}/import-review/accept`, body, headers);
const getReview = (systemId: string) => call<SystemImportReview & ApiError>("GET", `/systems/${systemId}/import-review`);

/** The routes this slice guards (lifecycle routes are wired by the integration slice). */
const guarded = (systemId: string) => Promise.all([
  call<ApiError>("POST", `/systems/${systemId}/evolutions`, { title: "t", intent: "i", kind: "genome-amendment" }, ADMIN),
  call<ApiError>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, { agentLabel: "a" }, ADMIN),
  call<ApiError>("POST", `/systems/${systemId}/intents`, { message: "add a screen" }, ADMIN),
  call<ApiError>("POST", `/systems/${systemId}/template-upgrade`, { ref: "head" }, ADMIN),
]);

/** Every file of the amendment's candidate, read from the fork that holds it. */
async function candidateFiles(ns: FakeArtifacts, systemId: string, realization: string, candidate: string): Promise<Map<string, string>> {
  const rec = await systemStub(env, systemId).realization(realization);
  const cand = await systemStub(env, systemId).candidate(candidate);
  expect(rec?.forkRepo, "fork").toBeTruthy();
  expect(cand, "candidate").toBeTruthy();
  return walkTree(ns.repo(rec!.forkRepo), cand!.commit);
}

describe("import review: pending, guard, opt-out", () => {
  it("a first import is pending by default: summary, signifier, registry, tree rooted at the Things, unmapped app paths, and the 409 guard", async () => {
    const { systemId, imp } = await pending();
    expect(imp.system.importReview).toEqual({ status: "pending", genomeCommit: imp.genomeCommit, nodes: expect.any(Number) });
    expect(imp.system.signifiers).toContain("import-pending");
    const listed = (await call<SystemsResponse>("GET", "/systems")).json.systems.find((x) => x.systemId === systemId)!;
    expect(listed.importReview?.status).toBe("pending");
    expect(listed.signifiers).toContain("import-pending");

    const rv = await getReview(systemId);
    expect(rv.status, JSON.stringify(rv.json)).toBe(200);
    expect(rv.json.status).toBe("pending");
    expect(rv.json.genomeCommit).toBe(imp.genomeCommit);
    expect(rv.json.tree.map((n) => n.id)).toEqual(["thing.webapp"]);
    expect(rv.json.tree[0]!.children!.map((n) => n.id)).toEqual(expect.arrayContaining(["section.ui", "section.domain"]));
    const all = ids(rv.json.tree);
    expect(all).toContain("entity.ContactRecord");
    expect(all).toContain("screen.people");
    expect(all).not.toContain(systemId);
    expect(imp.system.importReview!.nodes).toBe(all.length);
    expect(rv.json.tree[0]).toMatchObject({ kind: "thing", path: [systemId, "thing.webapp"], opIds: [] });
    expect(Array.isArray(rv.json.findings)).toBe(true);
    // The scaffold is mapped by the template's defaults and the nodes' files; only the extras are not.
    expect(rv.json.unmapped).toEqual(["docs/notes.md", "src/legacy/old.ts"]);

    for (const r of await guarded(systemId)) {
      expect(r.status, JSON.stringify(r.json)).toBe(409);
      expect(r.json.error.code).toBe("import-unreviewed");
      expect(r.json.error.message).toContain(`/s/${systemId}/r/head/review?panel=import`);
      expect(r.json.error.details).toEqual({ genomeCommit: imp.genomeCommit });
    }
    // No work was created by the refused calls.
    const work = (await call<WorkResponse>("GET", `/systems/${systemId}/evolutions`)).json;
    expect(work.realizations).toEqual([]);
    expect(work.evolutions.map((e) => e.id)).toEqual(imp.evolutions);
  });

  it("review: true is the same as the default; review: false leaves no review (404) and no guard", async () => {
    const explicit = await pending(true);
    expect(explicit.imp.system.importReview?.status).toBe("pending");

    const { systemId, imp } = await pending(false);
    expect(imp.system.importReview).toBeUndefined();
    expect(imp.system.signifiers).not.toContain("import-pending");
    expect((await getReview(systemId)).status).toBe(404);
    const start = await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, { agentLabel: "a" }, ADMIN);
    expect(start.status, JSON.stringify(start.json)).toBe(201);
    for (const r of await guarded(systemId)) expect(r.json.error?.code, JSON.stringify(r.json)).not.toBe("import-unreviewed");
    expect((await call<ApiError>("GET", `/systems/nope/import-review`)).status).toBe(404);
  });

  it("a forced re-import at a new Genome commit opens a new pending review; the same commits keep the accepted one; review: false clears a pending one", async () => {
    const { ns, systemId, genomeRepo, appRepo, imp } = await pending();
    expect((await accept(systemId, {})).status).toBe(200);
    const same = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, genomeRepo, appRepo }, ADMIN);
    expect(same.status, JSON.stringify(same.json)).toBe(201);
    expect(same.json.system.importReview?.status).toBe("accepted");

    const g = genomeFor(systemId);
    ns.repo(genomeRepo).commit({ ...g, "thing.webapp/section.ui/component.ErrorSummary/node.yaml": "id: component.ErrorSummary\nkind: component\nfields:\n  name: Errors\n" }, "edit");
    const forced = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, genomeRepo, appRepo, force: true }, ADMIN);
    expect(forced.status, JSON.stringify(forced.json)).toBe(201);
    expect(forced.json.genomeCommit).not.toBe(imp.genomeCommit);
    expect(forced.json.system.importReview).toEqual({ status: "pending", genomeCommit: forced.json.genomeCommit, nodes: expect.any(Number) });
    expect((await call<SystemsResponse>("GET", "/systems")).json.systems.find((x) => x.systemId === systemId)!.importReview?.status).toBe("pending");
    expect((await guarded(systemId)).map((r) => r.status)).toEqual([409, 409, 409, 409]);

    const cleared = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, genomeRepo, appRepo, review: false }, ADMIN);
    expect(cleared.status, JSON.stringify(cleared.json)).toBe(201);
    expect(cleared.json.system.importReview).toBeUndefined();
    expect((await getReview(systemId)).status).toBe(404);
  });
});

describe("import review: accept", () => {
  it("accept without rejections: accepted, no amendment, work opens; a second accept is 409 invalid-state", async () => {
    const { systemId, imp } = await pending();
    expect((await accept(systemId, {}, {})).status).toBe(401);
    const bad = await accept(systemId, { rejectedNodes: ["screen.nope"] });
    expect([bad.status, bad.json.error.code]).toEqual([400, "bad-request"]);
    expect((await accept(systemId, { rejectedNodes: "screen.people" })).status).toBe(400);
    expect((await accept(systemId, { interpretation: 7 })).status).toBe(400);

    const acc = await accept(systemId, { interpretation: " looks right " });
    expect(acc.status, JSON.stringify(acc.json)).toBe(200);
    expect(acc.json.review).toMatchObject({ status: "accepted", interpretation: "looks right", decidedAt: expect.any(String), genomeCommit: imp.genomeCommit });
    expect(acc.json.review.rejectedNodes).toBeUndefined();
    expect(acc.json.amendment).toBeUndefined();
    const listed = (await call<SystemsResponse>("GET", "/systems")).json.systems.find((x) => x.systemId === systemId)!;
    expect(listed.importReview?.status).toBe("accepted");
    expect(listed.signifiers).not.toContain("import-pending");
    expect((await getReview(systemId)).json.status).toBe("accepted");
    const start = await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, { agentLabel: "a" }, ADMIN);
    expect(start.status, JSON.stringify(start.json)).toBe(201);
    const again = await accept(systemId, {});
    expect([again.status, again.json.error.code]).toEqual([409, "invalid-state"]);
  });

  it("accept with rejectedNodes commits their removal at once; a covered child needs no op of its own; inbound links are dropped", async () => {
    const { ns, systemId, imp } = await pending();
    const rejected = ["component.ErrorSummary", "component.AppShell", "component.TopBar"];
    const acc = await accept(systemId, { rejectedNodes: rejected });
    expect(acc.status, JSON.stringify(acc.json)).toBe(200);
    expect(acc.json.review.status).toBe("accepted");
    expect(acc.json.review.rejectedNodes).toEqual(rejected);
    expect(acc.json.amendment).toEqual({ evolution: expect.any(String), realization: expect.any(String), candidate: expect.any(String), systemCommit: expect.any(String) });
    const { evolution, realization, candidate } = acc.json.amendment!;

    const work = (await call<WorkResponse>("GET", `/systems/${systemId}/evolutions`)).json;
    const evo = work.evolutions.find((e) => e.id === evolution)!;
    expect(evo.title).toBe("Import review: remove 2 nodes");
    expect(evo.kind).toBe("genome-amendment");
    expect(evo.affectedNodes).toEqual(expect.arrayContaining(["component.ErrorSummary", "component.AppShell", "component.AddContactDialog"]));
    // The intents accept approves: the amendment is promoted and the head Genome moved off the imported commit.
    const rz = await systemStub(env, systemId).realization(realization);
    expect(rz!.realization.target).toBe("genome");
    expect(rz!.realization.status).toBe("promoted");
    const head = (await call<ModelBundle>("GET", `/systems/${systemId}/model`)).json;
    expect(head.genomeCommit).not.toBe(imp.genomeCommit);

    const files = await candidateFiles(ns, systemId, realization, candidate);
    const paths = [...files.keys()];
    expect(paths.some((p) => p.includes("component.ErrorSummary"))).toBe(false);
    expect(paths.some((p) => p.includes("component.AppShell"))).toBe(false);
    expect(paths).toContain("thing.webapp/section.ui/node.yaml");
    for (const p of paths.filter((x) => x.endsWith("node.yaml"))) expect(files.get(p), p).not.toMatch(/component\.(ErrorSummary|AppShell|TopBar)/);
    expect(files.get("thing.webapp/section.ui/screen.people/component.AddContactDialog/node.yaml")).not.toContain("links:");
    const rv = await call<GenomeCandidateReview>("GET", `/systems/${systemId}/realizations/${realization}/review`, undefined, ADMIN);
    expect(rv.status, JSON.stringify(rv.json)).toBe(200);
    expect(rv.json.loadError).toBeUndefined();
    // Work is open now.
    const start = await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, { agentLabel: "a" }, ADMIN);
    expect(start.status, JSON.stringify(start.json)).toBe(201);
  });

  it("rejecting screen.people drops every reference to it (step link, refines link, criterion refines) and the candidate loads", async () => {
    const extra = "thing.webapp/section.ui/component.Extra/node.yaml";
    const { ns, systemId } = await pending(undefined, {
      [extra]: "id: component.Extra\nkind: component\nfields:\n  name: Extra\n  owningThing: thing.webapp\n  revision: 1\nlinks:\n  - { rel: refines, to: screen.people }\n"
        + "criteria:\n  - id: C.extra.list\n    claim: Extra narrows the list\n    refines: [C.people.list]\n",
    });
    const acc = await accept(systemId, { rejectedNodes: ["screen.people"] });
    expect(acc.status, JSON.stringify(acc.json)).toBe(200);
    const { realization, candidate } = acc.json.amendment!;
    const files = await candidateFiles(ns, systemId, realization, candidate);
    const paths = [...files.keys()];
    expect(paths.some((p) => p.includes("screen.people"))).toBe(false);
    for (const p of paths.filter((x) => x.endsWith("node.yaml"))) expect(files.get(p), p).not.toMatch(/screen\.people|component\.AddContactDialog|C\.people\./);
    expect(files.get("thing.webapp/J.add/s1/node.yaml")).not.toContain("links:");
    expect(files.get(extra)).toContain("C.extra.list");
    const rv = await call<GenomeCandidateReview>("GET", `/systems/${systemId}/realizations/${realization}/review`, undefined, ADMIN);
    expect(rv.status, JSON.stringify(rv.json)).toBe(200);
    expect(rv.json.loadError).toBeUndefined();
  });

  it("rejecting section.ui drops it from thing.webapp's sections; the amended Genome has no new hard violation", async () => {
    const { ns, systemId } = await pending();
    const acc = await accept(systemId, { rejectedNodes: ["section.ui"] });
    expect(acc.status, JSON.stringify(acc.json)).toBe(200);
    const { realization, candidate } = acc.json.amendment!;
    const files = await candidateFiles(ns, systemId, realization, candidate);
    const thing = files.get("thing.webapp/node.yaml")!;
    expect(thing).toContain("section.domain");
    expect(thing).not.toContain("section.ui");
    const rv = (await call<GenomeCandidateReview>("GET", `/systems/${systemId}/realizations/${realization}/review`, undefined, ADMIN)).json;
    expect(rv.loadError).toBeUndefined();
    const hard = (r: typeof rv.readinessBase) => r.findings.filter((f) => f.level === "error").map((f) => `${f.rule} ${f.subject}`);
    expect(hard(rv.readinessCandidate).filter((f) => !hard(rv.readinessBase).includes(f))).toEqual([]);
    expect(hard(rv.readinessCandidate).some((f) => f.startsWith("thing.sectionMissing"))).toBe(false);
  });

  it("a reference no op can drop (a template's required $self section) is 422 naming both nodes; the review stays pending", async () => {
    const { systemId } = await pending(undefined, {
      "thing.lib/node.yaml": "id: thing.lib\nkind: thing\ntemplate: template.thing.ts-library@1\nfields:\n  name: Lib\n  description: A library\n",
      "thing.lib/thing.lib.api/node.yaml": "id: thing.lib.api\nkind: section\nfields:\n  name: API\n  revision: 1\n",
    });
    const res = await accept(systemId, { rejectedNodes: ["thing.lib.api"] });
    expect(res.status, JSON.stringify(res.json)).toBe(422);
    expect(res.json.error.code).toBe("rejected-node-referenced");
    expect(res.json.error.message).toContain("thing.lib still references (requires) thing.lib.api");
    expect((await getReview(systemId)).json.status).toBe("pending");
    expect((await call<WorkResponse>("GET", `/systems/${systemId}/evolutions`)).json.realizations).toEqual([]);
  });

  it("the accept compare-and-set also matches the genomeCommit, so a re-import that raced it is not overwritten", async () => {
    const { systemId } = await pending();
    const review = (await getReview(systemId)).json;
    const won = await runInDurableObject(env.SYSTEMS.getByName(systemId), (i: SystemAuthority) =>
      i.casImportReview("pending", "0".repeat(40), { ...review, status: "accepted" }));
    expect(won).toBe(false);
    expect((await getReview(systemId)).json).toEqual(review);
  });

  it("two concurrent accepts: one wins, the other is 409 invalid-state, exactly one amendment", async () => {
    const { systemId, imp } = await pending();
    const results = await Promise.all([accept(systemId, { rejectedNodes: ["component.ErrorSummary"] }), accept(systemId, { rejectedNodes: ["component.ErrorSummary"] })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const lost = results.find((r) => r.status === 409)!;
    expect(lost.json.error.code).toBe("invalid-state");
    const won = results.find((r) => r.status === 200)!;
    expect(won.json.amendment).toBeDefined();
    const work = (await call<WorkResponse>("GET", `/systems/${systemId}/evolutions`)).json;
    expect(work.realizations.map((r) => r.id)).toEqual([won.json.amendment!.realization]);
    expect(work.evolutions.filter((e) => !imp.evolutions.includes(e.id)).map((e) => e.title)).toEqual(["Import review: remove 1 node"]);
  });

  it("an amendment the gate refuses rolls the review back to pending, and the guard holds again", async () => {
    const { systemId } = await pending();
    setHooks({
      runner: () => ({
        ...passing,
        async runGenome(ctx) {
          const out = await passing.runGenome(ctx);
          return { ...out, evaluations: out.evaluations.map((e) => ({ ...e, verdict: "fail" as const })) };
        },
      }),
    });
    const res = await accept(systemId, { rejectedNodes: ["component.ErrorSummary"] });
    expect([res.status, res.json.error.code], JSON.stringify(res.json)).toEqual([409, "blocked"]);
    expect((await getReview(systemId)).json.status).toBe("pending");
    const listed = (await call<SystemsResponse>("GET", "/systems")).json.systems.find((x) => x.systemId === systemId)!;
    expect(listed.importReview?.status).toBe("pending");
    expect((await guarded(systemId)).map((r) => r.status)).toEqual([409, 409, 409, 409]);
    // The pushed but unapproved removal is rejected, so nothing can land it behind the pending review.
    const work = (await call<WorkResponse>("GET", `/systems/${systemId}/evolutions`)).json;
    expect(work.realizations.map((r) => r.status)).toEqual(["rejected"]);
  });

  it("rejecting nodes after the Genome moved is 409 stale-base; the review stays pending", async () => {
    const { systemId, imp } = await pending();
    // The review describes an older commit than the head (as after an accepted amendment and a re-opened review).
    const review = (await getReview(systemId)).json;
    await runInDurableObject(env.SYSTEMS.getByName(systemId), (i: SystemAuthority) => i.setImportReview({ ...review, genomeCommit: "f".repeat(40) }));
    const res = await accept(systemId, { rejectedNodes: ["component.ErrorSummary"] });
    expect([res.status, res.json.error.code]).toEqual([409, "stale-base"]);
    expect((await getReview(systemId)).json.status).toBe("pending");
    expect(imp.genomeCommit).not.toBe("f".repeat(40));
  });
});
