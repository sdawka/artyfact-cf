import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Evaluation } from "../shared/api";
import { StaleBaseError, PromotionBlockedError, type BootstrapInput, type GateCriterion, type SystemAuthority } from "../worker/do/system-authority";

const G1 = "1".repeat(40), A1 = "a".repeat(40), A2 = "b".repeat(40), A3 = "c".repeat(40);
let n = 0;
const stub = () => env.SYSTEMS.getByName(`test-${++n}-${Date.now()}`);

const boot: BootstrapInput = {
  systemId: "system.kit", title: "Kit", genomeRepo: "kit-system", appRepo: "kit-app", genomeCommit: G1, appCommit: A1,
  artifactId: "artifact.webapp", templateVersions: { "template.thing.cloudflare-worker-webapp": "1" }, hookVersions: {},
  evolutions: [{
    id: "evolution.1", title: "List people", intent: "x", state: "actionable", kind: "implementation", affectedNodes: ["screen.people"],
    affectedClaims: [], genomeDelta: [], acceptanceCriteria: ["C.people.list"], requiredEvidence: [], dependsOn: [], risk: "low",
  }],
};

const ev = (candidate: string, criterion: string, verdict: Evaluation["verdict"], execution: Evaluation["execution"] = "completed"): Evaluation => {
  const at = new Date().toISOString();
  return {
    id: "", candidate, criterion, hook: `hook.${criterion}`, verdict, execution, observations: [], verifier: "test",
    ownerId: "thing.webapp", subjectId: "screen.people", targetRef: candidate, startedAt: at, finishedAt: at, limitations: [], provenance: {},
  };
};

/** Bootstrap, start two realizations, submit one candidate each. */
async function twoCandidates(i: SystemAuthority) {
  await i.bootstrap(boot);
  const r1 = i.reserveRealization({ evolutionId: "evolution.1", target: "app", agentLabel: "a" });
  const r2 = i.reserveRealization({ evolutionId: "evolution.1", target: "app", agentLabel: "b" });
  const c1 = i.recordCandidate({ realizationId: r1.realization.id, commit: A2, manifest: {}, changedPaths: ["src/ui/people/index.html"], changedNodes: ["screen.people"] });
  const c2 = i.recordCandidate({ realizationId: r2.realization.id, commit: A3, manifest: {}, changedPaths: ["src/ui/people/list.ts"], changedNodes: ["screen.people"] });
  return { r1, r2, c1: c1.candidate, c2: c2.candidate, head: i.state()!.head };
}

type Gates = Record<string, GateCriterion[]>;
const hard = (...ids: string[]) => ids.map((id) => ({ id, severity: "hard" as const, blocking: true }));
const promoteInput = (candidateIds: string[], expectedHead: string | null, gates: Gates = {}, rationale = "ship it") => ({
  candidateIds, expectedHead, rationale, by: "admin", gates,
  artifactId: "artifact.webapp", templateVersions: {}, hookVersions: {},
});

describe("SystemAuthority bootstrap", () => {
  it("writes a root System commit and seeds evolutions; idempotent for the same commits", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const s = await i.bootstrap(boot);
      expect(s.head).toMatch(/^sc-1-/);
      expect(s.evolutionCounts).toEqual({ actionable: 1 });
      const again = await i.bootstrap(boot);
      expect(again.head).toBe(s.head);
      expect(i.history()).toHaveLength(1);
      expect(i.history()[0].genomeCommit).toBe(G1);
      expect(i.history()[0].composition).toMatchObject({ genomeCommit: G1, artifacts: { "artifact.webapp": { repo: "kit-app", commit: A1 } } });
    });
  });
});

