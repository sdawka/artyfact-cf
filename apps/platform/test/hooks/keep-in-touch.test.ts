import { describe, expect, it } from "vitest";
import type { DerivationTree } from "@artyfact/model";
import { createSystemOne } from "@artyfact/semantic";
import type { CandidateRef, Evaluation, SubmissionContext } from "../../worker/hooks/contract";
import { loadGenome, modelRules } from "../../worker/hooks/model-rules";
import { createHookRunner, selectHooks } from "../../worker/hooks/run";
import { BASE, COMMIT, keepInTouch, keepInTouchMany } from "./fixtures";

const relations = (t: DerivationTree, out: string[] = []): string[] => {
  out.push(t.relation);
  for (const c of t.children) relations(c, out);
  return out;
};

describe("model-rules on the real Keep in Touch Genome", () => {
  const base = loadGenome(keepInTouch(), BASE);

  it("passes as committed", () => {
    const r = modelRules({ files: keepInTouch(), revision: "kit", base });
    expect(r.outcome).toMatchObject({ execution: "completed", verdict: "pass" });
  });

  it("fails topology.recipientArray through outgoingDirect when contact.save gets cardinality many", () => {
    const r = modelRules({ files: keepInTouchMany(), revision: "kit-many", base });
    expect(r.outcome).toMatchObject({ execution: "completed", verdict: "fail" });
    const f = r.outcome.observations.find((o) => (o as { rule?: string }).rule === "topology.recipientArray") as { subject: string; derivation: DerivationTree };
    expect(f.subject).toBe("operation.contact.save");
    expect(relations(f.derivation)).toEqual(expect.arrayContaining(["outgoingDirect", "accountRefField", "cardinality"]));
  });

  it("the topology hook (inputs.packs with a version) sees it; the structure hook does not; an unpinned pack is unknown", () => {
    expect(modelRules({ files: keepInTouchMany(), revision: "m", filter: { packs: ["topology.private-pairs@1"] } }).outcome.verdict).toBe("fail");
    expect(modelRules({ files: keepInTouchMany(), revision: "m", filter: { packs: ["metamodel@1"] } }).outcome.verdict).toBe("pass");
    expect(modelRules({ files: keepInTouchMany(), revision: "m", filter: { packs: ["topology.private-pairs@2"] } }).outcome.verdict).toBe("unknown");
  });

  it("a rule filter that selects no rule is unknown, naming the filter, even when the Genome violates", () => {
    const typo = modelRules({ files: keepInTouchMany(), revision: "m", filter: { rulePrefix: "topolgy." } });
    expect(typo.outcome.verdict).toBe("unknown");
    expect(typo.outcome.observations).toContainEqual(expect.objectContaining({ kind: "filter-selects-no-rules", filter: { rulePrefix: "topolgy." } }));
    const ok = modelRules({ files: keepInTouchMany(), revision: "m", filter: { rulePrefix: "topology." } });
    expect(ok.outcome.verdict).toBe("fail");
    const wrongPack = modelRules({ files: keepInTouchMany(), revision: "m", filter: { packs: ["metamodel@1"], rulePrefix: "topology." } });
    expect(wrongPack.outcome.verdict).toBe("unknown");
  });
});

