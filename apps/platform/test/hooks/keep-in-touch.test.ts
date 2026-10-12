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
});

describe("hook selection and runSubmission on the real evolution.1", () => {
  const candidate: CandidateRef = {
    id: "cand.kit.r1", realizationId: "realization.1.r1", evolutionId: "evolution.1", target: "app", commit: COMMIT, baseCommit: BASE,
    changedPaths: ["src/ui/people/PeopleScreen.tsx"], changedNodes: ["screen.people"],
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
    expect(crit).toEqual(expect.arrayContaining(["C.system.structure", "C.system.topology", "C.system.autonomy", "C.system.readiness", "C.system.promotion", "C.system.purpose"]));
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

  it("system-one engine with provider off is unknown with provenance off", async () => {
    const runner = createHookRunner({ s1: createSystemOne({}), now: () => new Date(0) });
    const e = (await runner.runSubmission(ctx())).find((x) => x.hook === "hook.system.purpose.model")!;
    expect(e).toMatchObject({ execution: "completed", verdict: "unknown" });
    expect(e.provenance.provider).toBe("off");
  });
});