describe("realizations", () => {
  it("numbers realizations System-wide and names forks <repo>--r<n>", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      await i.bootstrap(boot);
      const a = i.reserveRealization({ evolutionId: "evolution.1", target: "app" });
      const b = i.reserveRealization({ evolutionId: "evolution.1", target: "genome" });
      expect([a.realization.id, a.forkRepo, a.baseRepo, a.baseCommit]).toEqual(["realization.1.r1", "kit-app--r1", "kit-app", A1]);
      expect([b.realization.id, b.forkRepo, b.baseCommit]).toEqual(["realization.1.r2", "kit-system--r2", G1]);
      expect(i.evolution("evolution.1")!.state).toBe("realizing");
    });
  });

  it("checkpoints move claimed → working and dedupe repeats", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      await i.bootstrap(boot);
      const { realization } = i.reserveRealization({ evolutionId: "evolution.1", target: "app" });
      i.checkpoint(realization.id, { summary: "first", commit: A2 });
      i.checkpoint(realization.id, { summary: "first", commit: A2 });
      const out = i.checkpoint(realization.id, { summary: "second" });
      expect(out.checkpoint.seq).toBe(2);
      expect(out.realization.status).toBe("working");
    });
  });
});

describe("submit", () => {
  it("is idempotent on (realization, commit)", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      await i.bootstrap(boot);
      const { realization } = i.reserveRealization({ evolutionId: "evolution.1", target: "app" });
      const a = i.recordCandidate({ realizationId: realization.id, commit: A2, manifest: {}, changedPaths: [], changedNodes: [] });
      const b = i.recordCandidate({ realizationId: realization.id, commit: A2, manifest: {}, changedPaths: [], changedNodes: [] });
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      expect(b.candidate.id).toBe(a.candidate.id);
      expect(i.candidates({ realizationId: realization.id })).toHaveLength(1);
    });
  });

  it("upserts evaluations per criterion × hook and marks the realization evaluated", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const { c1 } = await twoCandidates(i);
      i.recordEvaluations(c1.id, [ev(c1.id, "C.people.list", "unknown", "not-run")], "evaluated");
      i.recordEvaluations(c1.id, [ev(c1.id, "C.people.list", "pass")], "evaluated");
      const evals = i.evaluations(c1.id);
      expect(evals).toHaveLength(1);
      expect(evals[0]).toMatchObject({ verdict: "pass", execution: "completed", criterion: "C.people.list" });
      expect(i.realization(c1.realization)!.realization.status).toBe("evaluated");
      expect(i.candidate(c1.id)!.state).toBe("evaluated");
    });
  });
});

describe("markEventSeen", () => {
  it("dedupes event ids", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      expect(i.markEventSeen("evt-1")).toBe(true);
      expect(i.markEventSeen("evt-1")).toBe(false);
      expect(i.markEventSeen("evt-2")).toBe(true);
    });
  });
});

