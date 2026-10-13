import { describe, expect, it } from "vitest";
import { schema } from "@artyfact/model";
import { createSystemOne } from "@artyfact/semantic";
import type { CandidateRef, Evaluation, EvolutionRef, SubmissionContext } from "../../worker/hooks/contract";
import { createHookRunner, selectHooks } from "../../worker/hooks/run";
import { loadGenome } from "../../worker/hooks/model-rules";
import { gateCriteria } from "../../worker/promotion";
import { BASE, COMMIT, miniGenome, withRecipients } from "./fixtures";

const appCandidate = (over: Partial<CandidateRef> = {}): CandidateRef => ({
  id: "cand.r1", realizationId: "realization.1.r1", evolutionId: "evolution.1", target: "app", commit: COMMIT, baseCommit: BASE,
  changedPaths: ["src/ui/people/PeopleScreen.tsx"], changedNodes: ["screen.people"], pathNodes: { "src/ui/people/PeopleScreen.tsx": ["screen.people"] }, ...over,
});

const ctxFor = (candidate: CandidateRef, over: Partial<SubmissionContext> = {}): SubmissionContext => ({
  systemId: "system.mini-peopling", candidate, genomeCommit: BASE, genomeFiles: miniGenome(),
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

  it("runs a hook triggered only on promotion at the promotion re-run, never at submission", () => {
    const promotionOnly = { ...model, hooks: model.hooks.map((h) => (h.id === "hook.webapp.exists" ? { ...h, triggers: ["promotion" as const] } : h)) };
    const at = (trigger?: "submission" | "promotion") => selectHooks(promotionOnly, appCandidate(), trigger).find((s) => s.hook?.id === "hook.webapp.exists")!;
    expect(at()).toMatchObject({ run: false, skip: expect.stringMatching(/do not include submission or candidate/) });
    expect(at("submission").run).toBe(false);
    expect(at("promotion")).toMatchObject({ run: true });
    expect(at("promotion").skip).toBeUndefined();
  });
});

