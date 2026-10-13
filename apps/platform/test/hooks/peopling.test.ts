import { describe, expect, it } from "vitest";
import type { DerivationTree } from "@artyfact/model";
import { createSystemOne } from "@artyfact/semantic";
import type { CandidateRef, Evaluation, SubmissionContext } from "../../worker/hooks/contract";
import { loadGenome, modelRules } from "../../worker/hooks/model-rules";
import { createHookRunner, selectHooks } from "../../worker/hooks/run";
import { engineRules, engineRun } from "../../worker/hooks/engine-gates";
import { BASE, COMMIT, peopling, peoplingMany } from "./fixtures";

const relations = (t: DerivationTree, out: string[] = []): string[] => {
  out.push(t.relation);
  for (const c of t.children) relations(c, out);
  return out;
};

const SAVE = "thing.webapp/section.domain/operation.contact.save/node.yaml";
const EFFECT = "    - Save only that owner's record; editing does not send invitations\n";

describe("model-rules on the real Peopling Genome", () => {
  const base = loadGenome(peopling(), BASE);

  it("passes as committed", () => {
    const r = modelRules({ files: peopling(), revision: "peopling", base });
    expect(r.outcome).toMatchObject({ execution: "completed", verdict: "pass" });
  });

  it("fails topology.recipientArray through outgoingDirect when contact.save gets cardinality many", () => {
    const r = modelRules({ files: peoplingMany(), revision: "peopling-many", base });
    expect(r.outcome).toMatchObject({ execution: "completed", verdict: "fail" });
    const f = r.outcome.observations.find((o) => (o as { rule?: string }).rule === "topology.recipientArray") as { subject: string; derivation: DerivationTree };
    expect(f.subject).toBe("operation.contact.save");
    expect(relations(f.derivation)).toEqual(expect.arrayContaining(["outgoingDirect", "accountRefField", "acardinality"]));
  });

  it("the engine rules path fails the topology pack on it and passes the base Genome", () => {
    const r = engineRun(peoplingMany());
    const o = engineRules(r, { packs: ["topology.private-pairs@1"] });
    expect(o).toMatchObject({ execution: "completed", verdict: "fail" });
    expect(o.observations).toContainEqual(expect.objectContaining({ rule: "topology.recipientArray", subject: "operation.contact.save", pack: "artyfact.topology.private-pairs@1" }));
    expect(engineRules(r, { packs: ["metamodel@1"] }).verdict).toBe("pass");
    expect(engineRules(engineRun(peopling()), { packs: ["topology.private-pairs@1"] }).verdict).toBe("pass");
  });

  it("the engine rules path runs only the packs the System pins, as readiness does", () => {
    const files = peoplingMany();
    // The last pin under rulePacks (the kits list pins a kit of the same name first).
    files["node.yaml"] = files["node.yaml"].replace('    - id: topology.private-pairs\n      version: "1"\n  required:', "  required:");
    const r = engineRun(files);
    expect(r.template.rules.map((p) => p.id)).not.toContain("artyfact.topology.private-pairs");
    expect(r.readiness.findings.some((f) => f.rule === "topology.recipientArray")).toBe(false);
  });

  it("the topology hook (inputs.packs with a version) sees it; the structure hook does not; an unrun pack version is unknown", () => {
    const r = engineRun(peoplingMany());
    expect(engineRules(r, { packs: ["topology.private-pairs@1"] }).verdict).toBe("fail");
    expect(engineRules(r, { packs: ["artyfact.topology.private-pairs"] }).verdict).toBe("fail");
    expect(engineRules(r, { packs: ["metamodel@1"] }).verdict).toBe("pass");
    const v2 = engineRules(r, { packs: ["topology.private-pairs@2"] });
    expect(v2.verdict).toBe("unknown");
    expect(v2.observations).toContainEqual(expect.objectContaining({ kind: "packs-not-run", packs: ["topology.private-pairs@2"] }));
  });

  it("a rule filter that selects no rule is unknown, naming the filter, even when the Genome violates", () => {
    const r = engineRun(peoplingMany());
    const typo = engineRules(r, { rulePrefix: "topolgy." });
    expect(typo.verdict).toBe("unknown");
    expect(typo.interpretation).toBe('The hook\'s rule filter {"rulePrefix":"topolgy."} selects no rule in the template\'s packs; nothing was checked.');
    expect(engineRules(r, { rulePrefix: "topology." }).verdict).toBe("fail");
    expect(engineRules(r, { packs: ["metamodel@1"], rulePrefix: "topology." }).verdict).toBe("unknown");
  });
});