describe("promote", () => {
  it("throws StaleBaseError on a stale expectedHead and changes nothing", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const { c1, head } = await twoCandidates(i);
      const input = promoteInput([c1.id], "sc-0-stale");
      const prep = await i.preparePromotion(input);
      expect(() => i.promoteTx(input, prep)).toThrow(StaleBaseError);
      try { i.promoteTx(input, prep); } catch (e) { expect((e as StaleBaseError).currentHead).toBe(head); }
      expect(await i.promote(input)).toEqual({ ok: false, code: "stale-base", currentHead: head });
      expect(i.state()!.head).toBe(head);
      expect(i.history()).toHaveLength(1);
    });
  });

  it("is blocked while a required criterion is unknown or not-run", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const { c1, head } = await twoCandidates(i);
      const required = { [c1.id]: hard("C.people.list", "C.webapp.exists") };
      i.recordEvaluations(c1.id, [ev(c1.id, "C.people.list", "unknown"), ev(c1.id, "C.webapp.exists", "pass")]);
      const input = promoteInput([c1.id], head, required);
      expect(() => i.promoteTx(input, { head, manifest: { genomeCommit: G1, artifacts: {}, templateVersions: {}, hookVersions: {} }, manifestHash: "0".repeat(64) }))
        .toThrow(PromotionBlockedError);
      const r1 = await i.promote(input);
      expect(r1).toEqual({ ok: false, code: "blocked", blocking: [{ candidate: c1.id, criterion: "C.people.list", severity: "hard", verdict: "unknown", execution: "completed" }], advisories: [] });
      i.recordEvaluations(c1.id, [ev(c1.id, "C.people.list", "pass", "not-run")]);
      expect(await i.promote(input)).toMatchObject({ ok: false, code: "blocked" });
      const missing = await i.promote(promoteInput([c1.id], head, { [c1.id]: hard("C.other") }));
      expect(missing).toMatchObject({ ok: false, code: "blocked", blocking: [{ criterion: "C.other", verdict: "missing" }] });
      expect(i.state()!.head).toBe(head);
    });
  });

  it("soft/advisory criteria never block but need a non-empty rationale", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const { c1, head } = await twoCandidates(i);
      const gates: Gates = { [c1.id]: [...hard("C.people.list"), { id: "C.people.sorted", severity: "soft" as const, blocking: false }, { id: "C.nice", severity: "advisory" as const, blocking: false }] };
      i.recordEvaluations(c1.id, [ev(c1.id, "C.people.list", "pass"), ev(c1.id, "C.people.sorted", "fail")], "evaluated");
      const refused = await i.promote(promoteInput([c1.id], head, gates, "  "));
      expect(refused).toMatchObject({ ok: false, code: "advisories-unacknowledged", blocking: [] });
      if (refused.ok || !("advisories" in refused)) throw new Error("expected refusal");
      expect(refused.advisories.map((a) => [a.criterion, a.severity, a.verdict])).toEqual([["C.people.sorted", "soft", "fail"], ["C.nice", "advisory", "missing"]]);
      expect(i.state()!.head).toBe(head);
      const out = await i.promote(promoteInput([c1.id], head, gates, "sorting can follow"));
      if (!out.ok) throw new Error(JSON.stringify(out));
      expect(out.advisories.map((a) => a.criterion)).toEqual(["C.people.sorted", "C.nice"]);
      expect(out.commit.decision.acknowledged).toEqual(["C.people.sorted", "C.nice"]);
    });
  });

  it("reports advisories alongside hard blockers", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const { c1, head } = await twoCandidates(i);
      const out = await i.promote(promoteInput([c1.id], head, { [c1.id]: [...hard("C.people.list"), { id: "C.people.sorted", severity: "soft" as const, blocking: false }] }));
      expect(out).toMatchObject({ ok: false, code: "blocked", blocking: [{ criterion: "C.people.list" }], advisories: [{ criterion: "C.people.sorted" }] });
    });
  });

  it("writes a parented System commit, moves the head and rejects sibling candidates", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const { c1, c2, r1, r2, head } = await twoCandidates(i);
      i.recordEvaluations(c1.id, [ev(c1.id, "C.people.list", "pass")], "evaluated");
      const out = await i.promote(promoteInput([c1.id], head, { [c1.id]: hard("C.people.list") }));
      if (!out.ok) throw new Error(JSON.stringify(out));
      expect(out.commit.parent).toBe(head);
      expect(out.commit.composition!.artifacts["artifact.webapp"]).toEqual({ repo: "kit-app--r1", commit: A2 });
      expect(out.commit.manifest).toEqual([{ artifact: "artifact.webapp", type: "worker-fullstack", repo: "kit-app--r1", commit: A2, scope: [] }]);
      expect(out.commit.genomeCommit).toBe(G1);
      expect(out.commit.manifestHash).toMatch(/^[0-9a-f]{64}$/);
      expect(out.rejected).toEqual([c2.id]);
      expect(i.state()!.head).toBe(out.commit.id);
      expect(i.state()!.appSource).toEqual({ repo: "kit-app--r1", commit: A2 });
      expect(i.candidate(c1.id)!.state).toBe("promoted");
      expect(i.candidate(c2.id)!.state).toBe("rejected");
      expect(i.realization(r1.realization.id)!.realization.status).toBe("promoted");
      expect(i.realization(r2.realization.id)!.realization.status).toBe("rejected");
      expect(i.evolution("evolution.1")!.state).toBe("promoted");
      expect(i.evolution("evolution.1")!.decision).toBe("ship it");
      expect(i.evolution("evolution.1")!.decisionRecord).toMatchObject({ by: "admin", rationale: "ship it" });
      expect(i.history().map((c) => c.id)).toEqual([out.commit.id, head]);
      // The sibling, even with a fresh expectedHead, is stale: it was built on the old head.
      expect(await i.promote(promoteInput([c2.id], out.commit.id))).toEqual({ ok: false, code: "stale-base", currentHead: out.commit.id });
    });
  });

  it("new app realizations fork from the promoted artifact", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const { c1, head } = await twoCandidates(i);
      await i.promote(promoteInput([c1.id], head));
      await i.bootstrap({ ...boot, evolutions: [{ ...boot.evolutions[0], id: "evolution.3" }] });
      const r = i.reserveRealization({ evolutionId: "evolution.3", target: "app" });
      expect([r.baseRepo, r.baseCommit, r.forkRepo]).toEqual(["kit-app--r1", A2, "kit-app--r3"]);
    });
  });
});

