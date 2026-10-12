import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Evaluation, SystemSummary } from "../shared/api";
import { REGISTRY, StaleBaseError, PromotionBlockedError, type BootstrapInput, type GateCriterion, type SystemAuthority } from "../worker/do/system-authority";

const G1 = "1".repeat(40), A1 = "a".repeat(40), A2 = "b".repeat(40), A3 = "c".repeat(40);
let n = 0;
const stub = () => env.SYSTEMS.getByName(`test-${++n}-${Date.now()}`);

const boot: BootstrapInput = {
  systemId: "system.kit", title: "Kit", genomeRepo: "kit-system", appRepo: "kit-app", genomeCommit: G1, appCommit: A1,
  artifactId: "artifact.webapp", templateVersions: { "template.thing.cloudflare-worker-webapp": "1" }, hookVersions: {}, platform: null,
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
const promoteInput = (candidateIds: string[], expectedHead: string | null, gates: Gates = Object.fromEntries(candidateIds.map((id) => [id, []])), rationale = "ship it") => ({
  candidateIds, expectedHead, rationale, by: "admin", gates,
  artifactId: "artifact.webapp", templateVersions: {}, hookVersions: {},
});

describe("SystemAuthority bootstrap", () => {
  it("writes a root System commit and seeds evolutions; idempotent for the same commits", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const s = (await i.bootstrap(boot)) as SystemSummary;
      expect(s.head).toMatch(/^sc-1-/);
      expect(s.evolutionCounts).toEqual({ actionable: 1 });
      const again = (await i.bootstrap(boot)) as SystemSummary;
      expect(again.head).toBe(s.head);
      expect(i.history()).toHaveLength(1);
      expect(i.history()[0].genomeCommit).toBe(G1);
      expect(i.history()[0].composition).toMatchObject({ genomeCommit: G1, artifacts: { "artifact.webapp": { repo: "kit-app", commit: A1 } } });
    });
  });
});

