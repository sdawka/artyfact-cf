import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Proposal, ProposalPlanNode, SseEnvelope, SystemImportReview } from "../shared/api";
import type { SystemAuthority } from "../worker/do/system-authority";
import { applySchema } from "../worker/do/schema";
import { planCounts } from "../worker/do/plan-summary";

const G = "1".repeat(40), G2 = "2".repeat(40), A = "a".repeat(40);
const boot = { systemId: "system.contracts", title: "Contracts", genomeRepo: "genome", appRepo: "web-repo", genomeCommit: G, appCommit: A,
  artifactId: "web", templateVersions: {}, hookVersions: {}, platform: null, evolutions: [] };
const inDo = <T>(fn: (i: SystemAuthority, state: DurableObjectState) => T | Promise<T>) =>
  runInDurableObject(env.SYSTEMS.getByName(crypto.randomUUID()), async (i: SystemAuthority, state) => { await i.bootstrap(boot); return fn(i, state); });

const node = (id: string, children: ProposalPlanNode[] = []): ProposalPlanNode =>
  ({ id, kind: "thing", title: id, path: [id], summary: "", opIds: [], children });
const review = (status: SystemImportReview["status"], genomeCommit = G): SystemImportReview =>
  ({ status, genomeCommit, tree: [node("thing.web", [node("screen.a"), node("screen.b")])], findings: [], unmapped: [] });
const proposalInput = (extra: Partial<Proposal> = {}) => ({
  systemId: boot.systemId, message: "Add a screen", status: "open" as const, route: [], ops: [], questions: [], problems: [],
  provenance: { router: { provider: "fake", model: "fake", calls: 0 }, translator: { provider: "fake", model: "fake" }, genomeCommit: G, fake: true },
  createdAt: "2026-10-13T00:00:00.000Z", ...extra,
});

/** Subscribes to the DO's SSE stream and returns a reader of event types (pings skipped). */
async function events(i: SystemAuthority): Promise<() => Promise<SseEnvelope>> {
  const res = await i.fetch(new Request("https://do/api/systems/x/events"));
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const queue: SseEnvelope[] = [];
  return async () => {
    for (;;) {
      const next = queue.shift();
      if (next) return next;
      const { value } = await reader.read();
      buf += dec.decode(value);
      const frames = buf.split("\n\n");
      buf = frames.pop()!;
      for (const f of frames) {
        const line = f.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const e = JSON.parse(line.slice(6)) as SseEnvelope;
        if (e.type !== "ping") queue.push(e);
      }
    }
  };
}

describe("import review delegation", () => {
  it("stores, summarises and clears the review, with events", async () => {
    await inDo(async (i) => {
      const next = await events(i);
      expect(i.importReview()).toBeNull();
      expect(i.summary()!.importReview).toBeUndefined();
      i.setImportReview(review("pending"));
      expect(await next()).toMatchObject({ type: "system.import-review", status: "pending" });
      expect(await next()).toMatchObject({ type: "system.updated" });
      const s = i.summary()!;
      expect(s.importReview).toEqual({ status: "pending", genomeCommit: G, nodes: 3 });
      expect(s.signifiers).toContain("import-pending");
      i.setImportReview(null);
      expect(await next()).toMatchObject({ type: "system.import-review", status: null });
      expect(await next()).toMatchObject({ type: "system.updated" });
      expect(i.importReview()).toBeNull();
      expect(i.summary()!.signifiers).not.toContain("import-pending");
    });
  });

  it("CAS flips pending to accepted once and emits only on success", async () => {
    await inDo(async (i) => {
      i.setImportReview(review("pending"));
      const next = await events(i);
      const accepted = { ...review("accepted"), decidedAt: "2026-10-13T01:00:00.000Z" };
      // Failed attempts carry a `pending` next, so an event from them would read `pending`, not `accepted`.
      expect(i.casImportReview("pending", G2, review("pending", G2))).toBe(false); // genome commit differs
      expect(i.casImportReview("accepted", G, review("pending"))).toBe(false); // status differs
      expect(i.importReview()!.status).toBe("pending");
      expect(i.casImportReview("pending", G, accepted)).toBe(true);
      expect(i.importReview()).toEqual(accepted);
      expect(i.casImportReview("pending", G, accepted)).toBe(false); // the loser of a concurrent accept
      // The first non-ping events are the success ones: the failed attempts emitted nothing.
      expect(await next()).toMatchObject({ type: "system.import-review", status: "accepted" });
      expect(await next()).toMatchObject({ type: "system.updated" });
      i.setImportReview(review("pending", G2));
      expect(await next()).toMatchObject({ type: "system.import-review", status: "pending" });
      const s = i.summary()!;
      expect(s.importReview).toMatchObject({ status: "pending", genomeCommit: G2 });
      // A re-import opened a new review: an accept computed against the old commit cannot overwrite it.
      expect(i.casImportReview("pending", G, accepted)).toBe(false);
      expect(i.importReview()!.genomeCommit).toBe(G2);
    });
  });

  it("CAS without a stored review is false", async () => {
    await inDo((i) => { expect(i.casImportReview("pending", G, review("accepted"))).toBe(false); expect(i.importReview()).toBeNull(); });
  });
});

