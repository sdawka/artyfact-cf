import { describe, expect, it } from "vitest";
import { schema } from "@artyfact/model";
import { createSystemOne } from "@artyfact/semantic";
import type { CandidateRef, Evaluation, SubmissionContext } from "../../worker/hooks/contract";
import { createHookRunner, selectHooks } from "../../worker/hooks/run";
import { loadGenome } from "../../worker/hooks/model-rules";
import { BASE, COMMIT, miniGenome, withRecipients } from "./fixtures";

const appCandidate = (over: Partial<CandidateRef> = {}): CandidateRef => ({
  id: "cand.r1", realizationId: "realization.1.r1", evolutionId: "evolution.1", target: "app", commit: COMMIT, baseCommit: BASE,
  changedPaths: ["src/ui/people/PeopleScreen.tsx"], changedNodes: ["screen.people"], ...over,
});

const ctxFor = (candidate: CandidateRef, over: Partial<SubmissionContext> = {}): SubmissionContext => ({
  systemId: "system.mini-kit", candidate, genomeCommit: BASE, genomeFiles: miniGenome(),
  tree: [{ path: "wrangler.jsonc", size: 10 }, { path: "src/index.ts", size: 10 }, { path: "package.json", size: 10 }],
  permittedPaths: ["src/**"], protectedPaths: ["system/**", "assays/**"], openCandidates: [], ...over,
});

const fixedNow = () => new Date("2026-10-12T00:00:00.000Z");
const by = (evs: Evaluation[], criterion: string) => evs.filter((e) => e.criterion === criterion);

describe("hook selection", () => {
  const model = loadGenome(miniGenome(), BASE);

  it("evolution.1 touching screen.people selects acceptance, subject and System-gate criteria", () => {
    const sel = selectHooks(model, appCandidate());
    const pairs = sel.map((s) => `${s.criterion.id}|${s.hook?.id ?? "none"}|${s.run ? "run" : "not-run"}`);
    expect(pairs).toEqual([
      "C.webapp.exists|hook.webapp.exists|run",
      "C.webapp.health|hook.webapp.health|run",
      "C.webapp.private.owner|hook.webapp.private.owner|not-run",
      "C.webapp.contact.save|hook.webapp.contact.save|not-run",
      "C.webapp.screen.people|hook.webapp.screen.people|not-run",
      "C.system.structure|hook.system.structure|run",
      "C.system.promotion|hook.system.scope|run",
      "C.system.readiness|hook.system.overlap|run",
    ]);
    expect(sel.find((s) => s.criterion.id === "C.webapp.screen.people")?.reason).toBe("subject");
    expect(sel.find((s) => s.criterion.id === "C.webapp.contact.save")?.skip).toMatch(/vitest/);
  });

  it("does not select criteria of untouched subjects", () => {
    const sel = selectHooks(model, appCandidate({ changedNodes: ["screen.home"] }));
    expect(sel.map((s) => s.criterion.id)).not.toContain("C.webapp.screen.people");
  });
});