describe("hook selection: the DO's Evolution record (API-created evolutions)", () => {
  const model = loadGenome(miniGenome(), BASE);
  const stored = (over: Partial<EvolutionRef> = {}): EvolutionRef => ({
    id: "evolution.api", kind: "implementation", acceptanceCriteria: ["C.webapp.health"], affectedNodes: ["screen.people"], state: "actionable", ...over,
  });
  const ids = (sel: ReturnType<typeof selectHooks>) => sel.map((s) => `${s.criterion.id}|${s.reason}`);

  it("falls back to the stored Evolution when the Genome does not declare it", () => {
    const sel = selectHooks(model, appCandidate({ evolutionId: "evolution.api", changedNodes: [] }), "submission", stored());
    expect(ids(sel)).toEqual(["C.webapp.health|acceptance", "C.system.structure|system-gate", "C.system.promotion|system-gate", "C.system.readiness|system-gate", "C.webapp.exists|promotion-gate"]);
    expect(sel.every((s) => s.notes.length === 0)).toBe(true);
  });

  it("uses the stored record's criteria over the Genome's Evolution with the same id (a task's criteria)", () => {
    const genomeEvo = model.evolutions.find((e) => e.id === "evolution.1")!;
    expect(selectHooks(model, appCandidate(), "submission", stored({ id: "evolution.1", acceptanceCriteria: genomeEvo.acceptanceCriteria }))).toEqual(selectHooks(model, appCandidate()));
    const task = selectHooks(model, appCandidate(), "submission", stored({ id: "evolution.1", acceptanceCriteria: ["C.webapp.health"] }));
    expect(ids(task)).toContain("C.webapp.health|acceptance");
    expect(ids(task)).not.toContain("C.people.list|acceptance");
  });

  it("selects every criterion that blocks promotion, whatever the task lists, and only model ones for a Genome candidate", () => {
    const blocking = gateCriteria(model, { acceptanceCriteria: ["C.webapp.health"] }, appCandidate()).filter((g) => g.blocking).map((g) => g.id);
    expect(blocking).toContain("C.webapp.exists");
    const task = selectHooks(model, appCandidate(), "submission", stored({ id: "evolution.1", acceptanceCriteria: ["C.webapp.health"] }));
    for (const id of blocking) expect(task.map((s) => s.criterion.id), id).toContain(id);
    expect(ids(task)).toContain("C.webapp.exists|promotion-gate");
    const genome = selectHooks(model, appCandidate({ target: "genome" }), "submission", stored({ id: "evolution.1", acceptanceCriteria: [] }));
    expect(genome.map((s) => s.criterion.id)).not.toContain("C.webapp.exists");
  });

  it("ignores a stored record for another Evolution, and an id known nowhere stays C.evolution-missing", () => {
    for (const s of [undefined, stored({ id: "evolution.other" })]) {
      const sel = selectHooks(model, appCandidate({ evolutionId: "evolution.api", changedNodes: [] }), "submission", s);
      expect(sel[0]).toMatchObject({ criterion: { id: "C.evolution-missing.evolution.api" }, hook: null, run: false, reason: "acceptance" });
      expect(ids(sel)).not.toContain("C.webapp.health|acceptance");
    }
  });

  it("an acceptance id the Genome lacks is a phantom `none` evaluation, never a throw", async () => {
    const runner = createHookRunner({ s1: createSystemOne({}), now: fixedNow, fetch: (async () => { throw new Error("no network in tests"); }) as unknown as typeof fetch });
    const candidate = appCandidate({ evolutionId: "evolution.api", changedNodes: [] });
    const evs = await runner.runSubmission(ctxFor(candidate, { evolution: stored({ acceptanceCriteria: ["C.gone", "C.webapp.health"] }) }));
    expect(by(evs, "C.gone")[0]).toMatchObject({ hook: "none", execution: "not-run", verdict: "unknown" });
    expect(by(evs, "C.gone")[0].limitations.join(" ")).toMatch(/C\.gone is not defined in the Genome/);
    expect(by(evs, "C.webapp.health")[0]).toMatchObject({ hook: "hook.webapp.health", execution: "not-run", verdict: "unknown" });
    expect(evs.some((e) => e.criterion.startsWith("C.evolution-missing"))).toBe(false);
    const missing = await runner.runSubmission(ctxFor(candidate));
    expect(by(missing, "C.evolution-missing.evolution.api")[0]).toMatchObject({ hook: "none", execution: "not-run", verdict: "unknown" });
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
    expect(evs.every((e) => e.startedAt === "2026-10-12T00:00:00.000Z" && e.provenance.engineVersion === "2")).toBe(true);
  });

  it("records an http transport error as execution error, never pass", async () => {
    const evs = await runner.runSubmission(ctxFor(appCandidate({ previewUrl: "https://peopling-app-r1.acct.workers.dev" })));
    const h = by(evs, "C.webapp.health")[0];
    expect(h).toMatchObject({ execution: "error", verdict: "unknown" });
    expect(JSON.stringify(h.observations)).toContain("no network in tests");
  });

  it("previewEnv reaches the health policy; a default runner rejects the same host", async () => {
    const ok = (async () => new Response(JSON.stringify({ status: "ok", buildId: COMMIT }))) as unknown as typeof fetch;
    const c = appCandidate({ previewUrl: "https://p.example.com" });
    const allowed = createHookRunner({ previewEnv: { PREVIEW_HOST_ALLOWLIST: "p.example.com" }, fetch: ok, now: fixedNow, s1: createSystemOne({}) });
    expect(by(await allowed.runSubmission(ctxFor(c)), "C.webapp.health")[0]).toMatchObject({ execution: "completed", verdict: "pass" });
    const deflt = createHookRunner({ fetch: ok, now: fixedNow, s1: createSystemOne({}) });
    const e = by(await deflt.runSubmission(ctxFor(c)), "C.webapp.health")[0];
    expect(e).toMatchObject({ execution: "completed", verdict: "fail" });
    expect(e.observations[0]).toMatch(/previewUrl rejected: host p\.example\.com is not on the preview allowlist/);
  });

  it("an engine that throws becomes execution error with the message", async () => {
    const boom = createHookRunner({ now: fixedNow, s1: createSystemOne({}), fetch: (async () => new Response("{}")) as unknown as typeof fetch });
    const bad = ctxFor(appCandidate(), { tree: null as unknown as [] });
    const e = by(await boom.runSubmission(bad), "C.webapp.exists")[0];
    expect(e).toMatchObject({ execution: "error", verdict: "unknown" });
    expect(JSON.stringify(e.observations)).toMatch(/TypeError/);
  });

  it("fails scope with 'Genome amendment required' when an app candidate edits system/**", async () => {
    const c = appCandidate({ changedPaths: ["system/thing.webapp/node.yaml"], changedNodes: ["genome"] });
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
    const broken = appCandidate({ id: "cand.g9", target: "genome", changedPaths: ["node.yaml"], changedNodes: [], genomeFiles: { ...miniGenome(), "node.yaml": "id: 1\n" } });
    const e = by(await runner.runSubmission(ctxFor(appCandidate(), { openCandidates: [broken] })), "C.system.readiness")[0];
    expect(e).toMatchObject({ execution: "completed", verdict: "unknown" });
    expect(e.limitations.join(" ")).toMatch(/could not be fully determined/);
  });

  it("emits a not-run evaluation when the Evolution is missing from the Genome", async () => {
    const evs = await runner.runSubmission(ctxFor(appCandidate({ evolutionId: "evolution.99" })));
    const e = evs.find((x) => x.criterion === "C.evolution-missing.evolution.99");
    expect(e).toMatchObject({ execution: "not-run", verdict: "unknown", hook: "none" });
    expect(e!.limitations.join(" ")).toMatch(/evolution\.99 is not in the Genome/);
  });

  it("flags an inferred diff mode in limitations", async () => {
    const files = miniGenome();
    files["node.yaml"] = files["node.yaml"].replace("        inputs:\n          mode: overlap\n", "");
    const e = by(await runner.runSubmission(ctxFor(appCandidate(), { genomeFiles: files })), "C.system.readiness")[0];
    expect(e.limitations.join(" ")).toMatch(/inputs\.mode is not set; ran as overlap/);
  });

  it("emits a not-run evaluation for an acceptance criterion missing from the Genome", async () => {
    const files = miniGenome();
    files["evolutions/evolution.1.yaml"] = files["evolutions/evolution.1.yaml"].replace("C.webapp.contact.save]", "C.webapp.contact.save, C.webapp.ghost]");
    const evs = await runner.runSubmission(ctxFor(appCandidate(), { genomeFiles: files }));
    expect(by(evs, "C.webapp.ghost")[0]).toMatchObject({ execution: "not-run", verdict: "unknown", hook: "none" });
  });
});