describe("platform provenance", () => {
  const P1 = { repo: "platform", commit: "e".repeat(40) }, P2 = { repo: "platform", commit: "f".repeat(40) };
  const scaffold = { repo: "platform", commit: "d".repeat(40), path: "templates/thing/cloudflare-worker-webapp@1/scaffold" };

  it("records platform in the head and every commit's manifest, and the scaffold source on the app binding", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      await i.bootstrap({ ...boot, platform: P1, scaffoldFrom: scaffold });
      expect(i.state()!.platform).toEqual(P1);
      expect(i.history()[0].composition).toMatchObject({ platform: P1, artifacts: { "artifact.webapp": { repo: "kit-app", commit: A1, scaffoldFrom: scaffold } } });
      const r = i.reserveRealization({ evolutionId: "evolution.1", target: "app" });
      const { candidate } = i.recordCandidate({ realizationId: r.realization.id, commit: A2, manifest: {}, changedPaths: ["src/a.ts"], changedNodes: ["screen.people"] });
      i.recordEvaluations(candidate.id, [ev(candidate.id, "C.people.list", "pass")], "evaluated");
      const out = await i.promote(promoteInput([candidate.id], i.state()!.head));
      expect(out).toMatchObject({ ok: true });
      expect(i.history()[0].composition).toMatchObject({ platform: P1, artifacts: { "artifact.webapp": { repo: "kit-app--r1", commit: A2, scaffoldFrom: scaffold } } });
    });
  });

  it("keeps the recorded scaffold source when a forced re-import of the same app repo omits it", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      await i.bootstrap({ ...boot, scaffoldFrom: scaffold });
      await i.bootstrap({ ...boot, appCommit: A3, force: true });
      expect(i.history()[0].composition!.artifacts["artifact.webapp"]).toMatchObject({ repo: "kit-app", commit: A3, scaffoldFrom: scaffold });
      await i.bootstrap({ ...boot, appRepo: "other-app", appCommit: A2, force: true });
      expect(i.history()[0].composition!.artifacts["artifact.webapp"]).not.toHaveProperty("scaffoldFrom");
    });
  });

  it("records null without a platform repo; a later platform commit alone updates provenance in place, the next commit carries it", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      await i.bootstrap(boot);
      expect(i.state()!.platform).toBeNull();
      expect(i.history()[0].composition!.platform).toBeNull();
      expect(i.history()[0].composition!.artifacts["artifact.webapp"]).not.toHaveProperty("scaffoldFrom");
      const head = i.state()!.head;
      const s = (await i.bootstrap({ ...boot, platform: P1 })) as SystemSummary;
      expect(s.head).toBe(head);
      expect(i.history()).toHaveLength(1);
      expect(i.state()!.platform).toEqual(P1);
      expect(i.history()[0].composition!.platform).toBeNull();
      const r = i.reserveRealization({ evolutionId: "evolution.1", target: "app" });
      const { candidate } = i.recordCandidate({ realizationId: r.realization.id, commit: A2, manifest: {}, changedPaths: ["src/a.ts"], changedNodes: ["screen.people"] });
      i.recordEvaluations(candidate.id, [ev(candidate.id, "C.people.list", "pass")], "evaluated");
      expect(await i.promote(promoteInput([candidate.id], head))).toMatchObject({ ok: true });
      expect(i.history()[0].composition).toMatchObject({ platform: P1, artifacts: { "artifact.webapp": { repo: "kit-app--r1", commit: A2 } } });
    });
  });

  it("a platform-only re-import after an accepted amendment keeps the head, its versions and open work", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const evo2 = { ...boot.evolutions[0], id: "evolution.2", title: "Search people" };
      const imported = { ...boot, evolutions: [boot.evolutions[0], evo2] };
      await i.bootstrap({ ...imported, platform: P1 });
      const g = i.reserveRealization({ evolutionId: "evolution.1", target: "genome" });
      const cg = i.recordCandidate({ realizationId: g.realization.id, commit: "2".repeat(40), manifest: {}, changedPaths: ["x.yaml"], changedNodes: ["screen.people"] }).candidate;
      i.recordEvaluations(cg.id, [ev(cg.id, "C.people.list", "pass")], "awaiting-admin");
      const amended = [{ ...boot.evolutions[0], acceptanceCriteria: ["C.people.list", "C.people.search"] }, evo2];
      const versions = { templateVersions: { "template.thing.cloudflare-worker-webapp": "2" }, hookVersions: { "hook.people.search": "1" } };
      expect(await i.accept({ realizationId: g.realization.id, candidateId: cg.id, commit: cg.commit, rationale: "ok", by: "admin", evolutions: amended, gates: hard("C.people.list"), artifactId: "artifact.webapp", ...versions })).toMatchObject({ ok: true });
      const app = i.reserveRealization({ evolutionId: "evolution.2", target: "app" });
      const before = i.state()!;
      const commits = i.history().length;
      expect(before.manifest).toMatchObject({ genomeCommit: "2".repeat(40), ...versions, platform: P1 });

      // The original import again (its Genome still has the old versions and criteria), with a new platform commit.
      await i.bootstrap({ ...imported, platform: P2 });
      const after = i.state()!;
      expect(i.history()).toHaveLength(commits);
      expect(after).toEqual({ ...before, platform: P2 });
      expect(after.manifest).toMatchObject(versions);
      expect(i.evolution("evolution.1")!.acceptanceCriteria).toEqual(["C.people.list", "C.people.search"]);

      // Open work is not stale: the app realization still promotes on the unchanged head.
      const ca = i.recordCandidate({ realizationId: app.realization.id, commit: A2, manifest: {}, changedPaths: ["src/a.ts"], changedNodes: ["screen.people"] }).candidate;
      i.recordEvaluations(ca.id, [ev(ca.id, "C.people.list", "pass")], "evaluated");
      expect(await i.promote(promoteInput([ca.id], after.head))).toMatchObject({ ok: true });
      expect(i.history()[0].composition).toMatchObject({ platform: P2, genomeCommit: "2".repeat(40) });
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
      expect(() => i.promoteTx(input, { head, manifest: { genomeCommit: G1, artifacts: { "artifact.webapp": { repo: "kit-app--r1", commit: A2 } }, templateVersions: {}, hookVersions: {} }, manifestHash: "0".repeat(64) }))
        .toThrow(PromotionBlockedError);
      const r1 = await i.promote(input);
      expect(r1).toEqual({ ok: false, code: "blocked", blocking: [{ candidate: c1.id, criterion: "C.people.list", severity: "hard", verdict: "unknown", execution: "completed" }], advisories: [] });
      i.recordEvaluations(c1.id, [ev(c1.id, "C.people.list", "pass", "not-run")]);
      expect(await i.promote(input)).toMatchObject({ ok: false, code: "blocked" });
      const missing = await i.promote(promoteInput([c1.id], head, { [c1.id]: hard("C.other") }));
      expect(missing).toMatchObject({ ok: false, code: "blocked", blocking: expect.arrayContaining([expect.objectContaining({ criterion: "C.other", verdict: "unknown", execution: "missing" })]) });
      expect(i.state()!.head).toBe(head);
    });
  });

  it("disregards only the not-run rows of hooks the Worker names off-trigger; every other non-pass row blocks", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const { c1, head } = await twoCandidates(i);
      const gate = (off?: string[]) => ({ [c1.id]: [{ id: "C.system.purpose", severity: "hard" as const, blocking: true, ...(off && { offTriggerHooks: off }) }] });
      const hookB = (verdict: Evaluation["verdict"], execution: Evaluation["execution"]) => ({ ...ev(c1.id, "C.system.purpose", verdict, execution), hook: "hook.purpose.b" });
      i.recordEvaluations(c1.id, [ev(c1.id, "C.people.list", "pass")]); // the Evolution's acceptance criterion
      // Hook A (submission) passed; hook B (promotion, bound) never ran and is not named off-trigger: blocked.
      i.recordEvaluations(c1.id, [ev(c1.id, "C.system.purpose", "pass"), hookB("unknown", "not-run")]);
      expect(await i.promote(promoteInput([c1.id], head, gate()))).toMatchObject({ ok: false, code: "blocked", blocking: [expect.objectContaining({ execution: "not-run" })] });
      // Off-trigger covers not-run rows only: any other non-pass row of hook B still blocks.
      for (const [verdict, execution] of [["fail", "completed"], ["unknown", "completed"], ["unknown", "error"], ["unknown", "queued"], ["unknown", "running"]] as const) {
        i.recordEvaluations(c1.id, [ev(c1.id, "C.system.purpose", "pass"), hookB(verdict, execution)]);
        expect(await i.promote(promoteInput([c1.id], head, gate(["hook.purpose.b"])))).toMatchObject({ ok: false, code: "blocked" });
      }
      // Nothing ran at all: missing evidence, blocked.
      i.recordEvaluations(c1.id, [ev(c1.id, "C.system.purpose", "unknown", "not-run"), hookB("unknown", "not-run")]);
      expect(await i.promote(promoteInput([c1.id], head, gate(["hook.purpose.b", "hook.C.system.purpose"])))).toMatchObject({ ok: false, code: "blocked" });
      // Hook B is an outcome-stage hook (named off-trigger by the Worker): its not-run row does not block.
      i.recordEvaluations(c1.id, [ev(c1.id, "C.system.purpose", "pass"), hookB("unknown", "not-run")]);
      expect(await i.promote(promoteInput([c1.id], head, gate(["hook.purpose.b"])))).toMatchObject({ ok: true });
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
      expect(refused.advisories.map((a) => [a.criterion, a.severity, a.verdict])).toEqual([["C.people.sorted", "soft", "fail"], ["C.nice", "advisory", "unknown"]]);
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
      i.recordEvaluations(c1.id, [ev(c1.id, "C.people.list", "pass")], "evaluated");
      expect(await i.promote(promoteInput([c1.id], head))).toMatchObject({ ok: true });
      await i.bootstrap({ ...boot, evolutions: [{ ...boot.evolutions[0], id: "evolution.3" }] });
      const r = i.reserveRealization({ evolutionId: "evolution.3", target: "app" });
      expect([r.baseRepo, r.baseCommit, r.forkRepo]).toEqual(["kit-app--r1", A2, "kit-app--r3"]);
    });
  });
});

