import { describe, expect, it } from "vitest";
import { loadSystem, validate } from "../src/index";
import { sha256 } from "../src/sha256";
import { edit, packsFor, readTree, store } from "./helpers";

// validate() against the real Rule Packs (packages/templates/rule-packs), selected by kits.yaml rulePacks.
const files = readTree();
const run = (f: Map<string, string>) => {
  const m = loadSystem(f, { templates: store() });
  return validate(m, packsFor(m.kits.rulePacks));
};
const brief = (r: ReturnType<typeof run>, level?: string) =>
  r.findings.filter((x) => !level || x.level === level).map((x) => [x.level, x.rule, x.subject]);
const ONTO = "things/app/ontology.yaml";

describe("validate with the real packs", () => {
  it("clean fixture → 0 errors, documented warnings, pinned pack hashes", () => {
    const m = loadSystem(files, { templates: store() });
    const packs = packsFor(m.kits.rulePacks);
    const r = validate(m, packs);
    expect(brief(r)).toEqual([
      ["warning", "hook.unbound", "C.app.notes.save"],
      ["warning", "journey.operationUncovered", "operation.note.list"],
      ["warning", "kit.unpinned", "auth"],
      ["warning", "theory.outcomeUnlinked", "T1"],
    ]);
    expect(r.actionable).toBe(true);
    expect(r.incomplete).toBe(false);
    expect(r.packs.map((p) => `${p.id}@${p.version}`)).toEqual([
      "metamodel@1", "readiness@1", "authorization@1", "theory@1", "journeys@1", "topology.private-pairs@1",
    ]);
    expect(r.packs[0].hash).toBe(sha256(packs[0].source));
    expect(r.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.findings.find((f) => f.rule === "kit.unpinned")!.message).toContain("auth");
  });

  it("removing the policy link → authz.ungoverned error with derivation", () => {
    const r = run(edit(files, ONTO, "      - { rel: governs, to: operation.note.save }\n", ""));
    expect(brief(r, "error")).toEqual([["error", "authz.ungoverned", "operation.note.save"]]);
    const e = r.findings.find((x) => x.level === "error")!;
    expect(e.message).toContain("operation.note.save");
    expect(e.pack).toBe("authorization@1");
    expect(e.derivation.relation).toBe("violation");
    expect(e.derivation.children.map((c) => c.relation)).toEqual(["mutating"]);
    expect(e.facts).toContainEqual(["link", "operation.note.save", "writes", "entity.Note", "declared"]);
    expect(r.derived.violation).toContainEqual(["authz.ungoverned", "operation.note.save", "hard"]);
    expect(r.actionable).toBe(false);
  });

  it("conflicting policy modes → authz.policyConflict", () => {
    const r = run(edit(files, ONTO, "  - id: policy.ownerOnly\n",
      "  - { id: policy.public, kind: policy, name: Public, parent: section.domain, mode: public, links: [{ rel: governs, to: operation.note.save }] }\n  - id: policy.ownerOnly\n"));
    expect(brief(r, "error")).toEqual([["error", "authz.policyConflict", "operation.note.save"]]);
  });

  it("dangling link → ref.dangling", () => {
    const r = run(edit(files, ONTO, "{ rel: reads, to: entity.Note }", "{ rel: reads, to: entity.Ghost }"));
    expect(brief(r, "error")).toEqual([["error", "ref.dangling", "operation.note.list"]]);
  });

  it("criterion subject missing → criterion.subjectMissing", () => {
    const r = run(edit(files, "things/app/criteria.yaml", "subjectId: affordance.NoteForm.save", "subjectId: affordance.Gone"));
    expect(brief(r, "error")).toEqual([["error", "criterion.subjectMissing", "C.app.notes.save"]]);
  });

  it("removing a template section → template.sectionMissing; omitting sections uses the template's", () => {
    const r = run(edit(files, "things/app/thing.yaml", "sections: [section.ui, section.domain]", "sections: [section.ui]"));
    expect(brief(r, "error")).toEqual([["error", "template.sectionMissing", "thing.app"]]);
    expect(brief(run(edit(files, "things/app/thing.yaml", "sections: [section.ui, section.domain]\n", "")), "error")).toEqual([]);
  });

  it("step pointing at an unknown screen → journey.stepRefMissing (+ ref.dangling); unresolved steps are exempt", () => {
    const f = edit(files, "journeys/J.notes.yaml", "action: Save note, screen: screen.edit,", "action: Save note, screen: screen.gone,");
    expect(brief(run(f), "error")).toEqual([
      ["error", "journey.stepRefMissing", "J.notes"],
      ["error", "ref.dangling", "J.notes/s3"],
    ]);
    const u = edit(f, "journeys/J.notes.yaml", "action: Save note, screen: screen.gone,", "action: Save note, screen: screen.gone, unresolved: true,");
    expect(brief(run(u), "error")).toEqual([]);
  });

  it("criterion without hooks → missing coverage.hook", () => {
    let f = edit(files, "things/app/criteria.yaml", /hooks:\n  - id: hook\.app\.notes\.save[\s\S]*$/, "");
    f = edit(f, "things/app/criteria.yaml", "    hooks: [hook.app.notes.save]\n", "");
    const r = run(f);
    expect(brief(r, "missing")).toEqual([["missing", "coverage.hook", "C.app.notes.save"]]);
    expect(r.actionable).toBe(true);
  });

  it("multi-recipient wording → info semantic:topology.multiRecipient", () => {
    const r = run(edit(files, ONTO, "Persists the note for its owner", "Sends the note to all recipients"));
    expect(brief(r, "info")).toEqual([["info", "semantic:topology.multiRecipient", "affordance.NoteForm.save"]]);
    expect(r.actionable).toBe(true);
  });

  it("folds soft violations into warnings", () => {
    const m = loadSystem(files, { templates: store() });
    const extra = { id: "test.soft", version: "1", source: '.decl node(Id: sym, Kind: sym, Thing: sym)\n.decl violation(Rule: sym, Subject: sym, Severity: sym) .output\nviolation("x.soft",N,"soft") :- node(N,"policy",_).\n' };
    const r = validate(m, [extra]);
    expect(brief(r)).toEqual([["warning", "x.soft", "policy.ownerOnly"]]);
    expect(r.findings[0].message).toBe("x.soft");
    expect(r.actionable).toBe(true);
  });
});