describe("hook selection and runSubmission on the real evolution.1", () => {
  const candidate: CandidateRef = {
    id: "cand.peopling.r1", realizationId: "realization.1.r1", evolutionId: "evolution.1", target: "app", commit: COMMIT, baseCommit: BASE,
    changedPaths: ["src/ui/people/PeopleScreen.tsx"], changedNodes: ["screen.people"], pathNodes: { "src/ui/people/PeopleScreen.tsx": ["screen.people"] },
  };
  const ctx = (over: Partial<SubmissionContext> = {}): SubmissionContext => ({
    systemId: "system.peopling", candidate, genomeCommit: BASE, genomeFiles: peopling(),
    tree: [{ path: "wrangler.jsonc", size: 1 }, { path: "src/index.ts", size: 1 }, { path: "package.json", size: 1 }],
    permittedPaths: ["src/ui/**"], protectedPaths: ["system/**", "assays/**"], openCandidates: [], ...over,
  });
  const by = (evs: Evaluation[], c: string) => evs.find((e) => e.criterion === c)!;

  it("selects acceptance criteria, the touched subject and every System submission gate", () => {
    const sel = selectHooks(loadGenome(peopling(), BASE), candidate);
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

  it("fails the rules gates when a pin names a pack version no template declares, as readiness does", async () => {
    const files = peopling();
    // The topology pin under rulePacks (the kits list pins a kit of the same name first) moves to a version nothing declares.
    files["node.yaml"] = files["node.yaml"].replace('    - id: topology.private-pairs\n      version: "1"\n  required:', '    - id: topology.private-pairs\n      version: "9"\n  required:');
    const runner = createHookRunner({ s1: createSystemOne({}), now: () => new Date(0) });
    const evs = await runner.runSubmission(ctx({ genomeFiles: files }));
    for (const c of ["C.system.structure", "C.system.topology", "C.system.readiness"]) {
      expect(by(evs, c).verdict, c).not.toBe("pass");
    }
    expect(by(evs, "C.system.structure").observations).toContainEqual(expect.objectContaining({ rule: "rulePack.unavailable", subject: "topology.private-pairs@9", level: "error" }));
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
    const files = peopling();
    const today = "thing.webapp/section.ui/screen.today/node.yaml";
    files[today] = files[today].replace("  - id: C.webapp.prompts.bounded\n", "  - id: C.webapp.prompts.bounded\n    deferred: true\n");
    expect(files[today]).toContain("deferred: true");
    const runner = createHookRunner({ s1: createSystemOne({}), now: () => new Date(0) });
    const e = by(await runner.runSubmission(ctx({ genomeFiles: files })), "C.system.autonomy");
    expect(e.verdict).toBe("fail");
    expect(e.observations).toContainEqual({ kind: "requires", missing: ["C.webapp.prompts.bounded"] });
  });

  it("the overlap hook reports a soft-semantic conflict on the real Genome as unknown", async () => {
    const runner = createHookRunner({ s1: createSystemOne({}), now: () => new Date(0) });
    const other: CandidateRef = { ...candidate, id: "cand.peopling.r2", realizationId: "realization.1.r2", changedPaths: ["src/worker/routes/contacts.ts"], changedNodes: ["policy.ownerOnly", "screen.people"] };
    const e = (await runner.runSubmission(ctx({ openCandidates: [other] }))).find((x) => x.hook === "hook.system.overlap")!;
    expect(e).toMatchObject({ execution: "completed", verdict: "unknown" });
    expect(e.observations).toContainEqual(expect.objectContaining({ kind: "soft-semantic", nodes: ["screen.people"] }));
  });

  it("topology semantic judges multi-recipient candidates of the canonical Genome when there are some", async () => {
    const files = peopling();
    const before = files[SAVE];
    files[SAVE] = before.replace(EFFECT, "    - \"Save only that owner's record and notify the recipient #s1harm\"\n");
    expect(files[SAVE]).not.toBe(before);
    const runner = createHookRunner({ s1: createSystemOne({ FAKE_S1: "1" }), now: () => new Date(0) });
    const e = (await runner.runSubmission(ctx({ genomeFiles: files }))).find((x) => x.hook === "hook.system.topology.semantic")!;
    // #s1harm makes the fake confirm "sends to several people" (noul 0.95) → topology unacceptable → fail.
    expect(e).toMatchObject({ execution: "completed", verdict: "fail" });
    expect(e.provenance.provider).toBe("fake");
  });

  it("flags inputs the System One route ignores", async () => {
    const runner = createHookRunner({ s1: createSystemOne({}), now: () => new Date(0) });
    const e = (await runner.runSubmission(ctx())).find((x) => x.hook === "hook.system.purpose.model")!;
    expect(e.limitations.join(" ")).toMatch(/hook inputs packs ignored/);
  });

  it("topology semantic with candidates flagged and the provider off is unknown", async () => {
    const files = peopling();
    files[SAVE] = files[SAVE].replace(EFFECT, "    - Save only that owner's record and notify the recipient\n");
    const runner = createHookRunner({ s1: createSystemOne({}), now: () => new Date(0) });
    const e = (await runner.runSubmission(ctx({ genomeFiles: files }))).find((x) => x.hook === "hook.system.topology.semantic")!;
    expect(e).toMatchObject({ execution: "completed", verdict: "unknown" });
    expect(e.provenance.provider).toBe("off");
  });

  it("topology semantic is unknown when the rules run errored (no vacuous pass without evidence)", async () => {
    const runner = createHookRunner({
      s1: createSystemOne({ FAKE_S1: "1" }), now: () => new Date(0),
      genome: { validate: () => { throw new Error("pack store unavailable"); } },
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