describe("promotion gate fails closed", () => {
  it("1: refuses with gate-unavailable when no gate was computed for a candidate", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const { c1, head } = await twoCandidates(i);
      i.recordEvaluations(c1.id, [ev(c1.id, "C.people.list", "pass")], "evaluated");
      const out = await i.promote(promoteInput([c1.id], head, {}));
      expect(out).toMatchObject({ ok: false, code: "gate-unavailable", message: expect.stringContaining(c1.id) });
      expect(i.state()!.head).toBe(head);
    });
  });

  it("2: the Evolution's acceptance criteria block even when the Worker omitted them", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const { c1, head } = await twoCandidates(i);
      const out = await i.promote(promoteInput([c1.id], head, { [c1.id]: [] }));
      expect(out).toMatchObject({ ok: false, code: "blocked", blocking: [{ criterion: "C.people.list", severity: "hard", verdict: "unknown" }] });
    });
  });

  it("3: a blocking criterion with no evaluation for this candidate is blocking with verdict unknown", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const { c1, c2, head } = await twoCandidates(i);
      // Evidence on a sibling candidate (another commit) does not count.
      i.recordEvaluations(c2.id, [ev(c2.id, "C.people.list", "pass"), ev(c2.id, "C.webapp.exists", "pass")], "evaluated");
      i.recordEvaluations(c1.id, [ev(c1.id, "C.people.list", "pass")], "evaluated");
      const out = await i.promote(promoteInput([c1.id], head, { [c1.id]: hard("C.people.list", "C.webapp.exists") }));
      expect(out).toMatchObject({ ok: false, code: "blocked", blocking: [{ candidate: c1.id, criterion: "C.webapp.exists", verdict: "unknown", execution: "missing" }] });
    });
  });

  it("4: an empty blocking set promotes only with acceptance criteria that are all evaluated", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      // No acceptance criteria at all → refuse.
      await i.bootstrap({ ...boot, evolutions: [{ ...boot.evolutions[0], acceptanceCriteria: [] }] });
      const r = i.reserveRealization({ evolutionId: "evolution.1", target: "app" });
      const { candidate } = i.recordCandidate({ realizationId: r.realization.id, commit: A2, manifest: {}, changedPaths: [], changedNodes: [] });
      const head = i.state()!.head;
      expect(await i.promote(promoteInput([candidate.id], head))).toMatchObject({ ok: false, code: "gate-unavailable" });
    });
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      // Acceptance criterion classified as non-blocking (soft) but unevaluated → refuse; once evaluated → promote.
      const { c1, head } = await twoCandidates(i);
      const gates = { [c1.id]: [{ id: "C.people.list", severity: "soft" as const, blocking: false }] };
      expect(await i.promote(promoteInput([c1.id], head, gates))).toMatchObject({ ok: false, code: "gate-unavailable", message: expect.stringContaining("C.people.list") });
      // A not-run row (what the runner writes for an acceptance criterion with no runnable hook) is not "evaluated".
      for (const execution of ["not-run", "error", "queued", "running", "deferred"] as const) {
        i.recordEvaluations(c1.id, [ev(c1.id, "C.people.list", "unknown", execution)], "evaluated");
        expect(await i.promote(promoteInput([c1.id], head, gates, "x")), execution).toMatchObject({ ok: false, code: "gate-unavailable", message: expect.stringContaining("unevaluated") });
      }
      expect(i.state()!.head).toBe(head);
      i.recordEvaluations(c1.id, [ev(c1.id, "C.people.list", "unknown")], "evaluated");
      const out = await i.promote(promoteInput([c1.id], head, gates, "soft acceptance acknowledged"));
      expect(out).toMatchObject({ ok: true, advisories: [{ criterion: "C.people.list" }] });
    });
  });
});