describe("promote a Genome candidate", () => {
  it("moves genome_source to the fork together with genome_commit", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      await i.bootstrap(boot);
      const { realization } = i.reserveRealization({ evolutionId: "evolution.1", target: "genome" });
      const G2 = "2".repeat(40);
      const { candidate } = i.recordCandidate({ realizationId: realization.id, commit: G2, manifest: {}, changedPaths: ["things/webapp/ontology.yaml"], changedNodes: ["entity.ContactRecord"] });
      const out = await i.promote(promoteInput([candidate.id], i.state()!.head));
      if (!out.ok) throw new Error(JSON.stringify(out));
      expect(i.state()).toMatchObject({ genomeCommit: G2, genomeSource: "kit-system--r1" });
      expect(out.commit.genomeCommit).toBe(G2);
    });
  });
});

describe("accept", () => {
  it("makes a Genome candidate canonical and records a System commit", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      await i.bootstrap(boot);
      const { realization } = i.reserveRealization({ evolutionId: "evolution.1", target: "genome" });
      const G2 = "2".repeat(40);
      i.recordCandidate({ realizationId: realization.id, commit: G2, manifest: {}, changedPaths: ["things/webapp/ontology.yaml"], changedNodes: ["entity.ContactRecord"] });
      const out = await i.accept({ realizationId: realization.id, rationale: "ok", by: "admin", evolutions: boot.evolutions, artifactId: "artifact.webapp", templateVersions: {}, hookVersions: {} });
      if (!out.ok) throw new Error(JSON.stringify(out));
      expect(out.genomeCommit).toBe(G2);
      expect(i.state()).toMatchObject({ genomeCommit: G2, genomeSource: "kit-system--r1", head: out.commit.id });
      expect(out.commit.genomeCommit).toBe(G2);
      const again = await i.accept({ realizationId: realization.id, rationale: "ok", by: "admin", evolutions: [], artifactId: "artifact.webapp", templateVersions: {}, hookVersions: {} });
      expect(again).toMatchObject({ ok: true, genomeCommit: G2 });
      expect(i.history()).toHaveLength(2);
    });
  });
});

describe("registry", () => {
  it("indexes systems, realizations and forks", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      i.registerRealization("realization.1.r1", "system.kit", "evolution.1", "kit-app--r1");
      expect(i.resolveFork("kit-app--r1")).toEqual({ systemId: "system.kit", evolutionId: "evolution.1", realizationId: "realization.1.r1" });
      expect(i.resolveRealization("realization.1.r1")).toEqual({ systemId: "system.kit", evolutionId: "evolution.1", forkRepo: "kit-app--r1" });
      expect(i.resolveFork("nope")).toBeNull();
    });
  });
});