describe("runSubmission", () => {
  const runner = createHookRunner({ s1: createSystemOne({ FAKE_S1: "1" }), now: fixedNow, fetch: (async () => { throw new Error("no network in tests"); }) as unknown as typeof fetch });

  it("returns one schema-valid Evaluation per selected (hook, criterion), required ones grey not missing", async () => {
    const evs = await runner.runSubmission(ctxFor(appCandidate()));
    for (const e of evs) expect(() => schema.Evaluation.parse(e)).not.toThrow();
    expect(evs.map((e) => e.criterion)).toEqual([
      "C.webapp.exists", "C.webapp.health", "C.webapp.private.owner", "C.webapp.contact.save",
      "C.webapp.screen.people", "C.system.structure", "C.system.promotion", "C.system.readiness",
    ]);
    expect(by(evs, "C.webapp.exists")[0]).toMatchObject({ execution: "completed", verdict: "pass", verifier: "artyfact-platform", hook: "hook.webapp.exists", id: "cand.r1:hook.webapp.exists:C.webapp.exists" });
    expect(by(evs, "C.webapp.health")[0]).toMatchObject({ execution: "not-run", verdict: "unknown" });
    expect(by(evs, "C.webapp.screen.people")[0]).toMatchObject({ execution: "not-run", verdict: "unknown" });
    expect(by(evs, "C.webapp.contact.save")[0]).toMatchObject({ execution: "not-run", verdict: "unknown" });
    expect(by(evs, "C.system.structure")[0]).toMatchObject({ execution: "completed", verdict: "pass", targetRef: `genome@${BASE}` });
    expect(by(evs, "C.system.promotion")[0]).toMatchObject({ execution: "completed", verdict: "pass" });
    expect(by(evs, "C.system.readiness")[0]).toMatchObject({ execution: "completed", verdict: "pass" });
    expect(evs.every((e) => e.startedAt === "2026-10-12T00:00:00.000Z" && e.provenance.engineVersion === "1")).toBe(true);
  });

  it("records an http transport error as execution error, never pass", async () => {
    const evs = await runner.runSubmission(ctxFor(appCandidate({ previewUrl: "https://preview.example" })));
    const h = by(evs, "C.webapp.health")[0];
    expect(h).toMatchObject({ execution: "error", verdict: "unknown" });
    expect(JSON.stringify(h.observations)).toContain("no network in tests");
  });

  it("an engine that throws becomes execution error with the message", async () => {
    const boom = createHookRunner({ now: fixedNow, s1: createSystemOne({}), fetch: (async () => new Response("{}")) as unknown as typeof fetch });
    const bad = ctxFor(appCandidate(), { tree: null as unknown as [] });
    const e = by(await boom.runSubmission(bad), "C.webapp.exists")[0];
    expect(e).toMatchObject({ execution: "error", verdict: "unknown" });
    expect(JSON.stringify(e.observations)).toMatch(/TypeError/);
  });

  it("fails scope with 'Genome amendment required' when an app candidate edits system/**", async () => {
    const c = appCandidate({ changedPaths: ["system/things/webapp/ontology.yaml"], changedNodes: ["genome"] });
    const e = by(await runner.runSubmission(ctxFor(c)), "C.system.promotion")[0];
    expect(e.verdict).toBe("fail");
    expect(e.interpretation).toContain("Genome amendment required");
  });

  it("a soft-semantic overlap makes the overlap evaluation unknown, with the report in observations", async () => {
    const other = appCandidate({ id: "cand.r2", realizationId: "realization.1.r2", changedPaths: ["src/worker/routes/contacts.ts"], changedNodes: ["screen.people"] });
    const e = by(await runner.runSubmission(ctxFor(appCandidate(), { openCandidates: [other] })), "C.system.readiness")[0];
    expect(e).toMatchObject({ execution: "completed", verdict: "unknown" });
    expect(e.observations).toContainEqual(expect.objectContaining({ kind: "soft-semantic", candidates: ["cand.r1", "cand.r2"] }));
  });

  it("an unloadable open candidate makes the overlap evaluation unknown, never pass", async () => {
    const broken = appCandidate({ id: "cand.g9", target: "genome", changedPaths: ["system.yaml"], changedNodes: [], genomeFiles: { ...miniGenome(), "system.yaml": "id: 1\n" } });
    const e = by(await runner.runSubmission(ctxFor(appCandidate(), { openCandidates: [broken] })), "C.system.readiness")[0];
    expect(e).toMatchObject({ execution: "completed", verdict: "unknown" });
    expect(e.limitations.join(" ")).toMatch(/could not be fully determined/);
  });

  it("emits a not-run evaluation for an acceptance criterion missing from the Genome", async () => {
    const files = miniGenome();
    files["evolutions/evolution.1.yaml"] = files["evolutions/evolution.1.yaml"].replace("C.webapp.contact.save]", "C.webapp.contact.save, C.webapp.ghost]");
    const evs = await runner.runSubmission(ctxFor(appCandidate(), { genomeFiles: files }));
    expect(by(evs, "C.webapp.ghost")[0]).toMatchObject({ execution: "not-run", verdict: "unknown", hook: "none" });
  });
});