describe("hook selection and runSubmission on the real evolution.1", () => {
  const candidate: CandidateRef = {
    id: "cand.kit.r1", realizationId: "realization.1.r1", evolutionId: "evolution.1", target: "app", commit: COMMIT, baseCommit: BASE,
    changedPaths: ["src/ui/people/PeopleScreen.tsx"], changedNodes: ["screen.people"], pathNodes: { "src/ui/people/PeopleScreen.tsx": ["screen.people"] },
  };
  const ctx = (over: Partial<SubmissionContext> = {}): SubmissionContext => ({
    systemId: "system.keep-in-touch", candidate, genomeCommit: BASE, genomeFiles: keepInTouch(),
    tree: [{ path: "wrangler.jsonc", size: 1 }, { path: "src/index.ts", size: 1 }, { path: "package.json", size: 1 }],
    permittedPaths: ["src/ui/**"], protectedPaths: ["system/**", "assays/**"], openCandidates: [], ...over,
  });
  const by = (evs: Evaluation[], c: string) => evs.find((e) => e.criterion === c)!;

  it("selects acceptance criteria, the touched subject and every System submission gate", () => {
    const sel = selectHooks(loadGenome(keepInTouch(), BASE), candidate);
    const crit = [...new Set(sel.map((s) => s.criterion.id))];
    expect(crit.slice(0, 7)).toEqual([
      "C.webapp.exists", "C.webapp.health", "C.webapp.private.owner", "C.webapp.screen.exact",
      "C.webapp.contact.save", "C.webapp.screen.people", "C.webapp.contact.storage",
    ]);
    expect(crit).toEqual(expect.arrayContaining(["C.system.structure", "C.system.topology", "C.system.autonomy", "C.system.readiness", "C.system.promotion", "C.system.purpose", "C.system.concurrency"]));
    expect(sel.find((s) => s.hook?.id === "hook.system.overlap")).toMatchObject({ run: true, reason: "system-gate", criterion: expect.objectContaining({ id: "C.system.concurrency" }) });
    expect(sel.find((s) => s.hook?.id === "hook.system.topology.semantic")).toMatchObject({ run: true, criterion: expect.objectContaining({ id: "C.system.topology" }) });
    expect(sel.find((s) => s.hook?.id === "hook.system.topology")).toMatchObject({ run: true });
    expect(sel.find((s) => s.hook?.id === "hook.system.promotion")).toMatchObject({ run: true });
    const outcome = sel.find((s) => s.hook?.id === "hook.system.purpose.outcome");
    expect(outcome).toMatchObject({ run: false });
    expect(sel.find((s) => s.hook?.id === "hook.system.purpose.model")).toMatchObject({ run: true });
  });

  it("produces the expected evaluations", async () => {
    const runner = createHookRunner({ s1: createSystemOne({ FAKE_S1: "1" }), now: () => new Date(0) });
    const evs = await runner.runSubmission(ctx());
    expect(by(evs, "C.webapp.exists")).toMatchObject({ execution: "completed", verdict: "pass" });
    expect(by(evs, "C.webapp.health")).toMatchObject({ execution: "not-run", verdict: "unknown" });
    expect(by(evs, "C.webapp.screen.people")).toMatchObject({ execution: "not-run", verdict: "unknown" });
    expect(by(evs, "C.webapp.contact.save")).toMatchObject({ execution: "not-run", verdict: "unknown" });
    for (const c of ["C.system.structure", "C.system.topology", "C.system.readiness"]) expect(by(evs, c)).toMatchObject({ execution: "completed", verdict: "pass" });
    expect(by(evs, "C.system.autonomy")).toMatchObject({ execution: "completed", verdict: "pass" });
    // Promotion checks at submission: scope passes, the promotion-only facts are not supplied → unknown overall.
    const promo = by(evs, "C.system.promotion");
    expect(promo).toMatchObject({ execution: "completed", verdict: "unknown" });
    expect(promo.observations).toContainEqual(expect.objectContaining({ check: "scope-authorized", verdict: "pass" }));
    expect(promo.observations).toContainEqual(expect.objectContaining({ check: "base-current", execution: "not-run" }));
    // Overlap hook: no other open candidates → pass; a soft conflict → unknown.
    expect(evs.find((e) => e.hook === "hook.system.overlap")).toMatchObject({ criterion: "C.system.concurrency", execution: "completed", verdict: "pass" });
    // Topology semantic: a sound rules run flagged no multi-recipient candidates → vacuous pass by that evidence.
    const topoS1 = evs.find((e) => e.hook === "hook.system.topology.semantic")!;
    expect(topoS1).toMatchObject({ criterion: "C.system.topology", execution: "completed", verdict: "pass" });
    expect(topoS1.observations).toEqual([{ semanticCandidates: 0, rulesRun: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect(topoS1.limitations).toContain("vacuous: no candidates flagged by the rules; nothing was judged");
    expect(topoS1.limitations.join(" ")).toMatch(/inputs\.judgment is not set; ran topology/);
    const purpose = evs.find((e) => e.hook === "hook.system.purpose.model")!;
    expect(purpose.execution).toBe("completed");
    expect(purpose.provenance.provider).toBe("fake");
  });

  it("C.system.promotion passes when the DO supplies the promotion facts, and fails on a stale base", async () => {
    const runner = createHookRunner({ s1: createSystemOne({}), now: () => new Date(0) });
    const ok = by(await runner.runSubmission(ctx({ promotionFacts: { currentBaseCommit: BASE, manifestExact: true, evidenceFresh: true } })), "C.system.promotion");
    expect(ok).toMatchObject({ execution: "completed", verdict: "pass" });
    const stale = by(await runner.runSubmission(ctx({ promotionFacts: { currentBaseCommit: "other", manifestExact: true, evidenceFresh: true } })), "C.system.promotion");
    expect(stale.verdict).toBe("fail");
    expect(stale.interpretation).toMatch(/base-current/);
  });

  it("C.system.autonomy fails when a required criterion is missing", async () => {
    const files = keepInTouch();
    files["things/webapp/criteria.yaml"] = files["things/webapp/criteria.yaml"].replace(/hooks: \[hook\.webapp\.prompts\.bounded\]/, "hooks: [hook.webapp.prompts.bounded]\n    deferred: true");
    expect(files["things/webapp/criteria.yaml"]).toContain("deferred: true");
    const runner = createHookRunner({ s1: createSystemOne({}), now: () => new Date(0) });
    const e = by(await runner.runSubmission(ctx({ genomeFiles: files })), "C.system.autonomy");
    expect(e.verdict).toBe("fail");
    expect(e.observations).toContainEqual({ kind: "requires", missing: ["C.webapp.prompts.bounded"] });
  });

  it("the overlap hook reports a soft-semantic conflict on the real Genome as unknown", async () => {
    const runner = createHookRunner({ s1: createSystemOne({}), now: () => new Date(0) });
    const other: CandidateRef = { ...candidate, id: "cand.kit.r2", realizationId: "realization.1.r2", changedPaths: ["src/worker/routes/contacts.ts"], changedNodes: ["policy.ownerOnly", "screen.people"] };
    const e = (await runner.runSubmission(ctx({ openCandidates: [other] }))).find((x) => x.hook === "hook.system.overlap")!;
    expect(e).toMatchObject({ execution: "completed", verdict: "unknown" });
    expect(e.observations).toContainEqual(expect.objectContaining({ kind: "soft-semantic", nodes: ["screen.people"] }));
  });

  it("topology semantic judges multi-recipient candidates of the canonical Genome when there are some", async () => {
    const files = keepInTouch();
    const before = files["things/webapp/ontology.yaml"];
    files["things/webapp/ontology.yaml"] = before.replace(
      "    effects: [Save only that owner's record; editing does not send invitations,", "    effects: [Save only that owner's record and notify the recipient,");
    expect(files["things/webapp/ontology.yaml"]).not.toBe(before);
    const runner = createHookRunner({ s1: createSystemOne({ FAKE_S1: "1" }), now: () => new Date(0) });
    const e = (await runner.runSubmission(ctx({ genomeFiles: files }))).find((x) => x.hook === "hook.system.topology.semantic")!;
    // The fake confirms "sends to several people" (noul 0.95) → topology unacceptable → fail.
    expect(e).toMatchObject({ execution: "completed", verdict: "fail" });
    expect(e.provenance.provider).toBe("fake");
  });

  it("flags inputs the System One route ignores", async () => {
    const runner = createHookRunner({ s1: createSystemOne({}), now: () => new Date(0) });
    const e = (await runner.runSubmission(ctx())).find((x) => x.hook === "hook.system.purpose.model")!;
    expect(e.limitations.join(" ")).toMatch(/hook inputs packs ignored/);
  });

  it("topology semantic with candidates flagged and the provider off is unknown", async () => {
    const files = keepInTouch();
    files["things/webapp/ontology.yaml"] = files["things/webapp/ontology.yaml"].replace(
      "    effects: [Save only that owner's record; editing does not send invitations,", "    effects: [Save only that owner's record and notify the recipient,");
    const runner = createHookRunner({ s1: createSystemOne({}), now: () => new Date(0) });
    const e = (await runner.runSubmission(ctx({ genomeFiles: files }))).find((x) => x.hook === "hook.system.topology.semantic")!;
    expect(e).toMatchObject({ execution: "completed", verdict: "unknown" });
    expect(e.provenance.provider).toBe("off");
  });

  it("topology semantic is unknown when the rules run errored (no vacuous pass without evidence)", async () => {
    const runner = createHookRunner({
      s1: createSystemOne({ FAKE_S1: "1" }), now: () => new Date(0),
      genome: { packsFor: () => { throw new Error("pack store unavailable"); } },
    });
    const e = (await runner.runSubmission(ctx())).find((x) => x.hook === "hook.system.topology.semantic")!;
    expect(e).toMatchObject({ execution: "completed", verdict: "unknown" });
    expect(e.interpretation).toMatch(/rules run failed|did not complete/);
  });

  it("system-one engine with provider off is unknown with provenance off", async () => {
    const runner = createHookRunner({ s1: createSystemOne({}), now: () => new Date(0) });
    const e = (await runner.runSubmission(ctx())).find((x) => x.hook === "hook.system.purpose.model")!;
    expect(e).toMatchObject({ execution: "completed", verdict: "unknown" });
    expect(e.provenance.provider).toBe("off");
  });
});