describe("promotion binds exactly the promoted commits", () => {
  it("refuses more than one app candidate with invalid-state until composition exists", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const { c1, c2, head } = await twoCandidates(i);
      const pass = (id: string) => i.recordEvaluations(id, [ev(id, "C.people.list", "pass")], "evaluated");
      pass(c1.id); pass(c2.id);
      expect(i.composedManifestExact([c1.id, c2.id], "artifact.webapp")).toMatchObject({ exact: false, problems: expect.arrayContaining([expect.stringContaining("2 app candidates")]) });
      expect(i.composedManifestExact([c1.id], "artifact.webapp")).toEqual({ exact: true, problems: [] });
      const out = await i.promote(promoteInput([c1.id, c2.id], head));
      expect(out).toMatchObject({ ok: false, code: "invalid-state", message: expect.stringContaining("2 app candidates") });
      expect(i.state()!.head).toBe(head);
      expect(i.candidate(c1.id)!.state).toBe("evaluated");
    });
  });

  it("refuses a prepared manifest that does not bind every candidate's commit", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const { c1, head } = await twoCandidates(i);
      i.recordEvaluations(c1.id, [ev(c1.id, "C.people.list", "pass")], "evaluated");
      const input = promoteInput([c1.id], head);
      const other = { head, manifest: { genomeCommit: G1, artifacts: { "artifact.webapp": { repo: "kit-app--r2", commit: A3 } }, templateVersions: {}, hookVersions: {} }, manifestHash: "0".repeat(64) };
      expect(() => i.promoteTx(input, other)).toThrow(/does not bind/);
      expect(i.state()!.head).toBe(head);
    });
  });
});