describe("proposal plan delegation", () => {
  it("creates with an empty plan and writes tree and decisions only while open", async () => {
    await inDo((i) => {
      const p = i.createProposal(proposalInput());
      expect(p.plan).toEqual([]);
      expect(i.proposal(p.id)!.proposal.plan).toEqual([]);
      expect(i.proposalPlan(p.id)).toEqual({ plan: [], decisions: {} });
      const tree = [node("thing.web", [node("screen.a")])];
      expect(i.setProposalPlan(p.id, tree, { "screen.a": "defer" }, "proposal.0")).toBe(true);
      expect(i.proposalPlan(p.id)).toEqual({ plan: tree, decisions: { "screen.a": "defer" }, deferredFrom: "proposal.0" });
      expect(i.proposal(p.id)!.proposal).toMatchObject({ plan: tree, deferredFrom: "proposal.0" });
      // deferredFrom omitted keeps the stored one.
      expect(i.setProposalPlan(p.id, tree, { "thing.web": "agree" })).toBe(true);
      expect(i.proposalPlan(p.id)).toEqual({ plan: tree, decisions: { "thing.web": "agree" }, deferredFrom: "proposal.0" });

      const claim = i.claimProposal(p.id);
      if (!("claimed" in claim)) throw new Error(`not claimed: ${claim.refused}`);
      expect(claim.claimed.plan).toEqual(tree);
      expect(i.setProposalPlan(p.id, [], {})).toBe(false); // accepting
      expect(i.proposalPlan(p.id)!.decisions).toEqual({ "thing.web": "agree" });
      const done = i.finishProposal(p.id, claim.claimedAt, { evolution: "e", realization: "r", candidate: "c", commit: "x" });
      expect(done!.plan).toEqual(tree);
      expect(i.setProposalPlan(p.id, [], {})).toBe(false); // accepted
      expect(i.setProposalPlan("proposal.404", [], {})).toBe(false);
      expect(i.proposalPlan("proposal.404")).toBeNull();
    });
  });

  it("create stores the given plan and deferral source; a revision replaces the tree and keeps decisions", async () => {
    await inDo((i) => {
      const tree = [node("thing.web")];
      const p = i.createProposal(proposalInput({ plan: tree, deferredFrom: "proposal.7" }));
      expect(i.proposalPlan(p.id)).toEqual({ plan: tree, decisions: {}, deferredFrom: "proposal.7" });
      i.setProposalPlan(p.id, tree, { "thing.web": "reject" });
      const rebuilt = [node("thing.web", [node("screen.c")])];
      const out = i.reviseProposal({ ...p, plan: rebuilt }, [{ answer: "also c" }]);
      expect("revised" in out && out.revised.plan).toEqual(rebuilt);
      expect(i.proposalPlan(p.id)).toEqual({ plan: rebuilt, decisions: { "thing.web": "reject" }, deferredFrom: "proposal.7" });
    });
  });

  it("rebases only an open deferred proposal on its old base with no staged approval", async () => {
    await inDo((i) => {
      const plain = i.createProposal(proposalInput());
      expect(i.rebaseProposal(plain.id, G, G2)).toBe(false); // not deferred
      const d = i.createProposal(proposalInput({ deferredFrom: plain.id }));
      expect(i.rebaseProposal(d.id, G2, G)).toBe(false); // wrong old base
      expect(i.rebaseProposal(d.id, G, G2)).toBe(true);
      expect(i.proposal(d.id)!.proposal.provenance.genomeCommit).toBe(G2);
      expect(i.rebaseProposal(d.id, G, G2)).toBe(false); // already moved
      expect(i.rebaseProposal("proposal.404", G, G2)).toBe(false);

      // Deferred via the column only (as setProposalPlan writes it), then staged: refused.
      const s = i.createProposal(proposalInput());
      expect(i.setProposalPlan(s.id, [], {}, plain.id)).toBe(true);
      const claim = i.claimProposal(s.id);
      if (!("claimed" in claim)) throw new Error("not claimed");
      expect(i.rebaseProposal(s.id, G, G2)).toBe(false); // accepting
      expect(i.stageProposal(s.id, claim.claimedAt, { evolutionId: "e", realizationId: "r", candidateId: "c", commit: "x", opIds: [] })).toBe(true);
      expect(i.releaseProposal(s.id, claim.claimedAt, null)).toBe(true);
      expect(i.rebaseProposal(s.id, G, G2)).toBe(false); // staged approval pins the old base
      expect(i.proposal(s.id)!.proposal.provenance.genomeCommit).toBe(G);
    });
  });

  it("migrates a proposals table without the plan columns; old rows read as an empty plan", async () => {
    await inDo((i, state) => {
      const sql = state.storage.sql;
      sql.exec("DROP TABLE proposals");
      sql.exec(`CREATE TABLE proposals (id TEXT PRIMARY KEY, status TEXT NOT NULL, json TEXT NOT NULL, turns_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, accept_error TEXT, accepted_json TEXT, claimed_at TEXT)`);
      const { plan: _no, ...legacy } = { id: "proposal.1", ...proposalInput(), plan: [] };
      sql.exec("INSERT INTO proposals (id, status, json, turns_json, created_at, updated_at) VALUES ('proposal.1', 'open', ?, '[]', 'x', 'x')", JSON.stringify(legacy));
      applySchema(sql);
      const cols = sql.exec("SELECT name FROM pragma_table_info('proposals')").toArray().map((r) => r.name);
      expect(cols).toEqual(expect.arrayContaining(["plan_json", "decisions_json", "deferred_from"]));
      expect(i.proposal("proposal.1")!.proposal.plan).toEqual([]);
      expect(i.proposalPlan("proposal.1")).toEqual({ plan: [], decisions: {} });
      expect(i.setProposalPlan("proposal.1", [node("thing.web")], { "thing.web": "agree" })).toBe(true);
      expect(i.proposal("proposal.1")!.proposal.plan).toEqual([node("thing.web")]);
    });
  });
});