describe("runGenome", () => {
  const genomeCandidate = (files: Record<string, string>, over: Partial<CandidateRef> = {}): CandidateRef =>
    appCandidate({ id: "cand.g1", target: "genome", changedPaths: ["things/webapp/ontology.yaml"], changedNodes: [], genomeFiles: files, ...over });

  it("fails model-rules on a recipients list and attaches review signals", async () => {
    const runner = createHookRunner({ s1: createSystemOne({ FAKE_S1: "1" }), now: fixedNow });
    const r = await runner.runGenome(ctxFor(genomeCandidate(withRecipients()), { permittedPaths: ["**"] }));
    expect(r.readiness.actionable).toBe(false);
    expect(r.readiness.findings.some((f) => f.rule === "topology.recipientArray")).toBe(true);
    const structure = by(r.evaluations, "C.system.structure")[0];
    expect(structure).toMatchObject({ execution: "completed", verdict: "fail", targetRef: `genome@${COMMIT}` });
    expect(r.review.find((x) => x.judgment === "reviewDelta" && x.subject === "entity.ContactRecord")?.signals.provenance.provider).toBe("fake");
  });

  it("#s1pick:hard-rule-violation → reviewDelta level error", async () => {
    const files = miniGenome();
    files["things/webapp/ontology.yaml"] = files["things/webapp/ontology.yaml"].replace("name: Due list }", "name: Due list, description: \"Sends to everyone #s1pick:hard-rule-violation\" }");
    const runner = createHookRunner({ s1: createSystemOne({ FAKE_S1: "1" }), now: fixedNow });
    const r = await runner.runGenome(ctxFor(genomeCandidate(files), { permittedPaths: ["**"] }));
    const rev = r.review.find((x) => x.subject === "component.DueList");
    expect(rev).toMatchObject({ judgment: "reviewDelta", level: "error", verdict: "fail" });
    expect(by(r.evaluations, "C.system.structure")[0].verdict).toBe("pass");
  });

  it("provider off → review unknown with provenance off, never a throw", async () => {
    const files = miniGenome();
    files["things/webapp/ontology.yaml"] = files["things/webapp/ontology.yaml"].replace("name: Due list }", "name: Due list, description: changed }");
    const runner = createHookRunner({ s1: createSystemOne({}), now: fixedNow });
    const r = await runner.runGenome(ctxFor(genomeCandidate(files), { permittedPaths: ["**"] }));
    expect(r.review.length).toBeGreaterThan(0);
    for (const x of r.review) {
      expect(x.verdict).toBe("unknown");
      expect(x.signals.provenance.provider).toBe("off");
    }
  });

  it("a Genome candidate that does not parse yields a failing structure evaluation and a non-actionable readiness", async () => {
    const runner = createHookRunner({ s1: createSystemOne({}), now: fixedNow });
    const r = await runner.runGenome(ctxFor(genomeCandidate({ ...miniGenome(), "system.yaml": "id: 1\n" }), { permittedPaths: ["**"] }));
    expect(r.readiness.actionable).toBe(false);
    expect(r.readiness.findings[0]).toMatchObject({ level: "error", rule: "genome.parse" });
    expect(by(r.evaluations, "C.system.structure")[0]).toMatchObject({ execution: "completed", verdict: "fail" });
    expect(r.review).toEqual([]);
  });

  it("rejects a Genome candidate without files loudly", async () => {
    const runner = createHookRunner({ s1: createSystemOne({}), now: fixedNow });
    await expect(runner.runGenome(ctxFor(genomeCandidate(undefined as unknown as Record<string, string>)))).rejects.toThrow(/genomeFiles/);
  });

  it("an llm hook folds the review into one evaluation via policy", async () => {
    const files = miniGenome();
    files["criteria.yaml"] = files["criteria.yaml"].replace("hooks:\n", [
      "  - id: C.system.review",
      "    title: Amendments are reviewed",
      "    claim: System One finds no contradiction with commitments.",
      "    ownerKind: system",
      "    ownerId: system.mini-kit",
      "    subjectKind: system",
      "    subjectId: system.mini-kit",
      "    targetKind: model",
      "    gates: [submission]",
      "    hooks: [hook.system.review]",
      "hooks:",
      "  - id: hook.system.review",
      "    assay: System One delta review",
      "    criteria: [C.system.review]",
      "    tier: semantic",
      "    engine: llm",
      "    targetKind: model",
      "    triggers: [submission]",
      "    inputs: { judgment: reviewDelta }",
      "",
    ].join("\n"));
    const cand = { ...files };
    cand["things/webapp/ontology.yaml"] = cand["things/webapp/ontology.yaml"].replace("name: Due list }", "name: Due list, description: \"#s1pick:hard-rule-violation\" }");
    const runner = createHookRunner({ s1: createSystemOne({ FAKE_S1: "1" }), now: fixedNow });
    const r = await runner.runGenome(ctxFor(genomeCandidate(cand), { genomeFiles: files, permittedPaths: ["**"] }));
    const e = by(r.evaluations, "C.system.review")[0];
    expect(e).toMatchObject({ execution: "completed", verdict: "fail" });
    expect(e.provenance.provider).toBe("fake");

    const off = createHookRunner({ s1: createSystemOne({}), now: fixedNow });
    const r2 = await off.runGenome(ctxFor(genomeCandidate(cand), { genomeFiles: files, permittedPaths: ["**"] }));
    expect(by(r2.evaluations, "C.system.review")[0]).toMatchObject({ verdict: "unknown" });
    expect(by(r2.evaluations, "C.system.review")[0].provenance.provider).toBe("off");
  });
});