describe("promote a Genome candidate", () => {
  it("is refused with use-accept; the head, Genome and candidate stay as they are", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      await i.bootstrap(boot);
      const before = i.state()!;
      const { realization } = i.reserveRealization({ evolutionId: "evolution.1", target: "genome" });
      const G2 = "2".repeat(40);
      const { candidate } = i.recordCandidate({ realizationId: realization.id, commit: G2, manifest: {}, changedPaths: ["things/webapp/ontology.yaml"], changedNodes: ["entity.ContactRecord"] });
      i.recordEvaluations(candidate.id, [ev(candidate.id, "C.people.list", "pass")], "evaluated");
      const out = await i.promote(promoteInput([candidate.id], before.head));
      expect(out).toMatchObject({ ok: false, code: "use-accept", message: expect.stringContaining("/accept") });
      expect(i.state()).toMatchObject({ head: before.head, genomeCommit: before.genomeCommit, genomeSource: before.genomeSource });
      expect(i.candidate(candidate.id)!.state).toBe("evaluated");
      expect(i.history()).toHaveLength(1);
    });
  });
});

describe("accept", () => {
  it("makes a Genome candidate canonical and records a System commit", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      await i.bootstrap(boot);
      const { realization } = i.reserveRealization({ evolutionId: "evolution.1", target: "genome" });
      const G2 = "2".repeat(40);
      const { candidate } = i.recordCandidate({ realizationId: realization.id, commit: G2, manifest: {}, changedPaths: ["things/webapp/ontology.yaml"], changedNodes: ["entity.ContactRecord"] });
      i.recordEvaluations(candidate.id, [ev(candidate.id, "C.people.list", "pass")], "awaiting-admin");
      const out = await i.accept({ realizationId: realization.id, candidateId: candidate.id, commit: G2, rationale: "ok", by: "admin", evolutions: boot.evolutions, gates: hard("C.people.list"), artifactId: "artifact.webapp", templateVersions: {}, hookVersions: {} });
      if (!out.ok) throw new Error(JSON.stringify(out));
      expect(out.genomeCommit).toBe(G2);
      expect(i.state()).toMatchObject({ genomeCommit: G2, genomeSource: "kit-system--r1", head: out.commit.id });
      expect(out.commit.genomeCommit).toBe(G2);
      const again = await i.accept({ realizationId: realization.id, candidateId: candidate.id, commit: G2, rationale: "ok", by: "admin", evolutions: [], artifactId: "artifact.webapp", templateVersions: {}, hookVersions: {} });
      expect(again).toMatchObject({ ok: true, genomeCommit: G2 });
      expect(i.history()).toHaveLength(2);
    });
  });

  it("refuses a Genome candidate built on an earlier head (another accept landed first)", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      await i.bootstrap(boot);
      const a = i.reserveRealization({ evolutionId: "evolution.1", target: "genome" });
      const b = i.reserveRealization({ evolutionId: "evolution.1", target: "genome" });
      const ca = i.recordCandidate({ realizationId: a.realization.id, commit: "2".repeat(40), manifest: {}, changedPaths: ["x.yaml"], changedNodes: ["entity.ContactRecord"] }).candidate;
      const cb = i.recordCandidate({ realizationId: b.realization.id, commit: "3".repeat(40), manifest: {}, changedPaths: ["x.yaml"], changedNodes: ["entity.ContactRecord"] }).candidate;
      for (const c of [ca, cb]) i.recordEvaluations(c.id, [ev(c.id, "C.people.list", "pass")], "awaiting-admin");
      const input = (rid: string, c: { id: string; commit: string }) => ({ realizationId: rid, candidateId: c.id, commit: c.commit, rationale: "ok", by: "admin", evolutions: boot.evolutions, gates: hard("C.people.list"), artifactId: "artifact.webapp", templateVersions: {}, hookVersions: {} });
      expect(await i.accept(input(a.realization.id, ca))).toMatchObject({ ok: true });
      const head = i.state()!.head;
      expect(await i.accept(input(b.realization.id, cb))).toMatchObject({ ok: false, code: "stale-base" });
      expect(i.state()).toMatchObject({ head, genomeCommit: "2".repeat(40) });
    });
  });
});