describe("summary planCounts", () => {
  const task = (id: string, deps: string[] = []) => ({ id, title: id, artifactId: "web", steps: ["implement"], dependsOn: deps, readNodes: [], writeNodes: [id], checks: [],
    footprint: { repo: "web-repo", artifactId: "web", globs: [`${id}/**`], paths: [`${id}/file.ts`], unmatched: [], known: true, readGlobs: [], readPaths: [], writeKnown: true, readKnown: true } });
  const candidate = (i: SystemAuthority, pid: string, tid: string, a: { id: string; generation: number }, commit: string) =>
    i.lifecycleCandidate(pid, tid, a.id, a.generation, { commit, manifest: {}, changedPaths: [`${tid}/file.ts`], changedNodes: [tid] }).candidate;

  it("counts open plans, claimable tasks, submitted tasks and integrated plans", async () => {
    await inDo((i, state) => {
      expect(i.summary()!.planCounts).toEqual({ open: 0, awaitingAgent: 0, submitted: 0, integrated: 0 });
      const p = i.createRealizationPlan({ title: "Build", tasks: [task("a"), task("b", ["a"]), task("c")] });
      let s = i.summary()!;
      expect(s.planCounts).toEqual({ open: 1, awaitingAgent: 2, submitted: 0, integrated: 0 }); // a and c; b waits on a
      expect(s.signifiers).toContain("tasks-awaiting-agent");
      const a = i.claimLifecycleTask(p.id, "a", {}).attempt;
      expect(i.summary()!.planCounts!.awaitingAgent).toBe(1);
      const ca = candidate(i, p.id, "a", a, "b".repeat(40));
      expect(i.summary()!.planCounts).toMatchObject({ awaitingAgent: 1, submitted: 1 });
      i.lifecycleSelect(p.id, "a", ca.id);
      expect(i.summary()!.planCounts).toMatchObject({ awaitingAgent: 2, submitted: 0 }); // b and c
      // A claimed task whose lease lapsed awaits an agent again.
      i.claimLifecycleTask(p.id, "c", {});
      expect(i.summary()!.planCounts!.awaitingAgent).toBe(1);
      const saved = JSON.parse(String(state.storage.sql.exec("SELECT json FROM realization_plans WHERE id = ?", p.id).one().json));
      saved.tasks.find((t: { id: string }) => t.id === "c").attempts[0].leaseExpiresAt = "2000-01-01T00:00:00.000Z";
      state.storage.sql.exec("UPDATE realization_plans SET json = ? WHERE id = ?", JSON.stringify(saved), p.id);
      expect(i.summary()!.planCounts!.awaitingAgent).toBe(2);

      const q = i.createRealizationPlan({ title: "Small", tasks: [task("x")] });
      const x = i.claimLifecycleTask(q.id, "x", {}).attempt;
      const cx = candidate(i, q.id, "x", x, "c".repeat(40));
      i.lifecycleSelect(q.id, "x", cx.id);
      i.lifecycleIntegrate(q.id, [{ artifactId: "web", source: { repo: "web-repo--x", commit: cx.commit }, candidateId: cx.id, taskCandidates: [cx.id], realizedGenome: G }], [cx.id]);
      s = i.summary()!;
      expect(s.planCounts).toEqual({ open: 2, awaitingAgent: 2, submitted: 0, integrated: 1 });
      expect(s.signifiers).toContain("plan-awaiting-promotion");
    });
  });

  it("ignores promoted plans", () => {
    const now = Date.now();
    const plan = { status: "promoted", tasks: [{ id: "t", status: "pending", dependsOn: [], attempts: [] }] } as never;
    expect(planCounts([plan], now)).toEqual({ open: 0, awaitingAgent: 0, submitted: 0, integrated: 0 });
  });
});
