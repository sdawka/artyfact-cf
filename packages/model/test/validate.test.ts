import { describe, expect, it } from "vitest";
import { packName } from "@artyfact/ontology";
import { rulePacksOf, validate } from "../src/index";
import { sha256 } from "../src/sha256";
import { edit, load, readTree } from "./helpers";

// validate() against the real template packs (packages/templates), selected by the root's pinned rulePacks.
const files = readTree();
const run = (f: Map<string, string>) => validate(load(f));
const brief = (r: ReturnType<typeof run>, level?: string) =>
  r.findings.filter((x) => !level || x.level === level).map((x) => [x.level, x.rule, x.subject]);
const domain = (n: string) => `thing.app/section.domain/${n}/node.yaml`;
const THING = "thing.app/node.yaml";
const SAVE = "thing.app/section.ui/screen.edit/component.NoteForm/affordance.NoteForm.save/node.yaml";
const POLICY = domain("policy.ownerOnly");

describe("validate with the real packs", () => {
  it("allows a Genome-only Thing with no Parts or artifacts", () => {
    const f = edit(files, THING, /  artifacts:\n(    .*\n|      .*\n)*/, "");
    expect(brief(run(f), "error")).toEqual([]);
  });

  it("clean fixture → 0 errors, documented warnings, pinned pack hashes", () => {
    const m = load(files);
    const r = validate(m);
    expect(brief(r, "error")).toEqual([]);
    expect(brief(r, "warning")).toEqual([
      ["warning", "hook.unbound", "C.app.notes.save"],
      ["warning", "journey.operationUncovered", "operation.note.list"],
      ["warning", "kit.unpinned", "auth"],
      ["warning", "theory.outcomeUnlinked", "T1"],
    ]);
    expect(r.actionable).toBe(true);
    expect(r.incomplete).toBe(false);
    const packs = rulePacksOf(m);
    expect(r.packs.map((p) => `${p.id}@${p.version}`)).toEqual(packs.map((p) => `${p.id}@${p.version}`));
    expect(r.packs.map((p) => p.id)).toEqual(expect.arrayContaining(["metamodel", "readiness", "authorization", "theory", "journeys", "topology.private-pairs"]));
    expect(r.packs[0].hash).toBe(sha256(packs[0].source));
    expect(r.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.findings.find((f) => f.rule === "kit.unpinned")!.message).toContain("auth");
  });

  it("runs no template pack that derives findings when none is pinned", () => {
    const r = run(edit(files, "node.yaml", /  rulePacks:\n(    .*\n|      .*\n)*/, ""));
    expect(r.packs.map((p) => p.id).filter((id) => !id.startsWith("engine."))).toEqual(["facts"]);
    expect(brief(r).filter((x) => x[0] !== "info" && x[1] !== "node.provisional")).toEqual([]);
  });

  it("reports the engine's own packs apart from the pinned ones", () => {
    const r = run(files);
    expect(r.packs.filter((p) => p.id === "metamodel" || p.id === "engine.metamodel").map((p) => p.id)).toEqual(["engine.metamodel", "metamodel"]);
  });

  it("runs only the pinned template packs; a pin no template declares is a blocking error", () => {
    const f = edit(files, "node.yaml", /    - id: topology\.private-pairs\n      version: "1"\n/, "    - id: ghost\n      version: \"1\"\n");
    const r = run(f);
    expect(r.packs.map((p) => p.id)).not.toContain("topology.private-pairs");
    expect(brief(r, "error")).toContainEqual(["error", "rulePack.unavailable", "ghost@1"]);
    expect(r.findings.find((x) => x.rule === "rulePack.unavailable")!.pack).toBe("ghost@1");
    expect(r.actionable).toBe(false);
  });

  it("is not actionable when every pin is unavailable", () => {
    const r = run(edit(files, "node.yaml", /version: "1"/g, 'version: "9"'));
    expect(r.findings.filter((x) => x.rule === "rulePack.unavailable").length).toBeGreaterThan(1);
    expect(r.actionable).toBe(false);
  });

  it("removing the policy link → authz.ungoverned error with derivation", () => {
    const r = run(edit(files, POLICY, "  - { rel: governs, to: operation.note.save }\n", ""));
    expect(brief(r, "error")).toEqual([["error", "authz.ungoverned", "operation.note.save"]]);
    const e = r.findings.find((x) => x.level === "error")!;
    expect(e.message).toContain("operation.note.save");
    expect(e.pack).toBe("authorization@1");
    expect(e.derivation.relation).toBe("violation");
    expect(e.facts).toContainEqual(["link", "operation.note.save", "writes", "entity.Note", "declared"]);
    expect(r.derived.violation).toContainEqual(["authz.ungoverned", "operation.note.save", "hard"]);
    expect(r.actionable).toBe(false);
  });

  it("conflicting policy modes → authz.policyConflict", () => {
    const f = new Map(files).set(domain("policy.public"),
      "id: policy.public\nkind: policy\nfields: {name: Public, owningThing: thing.app, revision: 1, mode: public}\nlinks:\n  - { rel: governs, to: operation.note.save }\n");
    expect(brief(run(f), "error")).toEqual([["error", "authz.policyConflict", "operation.note.save"]]);
  });

  it("dangling link → ref.dangling", () => {
    const r = run(edit(files, domain("operation.note.list"), "{ rel: reads, to: entity.Note }", "{ rel: reads, to: entity.Ghost }"));
    expect(brief(r, "error").map((x) => x[1])).toContain("ref.dangling");
  });

  it("a criterion's subject is the node that declares it", () => {
    const c = load(files).criteria.find((x) => x.id === "C.app.notes.save")!;
    expect([c.subjectId, c.ownerId, c.sourceRefs]).toEqual(["affordance.NoteForm.save", "thing.app", ["S.app.notes"]]);
  });

  it("removing a template section → template.sectionMissing; omitting sections uses the template's", () => {
    const r = run(edit(files, THING, "    - section.ui\n    - section.domain\n", "    - section.ui\n"));
    expect(brief(r, "error")).toEqual([["error", "template.sectionMissing", "thing.app"]]);
    expect(brief(run(edit(files, THING, "  sections:\n    - section.ui\n    - section.domain\n", "")), "error")).toEqual([]);
  });

  it("step pointing at an unknown screen → journey.stepRefMissing; unresolved steps are exempt", () => {
    const S3 = "thing.app/J.notes/s3/node.yaml";
    const f = edit(files, S3, "{ rel: stepScreen, to: screen.edit }", "{ rel: stepScreen, to: screen.gone }");
    expect(brief(run(f), "error").map((x) => x[1])).toContain("journey.stepRefMissing");
    const u = edit(f, S3, "unresolved: false", "unresolved: true");
    expect(brief(run(u), "error").map((x) => x[1])).not.toContain("journey.stepRefMissing");
  });

  it("criterion without hooks → missing coverage.hook", () => {
    const f = edit(files, SAVE, /    hooks:\n[\s\S]*$/, "");
    const r = run(f);
    expect(brief(r, "missing")).toContainEqual(["missing", "coverage.hook", "C.app.notes.save"]);
    expect(r.actionable).toBe(true);
  });

  it("multi-recipient wording → info semantic:topology.multiRecipient", () => {
    const r = run(edit(files, SAVE, "Persists the note for its owner", "Sends the note to all recipients"));
    expect(brief(r, "info")).toContainEqual(["info", "semantic:topology.multiRecipient", "affordance.NoteForm.save"]);
    expect(r.actionable).toBe(true);
  });

  it("folds soft violations into warnings", () => {
    const soft = { id: "test.soft", version: "1", source: '.decl node(Id: sym, Kind: sym, Thing: sym)\n.decl violation(Rule: sym, Subject: sym, Severity: sym) .output\nviolation("x.soft",N,"soft") :- node(N,"policy",_).\n' };
    const m = load(files);
    const r = validate({ ...m, kits: { ...m.kits, rulePacks: [{ id: "test.soft", version: "1" }] }, template: { ...m.template, rules: [soft] } });
    expect(brief(r)).toContainEqual(["warning", "x.soft", "policy.ownerOnly"]);
    expect(r.findings.find((x) => x.rule === "x.soft")!.pack).toBe("test.soft@1");
    expect(r.actionable).toBe(true);
    expect(packName(soft)).toBe("test.soft@1");
  });
});