describe("accept uses the promotion gate", () => {
  const acceptInput = (realizationId: string, gates: GateCriterion[] | undefined, rationale = "", c = { id: `candidate.1.r1.${"2".repeat(7)}`, commit: "2".repeat(40) }) =>
    ({ realizationId, candidateId: c.id, commit: c.commit, rationale, by: "admin", evolutions: boot.evolutions, gates, artifactId: "artifact.webapp", templateVersions: {}, hookVersions: {} });
  const withProvider = (e: Evaluation, provider: string): Evaluation => ({ ...e, provenance: { engine: "system-one", provider } });

  it("refuses a blocking criterion that is not pass+completed, and a missing gate", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      await i.bootstrap(boot);
      const { realization } = i.reserveRealization({ evolutionId: "evolution.1", target: "genome" });
      const { candidate } = i.recordCandidate({ realizationId: realization.id, commit: "2".repeat(40), manifest: {}, changedPaths: ["description.yaml"], changedNodes: [] });
      i.recordEvaluations(candidate.id, [ev(candidate.id, "C.people.list", "pass"), ev(candidate.id, "C.system.promotion", "fail")], "awaiting-admin");
      const head = i.state()!.head;
      expect(await i.accept(acceptInput(realization.id, undefined))).toMatchObject({ ok: false, code: "gate-unavailable" });
      const out = await i.accept(acceptInput(realization.id, hard("C.people.list", "C.system.promotion"), "looks fine"));
      expect(out).toMatchObject({ ok: false, code: "blocked", blocking: [{ criterion: "C.system.promotion", verdict: "fail" }] });
      expect(i.state()!.head).toBe(head);
      expect(i.realization(realization.id)!.realization.status).toBe("awaiting-admin");
    });
  });

  it("needs a rationale for advisories and records them with the evidence providers", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      await i.bootstrap(boot);
      const { realization } = i.reserveRealization({ evolutionId: "evolution.1", target: "genome" });
      const { candidate } = i.recordCandidate({ realizationId: realization.id, commit: "2".repeat(40), manifest: {}, changedPaths: ["things/webapp/ontology.yaml"], changedNodes: [] });
      i.recordEvaluations(candidate.id, [
        withProvider(ev(candidate.id, "C.people.list", "pass"), "fake"),
        withProvider(ev(candidate.id, "C.nice", "unknown"), "fake,off"),
      ], "awaiting-admin");
      const gates = [...hard("C.people.list"), { id: "C.nice", severity: "soft" as const, blocking: false }];
      expect(await i.accept(acceptInput(realization.id, gates, " "))).toMatchObject({ ok: false, code: "advisories-unacknowledged", blocking: [] });
      const out = await i.accept(acceptInput(realization.id, gates, "the wording change is deliberate"));
      if (!out.ok) throw new Error(JSON.stringify(out));
      expect(out.advisories.map((a) => a.criterion)).toEqual(["C.nice"]);
      expect(out.commit.decision).toMatchObject({ policy: "admin-accept", acknowledged: ["C.nice"], evidenceProviders: ["fake", "off"] });
      expect(i.history()[0].decision.evidenceProviders).toEqual(["fake", "off"]);
    });
  });
});