const DUE_LIST = "thing.webapp/section.ui/screen.home/component.DueList/node.yaml";
const describeDueList = (files: Record<string, string>, description: string) =>
  files[DUE_LIST].replace("  name: Due list\n", `  name: Due list\n  description: ${JSON.stringify(description)}\n`);
/** The root `node.yaml` with more System criteria (its `criteria` list is the file's last key). */
const withSystemCriteria = (files: Record<string, string>, lines: string[]) => `${files["node.yaml"]}${lines.join("\n")}\n`;

describe("runGenome", () => {
  const genomeCandidate = (files: Record<string, string>, over: Partial<CandidateRef> = {}): CandidateRef =>
    appCandidate({ id: "cand.g1", target: "genome", changedPaths: [DUE_LIST], changedNodes: [], genomeFiles: files, ...over });

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
    files[DUE_LIST] = describeDueList(files, "Sends to everyone #s1pick:hard-rule-violation");
    const runner = createHookRunner({ s1: createSystemOne({ FAKE_S1: "1" }), now: fixedNow });
    const r = await runner.runGenome(ctxFor(genomeCandidate(files), { permittedPaths: ["**"] }));
    const rev = r.review.find((x) => x.subject === "component.DueList");
    expect(rev).toMatchObject({ judgment: "reviewDelta", level: "error", verdict: "fail" });
    expect(by(r.evaluations, "C.system.structure")[0].verdict).toBe("pass");
  });

  it("provider off → review unknown with provenance off, never a throw", async () => {
    const files = miniGenome();
    files[DUE_LIST] = describeDueList(files, "changed");
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
    const r = await runner.runGenome(ctxFor(genomeCandidate({ ...miniGenome(), "node.yaml": "id: 1\n" }), { permittedPaths: ["**"] }));
    expect(r.readiness.actionable).toBe(false);
    expect(r.readiness.findings[0]).toMatchObject({ level: "error", rule: "genome.parse" });
    expect(by(r.evaluations, "C.system.structure")[0]).toMatchObject({ execution: "completed", verdict: "fail" });
    expect(r.review).toHaveLength(1);
    expect(r.review[0]).toMatchObject({ level: "warning", verdict: "unknown" });
    expect(r.review[0].signals.provenance).toMatchObject({ provider: "error" });
    expect(r.review[0].signals.provenance.error?.message).toMatch(/does not load/);
  });

  it("rejects a Genome candidate without files loudly", async () => {
    const runner = createHookRunner({ s1: createSystemOne({}), now: fixedNow });
    await expect(runner.runGenome(ctxFor(genomeCandidate(undefined as unknown as Record<string, string>)))).rejects.toThrow(/genomeFiles/);
  });

  it("vacuous judgments: topology with zero candidates passes; zero claims, an unpinned topology pack or an unparsable candidate is unknown", async () => {
    const files = miniGenome();
    files["node.yaml"] = withSystemCriteria(files, [
      "  - id: C.system.topology", "    title: Topology", "    claim: One recipient per send.", "    gates: [submission]", "    hooks:",
      "      - { id: hook.system.topology.semantic, assay: t, tier: semantic, engine: system-one, triggers: [submission], inputs: { judgment: topology } }",
      "  - id: C.system.purpose", "    title: Purpose", "    claim: Measures are sound.", "    gates: [submission]", "    hooks:",
      "      - { id: hook.system.purpose.model, assay: p, tier: semantic, engine: system-one, triggers: [submission], inputs: { judgment: purposeMeasures } }",
    ]);
    const noClaims: Record<string, string> = { ...files };
    delete noClaims["T1/node.yaml"];
    const runner = createHookRunner({ s1: createSystemOne({}), now: fixedNow });
    const r = await runner.runGenome(ctxFor(genomeCandidate(noClaims), { genomeFiles: files, permittedPaths: ["**"] }));
    expect(by(r.evaluations, "C.system.topology")[0]).toMatchObject({ execution: "completed", verdict: "pass", observations: [expect.objectContaining({ semanticCandidates: 0 })] });
    // Ruling: zero claims is a readiness gap, not evidence.
    expect(by(r.evaluations, "C.system.purpose")[0]).toMatchObject({ execution: "completed", verdict: "unknown", observations: [{ note: "no non-deferred claims" }] });

    // Topology pack not pinned: zero candidates is no evidence.
    const noTopo = { ...noClaims, "node.yaml": noClaims["node.yaml"].replace('    - id: topology.private-pairs\n      version: "1"\n', "") };
    expect(noTopo["node.yaml"]).not.toContain("topology.private-pairs");
    const r2 = await runner.runGenome(ctxFor(genomeCandidate(noTopo), { genomeFiles: files, permittedPaths: ["**"] }));
    expect(by(r2.evaluations, "C.system.topology")[0]).toMatchObject({ verdict: "unknown", observations: [{ note: "pack not run: topology.private-pairs" }] });

    const broken = await runner.runGenome(ctxFor(genomeCandidate({ ...files, "node.yaml": "id: 1\n" }), { genomeFiles: files, permittedPaths: ["**"] }));
    expect(by(broken.evaluations, "C.system.topology")[0]).toMatchObject({ verdict: "unknown" });
    expect(by(broken.evaluations, "C.system.purpose")[0]).toMatchObject({ verdict: "unknown" });
  });

  it("reviewDelta on a Genome candidate with an empty delta passes vacuously", async () => {
    const files = miniGenome();
    files["node.yaml"] = withSystemCriteria(files, [
      "  - id: C.system.review", "    title: Review", "    claim: Amendments are reviewed.", "    gates: [submission]", "    hooks:",
      "      - { id: hook.system.review, assay: r, tier: semantic, engine: system-one, triggers: [submission], inputs: { judgment: reviewDelta } }",
    ]);
    const runner = createHookRunner({ s1: createSystemOne({}), now: fixedNow });
    const r = await runner.runGenome(ctxFor(genomeCandidate(files), { genomeFiles: files, permittedPaths: ["**"] }));
    const e = by(r.evaluations, "C.system.review")[0];
    expect(e).toMatchObject({ execution: "completed", verdict: "pass", observations: [expect.objectContaining({ changes: 0 })] });
    expect(e.limitations).toContain("vacuous: no candidates flagged by the rules; nothing was judged");
  });

  it("an llm hook folds the review into one evaluation via policy", async () => {
    const files = miniGenome();
    files["node.yaml"] = withSystemCriteria(files, [
      "  - id: C.system.review",
      "    title: Amendments are reviewed",
      "    claim: System One finds no contradiction with commitments.",
      "    gates: [submission]",
      "    hooks:",
      "      - id: hook.system.review",
      "        assay: System One delta review",
      "        tier: semantic",
      "        engine: llm",
      "        triggers: [submission]",
      "        inputs: { judgment: reviewDelta }",
    ]);
    const cand = { ...files };
    cand[DUE_LIST] = describeDueList(cand, "#s1pick:hard-rule-violation");
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