describe("promote records evidence providers", () => {
  it("lists the distinct System One providers behind the gating evaluations", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority) => {
      const { c1, head } = await twoCandidates(i);
      i.recordEvaluations(c1.id, [
        { ...ev(c1.id, "C.people.list", "pass"), provenance: { engine: "system-one", provider: "fake" } },
        { ...ev(c1.id, "C.people.list", "pass"), hook: "hook.rules", provenance: { engine: "rules" } },
        { ...ev(c1.id, "C.unrelated", "pass"), provenance: { provider: "typesafe" } },
      ], "evaluated");
      const out = await i.promote(promoteInput([c1.id], head, { [c1.id]: hard("C.people.list") }));
      if (!out.ok) throw new Error(JSON.stringify(out));
      expect(out.commit.decision.evidenceProviders).toEqual(["fake"]);
    });
  });
});

describe("schema", () => {
  it("adds columns that a table created by an earlier version lacks", async () => {
    await runInDurableObject(stub(), async (_i: SystemAuthority, state) => {
      const sql = state.storage.sql;
      sql.exec("DROP TABLE realizations");
      sql.exec(`CREATE TABLE realizations (id TEXT PRIMARY KEY, evolution_id TEXT NOT NULL, n INTEGER NOT NULL, target TEXT NOT NULL,
        fork_repo TEXT NOT NULL, token_id TEXT, token_expires TEXT, base_commit TEXT, agent_label TEXT, status TEXT NOT NULL,
        packet_json TEXT, packet_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      const { applySchema } = await import("../worker/do/schema");
      applySchema(sql);
      applySchema(sql); // idempotent
      const cols = sql.exec("SELECT name FROM pragma_table_info('realizations')").toArray().map((r) => r.name);
      expect(cols).toEqual(expect.arrayContaining(["base_repo", "base_head", "role", "remote", "rejection_reason", "subscription_id", "origin"]));
    });
  });

  it("creates the iteration-2 tables (builds, deployments, phenome_events, changelog_cache)", async () => {
    await runInDurableObject(stub(), async (_i: SystemAuthority, state) => {
      const sql = state.storage.sql;
      const cols = (t: string) => sql.exec("SELECT name FROM pragma_table_info(?)", t).toArray().map((r) => r.name);
      expect(cols("builds")).toEqual(expect.arrayContaining(["id", "realization_id", "candidate_id", "commit_hash", "kind", "status", "reporter", "external_id", "steps_json"]));
      expect(cols("deployments")).toEqual(expect.arrayContaining(["id", "kind", "status", "repo", "commit_hash", "build_row", "ingest_token_hash"]));
      expect(cols("phenome_events")).toEqual(expect.arrayContaining(["seq", "event_id", "deployment_id", "build_id", "kind", "payload_json"]));
      expect(cols("changelog_cache")).toEqual(["commit_id", "row_json", "entry_json", "created_at"]);
      // event_id is unique and seq autoincrements.
      const ins = (id: string) => sql.exec(`INSERT INTO phenome_events (event_id, thing_id, artifact_id, build_id, commit_hash, kind, emitted_at, received_at)
        VALUES (?, 't', 'a', 'b', 'c', 'k', 'x', 'y')`, id);
      ins("e1"); ins("e2");
      expect(() => ins("e1")).toThrow();
      expect(sql.exec("SELECT seq FROM phenome_events ORDER BY seq").toArray().map((r) => r.seq)).toEqual([1, 2]);
    });
  });
});

describe("registry", () => {
  it("indexes systems, realizations and forks in the __registry instance", async () => {
    await runInDurableObject(env.SYSTEMS.getByName(REGISTRY), async (i: SystemAuthority) => {
      i.registerRealization("realization.1.r1", "system.reg-test", "evolution.1", "reg-test-app--r1");
      expect(i.resolveFork("reg-test-app--r1")).toEqual({ systemId: "system.reg-test", evolutionId: "evolution.1", realizationId: "realization.1.r1" });
      expect(i.resolveRealization("realization.1.r1")).toMatchObject({ systemId: "system.reg-test", evolutionId: "evolution.1" });
      expect(i.resolveFork("nope")).toBeNull();
      i.unregisterRealization("system.reg-test", "realization.1.r1");
      expect(i.resolveFork("reg-test-app--r1")).toBeNull();
    });
  });

  it("keeps the same realization id in two Systems apart", async () => {
    await runInDurableObject(env.SYSTEMS.getByName(REGISTRY), async (i: SystemAuthority) => {
      i.registerRealization("realization.9.r1", "system.reg-a", "evolution.9", "reg-a-app--r1");
      i.registerRealization("realization.9.r1", "system.reg-b", "evolution.9", "reg-b-app--r1");
      // Both forks still resolve to their own System.
      expect(i.resolveFork("reg-a-app--r1")).toEqual({ systemId: "system.reg-a", evolutionId: "evolution.9", realizationId: "realization.9.r1" });
      expect(i.resolveFork("reg-b-app--r1")).toEqual({ systemId: "system.reg-b", evolutionId: "evolution.9", realizationId: "realization.9.r1" });
      expect(i.resolveRealization("realization.9.r1")).toEqual({ ambiguous: ["system.reg-a", "system.reg-b"] });
      // Unregistering B's realization (a failed start) leaves A's entry alone.
      i.unregisterRealization("system.reg-b", "realization.9.r1");
      expect(i.resolveFork("reg-a-app--r1")).toMatchObject({ systemId: "system.reg-a" });
      expect(i.resolveFork("reg-b-app--r1")).toBeNull();
      expect(i.resolveRealization("realization.9.r1")).toEqual({ systemId: "system.reg-a", evolutionId: "evolution.9", forkRepo: "reg-a-app--r1" });
    });
  });

  it("migrates the earlier realization-keyed table", async () => {
    await runInDurableObject(env.SYSTEMS.getByName(`${REGISTRY}`), async (_i: SystemAuthority, state) => {
      state.storage.sql.exec("CREATE TABLE registry_realizations (realization_id TEXT PRIMARY KEY, system_id TEXT NOT NULL, fork_repo TEXT NOT NULL)");
      state.storage.sql.exec("INSERT INTO registry_realizations VALUES ('realization.8.r1', 'system.old', 'old-app--r1')");
      const { RegistryStore } = await import("../worker/do/registry");
      const store = new RegistryStore(state.storage.sql);
      expect(store.resolveFork("old-app--r1")).toEqual({ systemId: "system.old", evolutionId: "", realizationId: "realization.8.r1" });
      const tables = state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((r) => r.name);
      expect(tables).not.toContain("registry_realizations");
    });
  });

  it("refuses registry calls on a System instance", async () => {
    await runInDurableObject(stub(), async (i: SystemAuthority, state) => {
      expect(() => i.resolveFork("x")).toThrow(/__registry/);
      const tables = state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((r) => r.name);
      expect(tables).not.toContain("registry_systems");
    });
  });
});
